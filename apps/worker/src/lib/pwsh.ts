import { spawn } from "node:child_process";

export type PwshRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function truncate(s: string, max = 4000) {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…(truncated)";
}

/**
 * Runs PowerShell (pwsh) with a provided script and returns stdout/stderr.
 *
 * - Uses: -NoProfile -NonInteractive -ExecutionPolicy Bypass
 * - Supports timeout
 * - Throws on spawn failure, but does NOT throw on non-zero exit (caller decides)
 */
export async function runPwsh(params: {
  script: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
}): Promise<PwshRunResult> {
  const timeoutMs = typeof params.timeoutMs === "number" ? params.timeoutMs : 120_000;

  // Prefer passing env via process env (plus overrides)
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...(params.env ?? {}) };

  // Use -Command with a single string (works on Windows + pwsh)
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    params.script
  ];

  return await new Promise<PwshRunResult>((resolve, reject) => {
    const child = spawn("pwsh", args, {
      env: childEnv,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      stdout += d.toString("utf8");
    });

    child.stderr.on("data", (d) => {
      stderr += d.toString("utf8");
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: typeof code === "number" ? code : 1,
        stdout,
        stderr
      });
    });
  });
}

/**
 * Convenience: expects PowerShell to output a single JSON object to stdout.
 * Trims whitespace and parses JSON.
 *
 * If parsing fails, returns a typed error including truncated stdout/stderr.
 */
export async function runPwshJson<T>(params: {
  script: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
}): Promise<{ ok: true; value: T } | { ok: false; error: string; details: PwshRunResult }> {
  const res = await runPwsh(params);

  const out = res.stdout.trim();
  if (res.exitCode !== 0) {
    return {
      ok: false,
      error: `pwsh exited non-zero (code=${res.exitCode})`,
      details: { ...res, stdout: truncate(res.stdout), stderr: truncate(res.stderr) }
    };
  }

  if (!isNonEmptyString(out)) {
    return {
      ok: false,
      error: "pwsh produced no stdout (expected JSON)",
      details: { ...res, stdout: truncate(res.stdout), stderr: truncate(res.stderr) }
    };
  }

  try {
    const parsed = JSON.parse(out) as T;
    return { ok: true, value: parsed };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: `pwsh stdout was not valid JSON: ${msg}`,
      details: { ...res, stdout: truncate(res.stdout), stderr: truncate(res.stderr) }
    };
  }
}
