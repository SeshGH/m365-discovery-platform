import type { Collector, CollectorContext, CollectorResult } from "../contracts.js";

function toCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // CSV escape: wrap in quotes if it contains comma/quote/newline, and double any quotes
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function usersToCsv(users: Array<any>): string {
  const header = ["id", "displayName", "userPrincipalName", "accountEnabled"];
  const rows = users.map((u) => [
    toCsvValue(u.id),
    toCsvValue(u.displayName),
    toCsvValue(u.userPrincipalName),
    toCsvValue(u.accountEnabled),
  ]);

  return [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

export const entraUsersCollector: Collector = async (_ctx: CollectorContext): Promise<CollectorResult> => {
  const startedAt = new Date().toISOString();

  // TODO: Replace stub data with real Graph calls
  const users = [
    {
      id: "u1",
      displayName: "Example User",
      userPrincipalName: "user@example.com",
      accountEnabled: true,
    },
  ];

  const csv = usersToCsv(users);

  const finishedAt = new Date().toISOString();

  return {
    id: "entra.users",
    title: "Entra ID - Users report",
    status: "ok",
    startedAt,
    finishedAt,
    summary: { totalUsers: users.length },
    data: { users },
    artefacts: [
      {
        type: "csv",
        filename: "entra-users.csv",
        contentType: "text/csv",
        content: csv,
      },
    ],
  };
};
