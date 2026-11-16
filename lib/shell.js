/**
 * Direct Bash / Shell Execution Utility
 * Safely executes bash commands with configurable timeout and output formatting.
 */

const { exec } = require("child_process");

function executeShell(command, options = {}) {
  const timeoutMs = options.timeoutMs || 30000;
  const maxBuffer = options.maxBuffer || 1024 * 1024 * 5; // 5 MB

  return new Promise((resolve) => {
    const startTime = Date.now();

    exec(
      command,
      {
        timeout: timeoutMs,
        maxBuffer,
        shell: "/bin/bash",
      },
      (error, stdout, stderr) => {
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
          killed: error && error.killed,
        });
      }
    );
  });
}

module.exports = {
  executeShell,
};
