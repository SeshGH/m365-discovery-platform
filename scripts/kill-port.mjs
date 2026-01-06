import { execSync } from "node:child_process";

const port = Number(process.argv[2]);
if (!port) {
  console.error("Usage: node scripts/kill-port.mjs <port>");
  process.exit(1);
}

function killWindowsPort(p) {
  const out = execSync(`netstat -ano | findstr :${p}`, { encoding: "utf8" });
  const lines = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => l.includes("LISTENING"));

  const pids = new Set(
    lines
      .map((l) => l.split(/\s+/).pop())
      .filter(Boolean)
  );

  if (pids.size === 0) {
    console.log(`No LISTENING process found on port ${p}`);
    return;
  }

  for (const pid of pids) {
    console.log(`Killing PID ${pid} on port ${p}...`);
    try {
      execSync(`taskkill /F /PID ${pid}`, { stdio: "inherit" });
    } catch {
      // swallow – taskkill prints its own output
    }
  }
}

function killUnixPort(p) {
  try {
    const pid = execSync(`lsof -ti tcp:${p} -sTCP:LISTEN`, { encoding: "utf8" }).trim();
    if (!pid) {
      console.log(`No LISTENING process found on port ${p}`);
      return;
    }
    console.log(`Killing PID ${pid} on port ${p}...`);
    execSync(`kill -9 ${pid}`, { stdio: "inherit" });
  } catch {
    console.log(`No LISTENING process found on port ${p}`);
  }
}

if (process.platform === "win32") {
  try {
    killWindowsPort(port);
  } catch {
    console.log(`No LISTENING process found on port ${port}`);
  }
} else {
  killUnixPort(port);
}
