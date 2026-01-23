import type { Collector } from "./types";
import { getGraphAccessToken, graphGetAllPages, GraphHttpError } from "./graph";

/**
 * Phase C: Entra Directory Roles & Privileged Assignments
 *
 * Intent:
 * - evidence + observed checks first (preferred pattern)
 * - findings are added incrementally (decision-ready signals)
 * - support both security posture and take-on / migration scoping lenses
 *
 * Data profile contract:
 * - safe: must not emit PII-bearing artefacts (no identifiers, no UPN/mail/displayName)
 * - full: may emit PII-bearing artefacts (explicit .full.json)
 */

type DataProfile = "safe" | "full";
type PrincipalType = "user" | "group" | "servicePrincipal" | "unknown";

type GraphDirectoryRole = {
  id: string;
  displayName?: string;
  roleTemplateId?: string;
};

type GraphRoleTemplate = {
  id: string;
  displayName?: string;
};

type GraphDirectoryObject = {
  id: string;
  displayName?: string;

  // User-ish
  userPrincipalName?: string;
  mail?: string;

  // Service principal-ish
  appId?: string;
  servicePrincipalType?: string;
};

type RoleAssignmentFull = {
  assignmentType: "active" | "eligible";
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
  assignmentType: "active" | "eligible";
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

function isFullProfile(v: unknown): v is "full" {
  return v === "full";
}

function isGraph403(e: unknown): boolean {
  return e instanceof GraphHttpError && e.status === 403;
}

function truncateForUi(input: string, max = 320): string {
  const cleaned = input.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}…(truncated)`;
}

function summarizeGraphErrorMessage(msg: string): string {
  // Try to keep only the useful bit for humans, without the huge JSON blob.
  // Example msg often contains: "Graph GET failed (400) url=...: {\"error\":{...}}"
  const m = msg.match(/Graph GET failed \((\d+)\)/);
  const status = m?.[1] ? `(${m[1]})` : "";
  // Pick out CultureNotFoundException if present
  const culture = msg.includes("CultureNotFoundException") ? " CultureNotFoundException" : "";
  return `Graph request failed ${status}.${culture}`.trim();
}

function principalTypeFromOdata(odataType: unknown): PrincipalType | null {
  const s = typeof odataType === "string" ? odataType.toLowerCase() : "";
  // Common types:
  // - #microsoft.graph.user
  // - #microsoft.graph.group
  // - #microsoft.graph.servicePrincipal
  if (s.includes("microsoft.graph.user")) return "user";
  if (s.includes("microsoft.graph.group")) return "group";
  if (s.includes("microsoft.graph.serviceprincipal")) return "servicePrincipal";
  return null;
}

async function limitConcurrency<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn) => Promise<TOut>
): Promise<TOut[]> {
  const results: TOut[] = [];
  let index = 0;

  const workers = Array.from({ length: Math.max(1, concurrency) }).map(async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  });

  await Promise.all(workers);
  return results;
}

export const entraDirectoryRolesAssignmentsCollector: Collector = {
  id: "entra.directoryRoles.assignments",
  displayName: "Entra Directory Roles & Assignments",
  async run(ctx) {
    const dataProfile: DataProfile = isFullProfile(ctx.run.dataProfile) ? "full" : "safe";
    const includeSensitive = dataProfile === "full";

    const tenantId = ctx.tenant.tenantGuid;
    const token = await getGraphAccessToken({ tenantId });

    const MAX_ROLES = Number(process.env.DIRROLES_MAX_ROLES ?? 50);
    const CONCURRENCY = Number(process.env.DIRROLES_CONCURRENCY ?? 5);

    // Track completeness as a first-class signal (demo guardrails / API / perms)
    const completeness = {
      truncated: false,
      permissionDenied: [] as string[],
      slicesAttempted: [] as string[],
      slicesCompleted: [] as string[],
      notes: [] as string[]
    };

    // -------------------------
    // Slice A: Role definitions (templates)
    // -------------------------
    completeness.slicesAttempted.push("roleDefinitions");

    let roleTemplates: GraphRoleTemplate[] = [];
    try {
      roleTemplates = await graphGetAllPages<GraphRoleTemplate>(
        token,
        "https://graph.microsoft.com/v1.0/directoryRoleTemplates?$select=id,displayName"
      );
      completeness.slicesCompleted.push("roleDefinitions");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);

      if (isGraph403(e)) {
        // Permission gap: completeness signal, not a hard failure
        if (!completeness.permissionDenied.includes("roleDefinitions")) {
          completeness.permissionDenied.push("roleDefinitions");
        }
        completeness.notes.push(`roleDefinitions permission denied (403): ${msg}`);
        roleTemplates = [];
      } else {
        // Non-permission faults should still fail fast
        completeness.notes.push(`roleDefinitions failed: ${msg}`);
        throw new Error(`Directory role templates could not be enumerated: ${msg}`);
      }
    }

    const roleTemplateNameById = new Map<string, string>();
    for (const rt of roleTemplates) {
      if (rt?.id) roleTemplateNameById.set(rt.id, rt.displayName ?? "(unknown)");
    }

    // -------------------------
    // Slice B: Active directory roles + members
    // -------------------------
    completeness.slicesAttempted.push("activeAssignments");

    let directoryRoles: GraphDirectoryRole[] = [];
    try {
      directoryRoles = await graphGetAllPages<GraphDirectoryRole>(
        token,
        "https://graph.microsoft.com/v1.0/directoryRoles?$select=id,displayName,roleTemplateId"
      );
      completeness.slicesCompleted.push("activeAssignments");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);

      if (isGraph403(e)) {
        // Permission gap: completeness signal, not a hard failure
        if (!completeness.permissionDenied.includes("activeAssignments")) {
          completeness.permissionDenied.push("activeAssignments");
        }
        completeness.notes.push(`activeAssignments permission denied (403): ${msg}`);
        directoryRoles = [];
      } else {
        completeness.notes.push(`activeAssignments roles list failed: ${msg}`);
        throw new Error(`Directory roles could not be enumerated: ${msg}`);
      }
    }

    // Apply cap for demo predictability; surface truncation
    const wasTruncated = directoryRoles.length > MAX_ROLES;
    const targetRoles = wasTruncated ? directoryRoles.slice(0, MAX_ROLES) : directoryRoles;
    if (wasTruncated) {
      completeness.truncated = true;
      completeness.notes.push(`directoryRoles capped at ${MAX_ROLES} roles (demo guardrail)`);
    }

    // Fetch members per role (best-effort; per-role failure should not abort run)
    const roleMemberResults = await limitConcurrency(targetRoles, CONCURRENCY, async (role) => {
      const roleId = role.id;
      const roleDisplayName =
        role.displayName ??
        roleTemplateNameById.get(role.roleTemplateId ?? "") ??
        "(unknown)";

      // In safe profile we still need principalType; we do NOT store identifiers.
      // Note: @odata.type is typically present without selecting it; we can select id only for safe mode.
      const select = includeSensitive
        ? "$select=id,displayName,userPrincipalName,mail,appId,servicePrincipalType"
        : "$select=id";

      let members: GraphDirectoryObject[] = [];
      let rolePermissionDenied = false;

      try {
        members = await graphGetAllPages<GraphDirectoryObject>(
          token,
          `https://graph.microsoft.com/v1.0/directoryRoles/${roleId}/members?${select}`
        );
      } catch (e: unknown) {
        // Do not fail whole collector
        const msg = e instanceof Error ? e.message : String(e);
        if (isGraph403(e)) rolePermissionDenied = true;
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
        const principalType: PrincipalType =
          principalTypeFromOdata((m as any)?.["@odata.type"]) ?? "unknown";

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
      completeness.permissionDenied.push("activeAssignments");
    }

  // -------------------------
// Slice C: Eligible / PIM assignments (best-effort, optional)
// -------------------------
let pimAttempted = false;
let pimSucceeded = false;
let eligibleAssignmentsCount: number | undefined = undefined;

const ENABLE_PIM_SLICE = String(process.env.DIRROLES_ENABLE_PIM_SLICE ?? "1") === "1";

if (ENABLE_PIM_SLICE) {
  pimAttempted = true;
  completeness.slicesAttempted.push("eligibleAssignments");

  try {
    const schedules = await graphGetAllPages<any>(
      token,
      "https://graph.microsoft.com/v1.0/roleManagement/directory/roleEligibilitySchedules?$select=id"
    );
    eligibleAssignmentsCount = schedules.length;
    pimSucceeded = true;
    completeness.slicesCompleted.push("eligibleAssignments");
  } catch (e: unknown) {
    pimSucceeded = false;

    if (isGraph403(e) && !completeness.permissionDenied.includes("eligibleAssignments")) {
      completeness.permissionDenied.push("eligibleAssignments");
    }

    const raw = e instanceof Error ? e.message : String(e);
    const summary = summarizeGraphErrorMessage(raw);
    completeness.notes.push(
      `eligibleAssignments (PIM) not available or denied: ${truncateForUi(summary || raw)}`
    );
  }
}

    // -------------------------
    // Build summaries for observed checks
    // -------------------------
    const roleDefinitionsCount = roleTemplates.length;

    const rolesWithAnyActiveAssignmentCount = roleMemberResults.filter((r) => r.counts.total > 0)
      .length;

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
    // Findings: derived from observed checks (completeness-gated)
    // -------------------------
    const nonUserAssignedCount = distribution.group + distribution.servicePrincipal;
    const hasNonUserAssignments = nonUserAssignedCount > 0;

    if (coreComplete && hasNonUserAssignments) {
      await ctx.prisma.finding.create({
        data: {
          runId: ctx.run.id,
          jobId: ctx.job.id,
          checkId: "ENTRA_DIRROLES_001",
          severity: "low",
          title: "Non-user principals assigned to directory roles",
          description:
            "One or more directory role assignments target groups and/or service principals. This increases governance and operational complexity compared to user-only assignments.",
          recommendation:
            "Review group and service principal assignments to directory roles. Confirm business ownership, document access governance, and ensure assignments are intentional and monitored.",
          evidence: {
            assignmentPrincipalTypeCounts: {
              user: distribution.user,
              group: distribution.group,
              servicePrincipal: distribution.servicePrincipal,
              unknown: distribution.unknown
            },
            groupBasedAssignmentsPresent: groupBasedPresent,
            observedChecks: ["ENTRA_DIRROLES_OBS_002", "ENTRA_DIRROLES_OBS_003", "ENTRA_DIRROLES_OBS_005"]
          } as any,
          references: [] as any
        }
      });
    }

    if (coreComplete && groupBasedPresent) {
      await ctx.prisma.finding.create({
        data: {
          runId: ctx.run.id,
          jobId: ctx.job.id,
          checkId: "ENTRA_DIRROLES_002",
          severity: "info",
          title: "Directory roles assigned to groups",
          description:
            "One or more directory roles are assigned to groups rather than directly to individual users. This can be a valid governance pattern, but it increases change-control and troubleshooting complexity.",
          recommendation:
            "Confirm group-based role assignments are intentional and governed. Ensure group ownership is documented, membership changes are controlled, and role assignment groups are monitored.",
          evidence: {
            groupAssignmentsCount,
            groupBasedAssignmentsPresent: groupBasedPresent,
            assignmentPrincipalTypeCounts: {
              user: distribution.user,
              group: distribution.group,
              servicePrincipal: distribution.servicePrincipal,
              unknown: distribution.unknown
            },
            observedChecks: ["ENTRA_DIRROLES_OBS_002", "ENTRA_DIRROLES_OBS_003", "ENTRA_DIRROLES_OBS_005"]
          } as any,
          references: [] as any
        }
      });
    }

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
        isComplete: coreComplete,
        findingEmitted: coreComplete && (hasNonUserAssignments || groupBasedPresent)
      },
      artefacts
    };
  }
};
