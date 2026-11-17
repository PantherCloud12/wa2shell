/**
 * Direct Bash / Shell Execution Utility
 * Safely executes bash commands with configurable timeout, active process tracking,
 * and emergency process termination.
 */

const { exec } = require("child_process");

// Track running shell processes per WhatsApp chat (JID)
const activeShellProcesses = new Map();

function executeShell(command, options = {}) {
  const timeoutMs = options.timeoutMs || 45000;
  const maxBuffer = options.maxBuffer || 1024 * 1024 * 5; // 5 MB
  const jid = options.jid || "global";

  return new Promise((resolve) => {
    const startTime = Date.now();

    const child = exec(
      command,
      {
        timeout: timeoutMs,
        maxBuffer,
        shell: "/bin/bash",
      },
      (error, stdout, stderr) => {
        activeShellProcesses.delete(jid);

        const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
        const exitCode = error ? (typeof error.code === "number" ? error.code : 1) : 0;

        let output = stdout || "";
        if (stderr) {
          if (output) output += "\n";
          output += stderr;
        }

        resolve({
          exitCode,
          output: output.trim(),
          durationSec,
          killed: Boolean(error && error.killed),
          signal: error ? error.signal : null,
        });
      }
    );

    activeShellProcesses.set(jid, {
      child,
      command,
      startedAt: startTime,
    });
  });
}

function killShell(jid) {
  const proc = activeShellProcesses.get(jid);
  if (!proc || !proc.child) return false;
  try {
    proc.child.kill("SIGKILL");
    activeShellProcesses.delete(jid);
    return true;
  } catch (_) {
    return false;
  }
}

function getActiveShells() {
  const list = [];
  activeShellProcesses.forEach((val, key) => {
    list.push({
      jid: key,
      pid: val.child ? val.child.pid : null,
      command: val.command,
      elapsedSec: ((Date.now() - val.startedAt) / 1000).toFixed(1),
    });
  });
  return list;
}

module.exports = {
  executeShell,
  killShell,
  getActiveShells,
};
