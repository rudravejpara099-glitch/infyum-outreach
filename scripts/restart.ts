// Restarts the web app properly: stops whatever holds port 3000 (next-server keeps it even after `next start` is killed), rebuilds, starts again.
import { execFileSync, spawn } from "node:child_process";
try {
  for (const pid of execFileSync("lsof", ["-ti", ":3000"], { encoding: "utf8" }).split("\n").filter(Boolean)) process.kill(Number(pid));
} catch { /* nothing was running */ }
execFileSync("npm", ["run", "build"], { stdio: "inherit" });
spawn("npm", ["start"], { detached: true, stdio: "ignore" }).unref();
console.log("The app is starting at http://localhost:3000");
