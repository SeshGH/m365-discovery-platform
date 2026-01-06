import { execSync } from "node:child_process";

const needle = "apps\\worker\\src\\index.ts";

// We use PowerShell to find node.exe processes whose command line includes the worker entrypoint,
// then stop them. This avoids killing "all node.exe" on your machine.
const ps = `
$procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like "*${needle}*" }
if (-not $procs) {
  Write-Host "No worker node.exe process found"
  exit 0
}
$procs | ForEach-Object {
  Write-Host ("Stopping worker PID " + $_.ProcessId)
  Stop-Process -Id $_.ProcessId -Force
}
`;

try {
  execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, {
    stdio: "inherit"
  });
} catch {
  // PowerShell prints its own output; keep this quiet
}
