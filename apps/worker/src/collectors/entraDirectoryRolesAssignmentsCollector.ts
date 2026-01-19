import type { Collector } from "./types";
import { getGraphAccessToken, graphGetAllPages } from "./graph";

/**
 * Phase C (Step 1): evidence + observed checks only.
 * - No findings emitted in this first iteration.
 * - Profile boundary is enforced at the artefact layer:
 *   - safe: no principal identifiers / UPN / mail / displayName / membership identifiers
 *   - full: include principal identifiers/properties returned by Graph
 */

type DirectoryRoleTemplate = {
  id: string;
  displayName?: string;
};

type DirectoryRole = {
  id: string;
  displayName?: string;
  roleTemplateId?: string;
};

type GraphDirectoryObject = {
  id?: string;
  "@odata.type"?: string;

  // user-ish
  userPrincipalName?: string;
  mail?: string;
  displayName?: string;

  // servicePrincipal-ish
  appId?: string;
  servicePrincipalType?: string;
};

type PrincipalType = "user" | "group" | "servicePrincipal" | "unknown";

type RoleAssignmentFull = {
  assignmentType: "active" | "eligible" | "unknown";
  principalType: PrincipalType;
  principal: {
    id?: string;
    odataType?: string;
    displayName?: string;
    userPrincipalName?: string;
    mail?: string;
    appId?: string;
    servicePrincipalType?: string;
  };
};

type RoleAssignmentSafe = {
  assignmentType: "active" | "eligible" | "unknown";
  principalType: PrincipalType;
};

type RoleEntrySafe = {
  roleId: string;
  roleTemplateId?: string;
  roleDisplayName: string;
  assignmentCounts: {
    total: number;
    user: number;
    group: number;
    servicePrincipal: number;
    unknown: number;
  };
};

type RoleEntryFull = {
  roleId: string;
  roleTemplateId?: string;
  roleDisplayName: string;
  assignments: RoleAssignmentFull[];
};

function limitConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let currentIndex = 0;
  let active = 0;

  return new Promise((resolve, reject) => {
    const next = () => {
      if (currentIndex >= items.length && active === 0) {
        resolve(results);
        return;
      }

      while (active < concurrency && currentIndex < items.length) {
        const idx = currentIndex++;
        active++;

        fn(items[idx])
          .then((r) => {
            results[idx] = r;
            active--;
            next();
          })
          .catch(reject);
      }
    };

    next();
  });
}

function principalTypeFromOdata(odataType: string | undefined | null): PrincipalType {
  const t = (odataType ?? "").toLowerCase();
  if (t.endsWith("user")) return "user";
  if (t.endsWith("group")) return "group";
  if (t.endsWith("serviceprincipal")) return "servicePrincipal";
  return "unknown";
}

function safeProfileFromRun(run: any): "safe" | "full" {
  const raw = run?.dataProfile;
  return raw === "full" ? "full" : "safe";
}

export const entraDirectoryRolesAssignmentsCollector: Collector = {
  id: "entra.directoryRoles.assignments",
  displayName: "Entra directory roles & privileged assignments",
  async run(ctx) {
    const tenantId = ctx.tenant.tenantGuid;
    const token = await getGraphAccessToken({ tenantId });

    // Profile boundary (stable contract):
    // Only explicit "full" allows sensitive artefact exports.
    // Unknown/missing is treated as safe.
    const dataProfile = safeProfileFromRun(ctx.run as any);
    const includeSensitive = dataProfile === "full";

    // Demo guardrails (optional caps) — must surface as completeness/truncation.
    const MAX_ROLES = Number(process.env.DIRROLES_MAX_ROLES ?? 200);
    const CONCURRENCY = Number(process.env.DIRROLES_CONCURRENCY ?? 8);

    // Completeness tracking (evidence truthfulness)
    const completeness = {
      slicesAttempted: [] as string[],
      slicesCompleted: [] as string[],
      permissionDenied: [] as string[],
      truncated: false,
      notes: [] as string[]
    };

    // -------------------------
    // Slice A: Role definitions (templates)
    // -------------------------
    completeness.slicesAttempted.push("roleDefinitions");

    let roleTemplates: DirectoryRoleTemplate[] = [];
    try {
      roleTemplates = await graphGetAllPages<DirectoryRoleTemplate>(
        token,
        "https://graph.microsoft.com/v1.0/directoryRoleTemplates?$select=id,displayName"
      );
      completeness.slicesCompleted.push("roleDefinitions");
    } catch (e: any) {
      // Keep running; surface in completeness
      completeness.notes.push(
        `roleDefinitions failed: ${e?.message ?? "unknown error"}`
      );
      // If you want to classify 403 specifically, do it defensively:
      if (String(e?.message ?? "").includes("403")) {
        completeness.permissionDenied.push("roleDefinitions");
      }
    }

    const roleTemplateNameById = new Map<string, string>();
    for (const t of roleTemplates) {
      if (t?.id) roleTemplateNameById.set(t.id, t.displayName ?? "(unknown)");
    }

    // -------------------------
    // Slice B: Active role assignments (directoryRoles + members)
    // -------------------------
    completeness.slicesAttempted.push("activeAssignments");

    let directoryRoles: DirectoryRole[] = [];
    try {
      directoryRoles = await graphGetAllPages<DirectoryRole>(
        token,
        "https://graph.microsoft.com/v1.0/directoryRoles?$select=id,displayName,roleTemplateId"
      );
      completeness.slicesCompleted.push("activeAssignments");
    } catch (e: any) {
      completeness.notes.push(
        `activeAssignments role list failed: ${e?.message ?? "unknown error"}`
      );
      if (String(e?.message ?? "").includes("403")) {
        completeness.permissionDenied.push("activeAssignments");
      }
    }

    // Apply cap for demo predictability; surface truncation
    const wasTruncated = directoryRoles.length > MAX_ROLES;
    const targetRoles = wasTruncated ? directoryRoles.slice(0, MAX_ROLES) : directoryRoles;
    if (wasTruncated) {
      completeness.truncated = true;
      completeness.notes.push(
        `directoryRoles capped at ${MAX_ROLES} roles (demo guardrail)`
      );
    }

    // Fetch members per role (best-effort; per-role failure should not abort run)
    const roleMemberResults = await limitConcurrency(targetRoles, CONCURRENCY, async (role) => {
      const roleId = role.id;
      const roleDisplayName =
        role.displayName ??
        roleTemplateNameById.get(role.roleTemplateId ?? "") ??
        "(unknown)";

      // In safe profile we still need to determine principalType; we do NOT store identifiers.
      // Keep selects minimal to reduce accidental PII exposure.
      const select =
        includeSensitive
          ? "$select=id,displayName,userPrincipalName,mail,appId,servicePrincipalType"
          : "$select=id,@odata.type";

      let members: GraphDirectoryObject[] = [];
      let rolePermissionDenied = false;

      try {
        members = await graphGetAllPages<GraphDirectoryObject>(
          token,
          `https://graph.microsoft.com/v1.0/directoryRoles/${roleId}/members?${select}`
        );
      } catch (e: any) {
        // Do not fail whole collector
        const msg = e?.message ?? "unknown error";
        if (String(msg).includes("403")) rolePermissionDenied = true;
        completeness.notes.push(
          `activeAssignments members failed for role ${roleId} (${roleDisplayName}): ${msg}`
        );
      }

      const assignmentsFull: RoleAssignmentFull[] = [];
      const assignmentsSafe: RoleAssignmentSafe[] = [];

      const counts = {
        total: 0,
        user: 0,
        group: 0,
        servicePrincipal: 0,
        unknown: 0
      };

      for (const m of members) {
        // @odata.type is not always present in every response shape; try to infer safely
        const principalType: PrincipalType =
          principalTypeFromOdata((m as any)?.["@odata.type"]) ??
          "unknown";

        counts.total++;
        counts[principalType]++;

        if (includeSensitive) {
          assignmentsFull.push({
            assignmentType: "active",
            principalType,
            principal: {
              id: m.id,
              odataType: (m as any)?.["@odata.type"],
              displayName: m.displayName,
              userPrincipalName: m.userPrincipalName,
              mail: m.mail,
              appId: m.appId,
              servicePrincipalType: m.servicePrincipalType
            }
          });
        } else {
          assignmentsSafe.push({
            assignmentType: "active",
            principalType
          });
        }
      }

      return {
        roleId,
        roleTemplateId: role.roleTemplateId,
        roleDisplayName,
        rolePermissionDenied,
        assignmentsFull,
        assignmentsSafe,
        counts
      };
    });

    // If any role had permission denied at member enumeration, treat as permission gap on the slice
    const anyRolePermissionDenied = roleMemberResults.some((r) => r.rolePermissionDenied);
    if (anyRolePermissionDenied && !completeness.permissionDenied.includes("activeAssignments")) {
      // Keep stable string identifiers
      completeness.permissionDenied.push("activeAssignments");
    }

    // -------------------------
    // Slice C: Eligible / PIM assignments (best-effort, optional)
    // -------------------------
    // This slice is optional and should not make the "core" set incomplete by itself.
    // We still surface attempted/succeeded via ENTRA_DIRROLES_OBS_004 and completeness notes.
    let pimAttempted = false;
    let pimSucceeded = false;
    let eligibleAssignmentsCount: number | undefined = undefined;

    // Allow disabling in environments where Graph beta/roleManagement endpoints aren't desired
    const ENABLE_PIM_SLICE = String(process.env.DIRROLES_ENABLE_PIM_SLICE ?? "1") === "1";

    if (ENABLE_PIM_SLICE) {
      pimAttempted = true;
      completeness.slicesAttempted.push("eligibleAssignments");

      try {
        // Use v1.0 where possible; if your environment requires beta, switch here.
        // We only need counts in safe; full can export detail later if desired.
        // For this iteration we keep it as a count only.
        const schedules = await graphGetAllPages<any>(
          token,
          "https://graph.microsoft.com/v1.0/roleManagement/directory/roleEligibilitySchedules?$select=id"
        );
        eligibleAssignmentsCount = schedules.length;
        pimSucceeded = true;
        completeness.slicesCompleted.push("eligibleAssignments");
      } catch (e: any) {
        pimSucceeded = false;
        completeness.notes.push(
          `eligibleAssignments (PIM) not available or denied: ${e?.message ?? "unknown error"}`
        );
      }
    }

    // -------------------------
    // Build summaries for observed checks
    // -------------------------
    const roleDefinitionsCount = roleTemplates.length;

    const rolesWithAnyActiveAssignmentCount = roleMemberResults.filter(
      (r) => r.counts.total > 0
    ).length;

    const activeAssignmentsCount = roleMemberResults.reduce((acc, r) => acc + r.counts.total, 0);

    const distribution = roleMemberResults.reduce(
      (acc, r) => {
        acc.user += r.counts.user;
        acc.group += r.counts.group;
        acc.servicePrincipal += r.counts.servicePrincipal;
        acc.unknown += r.counts.unknown;
        return acc;
      },
      { user: 0, group: 0, servicePrincipal: 0, unknown: 0 }
    );

    const groupAssignmentsCount = distribution.group;
    const groupBasedPresent = groupAssignmentsCount > 0;

    // "Core completeness" is about role definitions + active assignments only.
    const coreComplete =
      completeness.slicesCompleted.includes("roleDefinitions") &&
      completeness.slicesCompleted.includes("activeAssignments") &&
      !completeness.truncated &&
      !completeness.permissionDenied.includes("roleDefinitions") &&
      !completeness.permissionDenied.includes("activeAssignments");

    // -------------------------
    // Emit observed checks (preferred pattern)
    // -------------------------
    await ctx.prisma.observedCheck.create({
      data: {
        runId: ctx.run.id,
        jobId: ctx.job.id,
        checkId: "ENTRA_DIRROLES_OBS_001",
        collectorId: "entra.directoryRoles.assignments",
        ruleId: null,
        data: {
          roleDefinitionsCount,
          rolesWithAnyActiveAssignmentCount,
          activeAssignmentsCount,
          dataProfile,
          truncated: completeness.truncated
        },
        references: [] as any
      }
    });

    await ctx.prisma.observedCheck.create({
      data: {
        runId: ctx.run.id,
        jobId: ctx.job.id,
        checkId: "ENTRA_DIRROLES_OBS_002",
        collectorId: "entra.directoryRoles.assignments",
        ruleId: null,
        data: {
          user: distribution.user,
          group: distribution.group,
          servicePrincipal: distribution.servicePrincipal,
          unknown: distribution.unknown,
          dataProfile,
          truncated: completeness.truncated
        },
        references: [] as any
      }
    });

    await ctx.prisma.observedCheck.create({
      data: {
        runId: ctx.run.id,
        jobId: ctx.job.id,
        checkId: "ENTRA_DIRROLES_OBS_003",
        collectorId: "entra.directoryRoles.assignments",
        ruleId: null,
        data: {
          present: groupBasedPresent,
          assignmentsCount: groupAssignmentsCount,
          dataProfile,
          truncated: completeness.truncated
        },
        references: [] as any
      }
    });

    // PIM/eligible coverage (only if attempted)
    if (pimAttempted) {
      await ctx.prisma.observedCheck.create({
        data: {
          runId: ctx.run.id,
          jobId: ctx.job.id,
          checkId: "ENTRA_DIRROLES_OBS_004",
          collectorId: "entra.directoryRoles.assignments",
          ruleId: null,
          data: {
            attempted: true,
            succeeded: pimSucceeded,
            eligibleAssignmentsCount,
            dataProfile,
            truncated: completeness.truncated
          },
          references: [] as any
        }
      });
    }

    await ctx.prisma.observedCheck.create({
      data: {
        runId: ctx.run.id,
        jobId: ctx.job.id,
        checkId: "ENTRA_DIRROLES_OBS_005",
        collectorId: "entra.directoryRoles.assignments",
        ruleId: null,
        data: {
          isComplete: coreComplete,
          truncated: completeness.truncated,
          permissionDenied: completeness.permissionDenied,
          slicesAttempted: completeness.slicesAttempted,
          slicesCompleted: completeness.slicesCompleted,
          notes: completeness.notes,
          dataProfile
        },
        references: [] as any
      }
    });

    // -------------------------
    // Build artefacts (profile-aware)
    // -------------------------
    const capturedAt = new Date().toISOString();

    const summary = {
      roleDefinitionsCount,
      activatedRolesCount: directoryRoles.length,
      scannedRolesCount: targetRoles.length,
      rolesWithAnyActiveAssignmentCount,
      activeAssignmentsCount,
      assignmentPrincipalTypeCounts: {
        user: distribution.user,
        group: distribution.group,
        servicePrincipal: distribution.servicePrincipal,
        unknown: distribution.unknown
      },
      truncated: completeness.truncated,
      maxRoles: MAX_ROLES,
      concurrency: CONCURRENCY,
      pim: {
        attempted: pimAttempted,
        succeeded: pimSucceeded,
        eligibleAssignmentsCount
      }
    };

    // Safe roles array: counts only, no principal IDs or identifying properties
    const rolesSafe: RoleEntrySafe[] = roleMemberResults.map((r) => ({
      roleId: r.roleId,
      roleTemplateId: r.roleTemplateId,
      roleDisplayName: r.roleDisplayName,
      assignmentCounts: {
        total: r.counts.total,
        user: r.counts.user,
        group: r.counts.group,
        servicePrincipal: r.counts.servicePrincipal,
        unknown: r.counts.unknown
      }
    }));

    const safeArtefact = {
      capturedAt,
      tenant: {
        tenantId: ctx.tenant.tenantGuid
      },
      dataProfile: "safe" as const,
      completeness: {
        isComplete: coreComplete,
        truncated: completeness.truncated,
        permissionDenied: completeness.permissionDenied,
        slicesAttempted: completeness.slicesAttempted,
        slicesCompleted: completeness.slicesCompleted,
        notes: completeness.notes
      },
      summary,
      roles: rolesSafe
    };

    const artefacts: Array<{
      type: "json";
      filename: string;
      contentType: "application/json";
      content: string;
    }> = [
      {
        type: "json",
        filename: "directory-roles-assignments.safe.json",
        contentType: "application/json",
        content: JSON.stringify(safeArtefact, null, 2)
      }
    ];

    if (includeSensitive) {
      const rolesFull: RoleEntryFull[] = roleMemberResults.map((r) => ({
        roleId: r.roleId,
        roleTemplateId: r.roleTemplateId,
        roleDisplayName: r.roleDisplayName,
        assignments: r.assignmentsFull
      }));

      const fullArtefact = {
        capturedAt,
        tenant: {
          tenantId: ctx.tenant.tenantGuid,
          primaryDomain: ctx.tenant.primaryDomain,
          displayName: ctx.tenant.displayName
        },
        dataProfile: "full" as const,
        completeness: {
          isComplete: coreComplete,
          truncated: completeness.truncated,
          permissionDenied: completeness.permissionDenied,
          slicesAttempted: completeness.slicesAttempted,
          slicesCompleted: completeness.slicesCompleted,
          notes: completeness.notes
        },
        summary,
        roles: rolesFull
      };

      artefacts.push({
        type: "json",
        filename: "directory-roles-assignments.full.json",
        contentType: "application/json",
        content: JSON.stringify(fullArtefact, null, 2)
      });
    }

    return {
      id: "entra.directoryRoles.assignments",
      status: "ok",
      summary: {
        profile: dataProfile,
        roleDefinitionsCount,
        rolesScanned: targetRoles.length,
        activeAssignmentsCount,
        truncated: completeness.truncated,
        isComplete: coreComplete
      },
      artefacts
    };
  }
};
