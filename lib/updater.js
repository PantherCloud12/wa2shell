/**
 * Repository Auto-Update Engine & Schedule (v1.4.0)
 * Manages automated Git updates, remote branch polling, zero-downtime hot-reload after pull,
 * and scheduled background checks for wa2shell.
 */

const { execSync, exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const config = require("../config");
const { logAuditEvent } = require("./audit");

const REPO_DIR = config.paths.root;

// Persistent updater state across module hot-reloads
global.__wa2shell_updater_state = global.__wa2shell_updater_state || {
  enabled: config.updater?.enabled || false,
  intervalMinutes: config.updater?.intervalMinutes || 60,
  autoApply: config.updater?.autoApply || false,
  branch: config.updater?.branch || "main",
  lastCheckTime: null,
  lastCheckResult: null,
  timer: null,
  sock: null,
  notifyJid: null,
  reloadModulesFn: null,
};

const state = global.__wa2shell_updater_state;

function runGit(cmd, timeoutMs = 25000) {
  return execSync(cmd, {
    cwd: REPO_DIR,
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * Retrieves the current local Git state (branch, commit, message, author, remote).
 */
function getCurrentGitInfo() {
  try {
    const branch = runGit("git rev-parse --abbrev-ref HEAD");
    const commit = runGit("git rev-parse HEAD");
    const shortCommit = runGit("git rev-parse --short HEAD");
    const commitInfo = runGit('git log -1 --format="%s (%cr) [%an]"');
    const remoteUrl = runGit("git config --get remote.origin.url || echo 'None'");

    return {
      success: true,
      branch,
      commit,
      shortCommit,
      commitInfo,
      remoteUrl,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Fetches remote origin and checks if newer commits exist on GitHub.
 */
async function checkGitUpdate() {
  return new Promise((resolve) => {
    exec("git fetch origin", { cwd: REPO_DIR, timeout: 30000 }, (err) => {
      state.lastCheckTime = Date.now();

      if (err) {
        state.lastCheckResult = `Fetch failed: ${err.message}`;
        return resolve({
          hasUpdate: false,
          error: `Failed to fetch from remote origin: ${err.message}`,
        });
      }

      try {
        const branch = runGit("git rev-parse --abbrev-ref HEAD");
        const localCommit = runGit("git rev-parse HEAD");
        const localShort = runGit("git rev-parse --short HEAD");

        let remoteCommit = "";
        try {
          remoteCommit = runGit(`git rev-parse origin/${branch}`);
        } catch (_) {
          remoteCommit = runGit("git rev-parse @{u}");
        }
        const remoteShort = remoteCommit.slice(0, 7);

        if (localCommit === remoteCommit) {
          state.lastCheckResult = "Up-to-date";
          return resolve({
            hasUpdate: false,
            branch,
            localCommit,
            localShort,
            remoteShort,
            message: "wa2shell is already up-to-date with remote origin.",
          });
        }

        // Commits behind
        const countStr = runGit(`git rev-list --count HEAD..${remoteCommit}`);
        const behindCount = parseInt(countStr, 10) || 1;
        const commitsLog = runGit(`git log HEAD..${remoteCommit} --oneline -n 10`);

        state.lastCheckResult = `${behindCount} new commit(s) available`;
        return resolve({
          hasUpdate: true,
          branch,
          behindCount,
          localShort,
          remoteShort,
          commitsLog,
        });
      } catch (checkErr) {
        state.lastCheckResult = `Check error: ${checkErr.message}`;
        return resolve({
          hasUpdate: false,
          error: checkErr.message,
        });
      }
    });
  });
}

/**
 * Executes git pull, installs dependencies if package.json changed, and hot-reloads.
 */
async function applyGitUpdate(options = {}) {
  const current = getCurrentGitInfo();
  if (!current.success) {
    throw new Error(`Git environment error: ${current.error}`);
  }

  const branch = current.branch;
  const oldShort = current.shortCommit;

  // Stash local modifications if working tree is dirty
  let stashed = false;
  try {
    const status = runGit("git status --porcelain");
    if (status) {
      runGit("git stash push -m 'wa2shell_auto_update_stash'");
      stashed = true;
    }
  } catch (_) {}

  // Perform git pull
  try {
    runGit(`git pull origin ${branch}`);
  } catch (pullErr) {
    // If pull failed and we stashed, restore stash
    if (stashed) {
      try { runGit("git stash pop"); } catch (_) {}
    }
    throw new Error(`Git pull failed: ${pullErr.message}`);
  }

  // Restore stash if needed
  if (stashed) {
    try { runGit("git stash pop"); } catch (_) {}
  }

  const newInfo = getCurrentGitInfo();
  const newShort = newInfo.shortCommit;

  // Check if package.json changed
  let npmInstalled = false;
  try {
    const diffFiles = runGit(`git diff --name-only ${oldShort} ${newShort}`);
    if (diffFiles.includes("package.json")) {
      runGit("npm install --omit=dev", 90000);
      npmInstalled = true;
    }
  } catch (_) {}

  // Trigger hot reload
  let reloaded = false;
  if (options.reloadModules || state.reloadModulesFn) {
    try {
      const reloadFn = options.reloadModules || state.reloadModulesFn;
      reloadFn();
      reloaded = true;
    } catch (_) {}
  }

  const logList = runGit(`git log ${oldShort}..${newShort} --oneline || echo ''`);

  logAuditEvent({
    type: "GIT_UPDATE",
    sender: options.sender || "SYSTEM",
    command: `git pull origin ${branch} (${oldShort} -> ${newShort})`,
    status: "SUCCESS",
  });

  return {
    success: true,
    branch,
    oldShort,
    newShort,
    logList,
    npmInstalled,
    reloaded,
  };
}

/**
 * Starts or updates background auto-updater schedule.
 */
function startAutoUpdater(sock, notifyJid, reloadModulesFn, options = {}) {
  if (sock) state.sock = sock;
  if (notifyJid) state.notifyJid = notifyJid;
  if (reloadModulesFn) state.reloadModulesFn = reloadModulesFn;

  if (typeof options.enabled === "boolean") state.enabled = options.enabled;
  if (options.intervalMinutes) state.intervalMinutes = Math.max(5, options.intervalMinutes);
  if (typeof options.autoApply === "boolean") state.autoApply = options.autoApply;

  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }

  if (!state.enabled) {
    return {
      status: "DISABLED",
      intervalMinutes: state.intervalMinutes,
      autoApply: state.autoApply,
    };
  }

  const intervalMs = state.intervalMinutes * 60 * 1000;

  state.timer = setInterval(async () => {
    try {
      const checkRes = await checkGitUpdate();
      if (!checkRes.hasUpdate) return;

      if (state.autoApply) {
        // Auto pull and notify
        const updateRes = await applyGitUpdate({
          sender: "AUTO_SCHEDULER",
          reloadModules: state.reloadModulesFn,
        });

        if (state.sock && state.notifyJid) {
          const alertMsg =
            `⚡ *wa2shell Automated Update Applied!*\n` +
            `• Branch: \`${updateRes.branch}\`\n` +
            `• Version: \`${updateRes.oldShort}\` ➜ \`${updateRes.newShort}\`\n` +
            `• Dependencies: ${updateRes.npmInstalled ? "*npm install performed*" : "_No change_"}\n` +
            `• Hot-Reload: ${updateRes.reloaded ? "*Refreshed (Zero Downtime)*" : "_Manual restart required_"}\n\n` +
            `*Latest Commits:*\n\`\`\`\n${updateRes.logList || "Updated."}\n\`\`\``;

          await state.sock.sendMessage(state.notifyJid, { text: alertMsg });
        }
      } else {
        // Only notify
        if (state.sock && state.notifyJid) {
          const alertMsg =
            `🔔 *wa2shell Update Available on GitHub!*\n` +
            `• Commits Behind: *${checkRes.behindCount}*\n` +
            `• Local: \`${checkRes.localShort}\` | Remote: \`${checkRes.remoteShort}\`\n\n` +
            `*Commits Pending:*\n\`\`\`\n${checkRes.commitsLog}\n\`\`\`\n` +
            `Type \`.update pull\` to apply this update now.`;

          await state.sock.sendMessage(state.notifyJid, { text: alertMsg });
        }
      }
    } catch (err) {
      console.error("[wa2shell] AutoUpdater check error:", err.message);
    }
  }, intervalMs);

  return {
    status: "ACTIVE",
    intervalMinutes: state.intervalMinutes,
    autoApply: state.autoApply,
    nextCheckIn: `${state.intervalMinutes}m`,
  };
}

function stopAutoUpdater() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  state.enabled = false;
  return { status: "STOPPED" };
}

function getAutoUpdaterStatus() {
  const gitInfo = getCurrentGitInfo();
  return {
    enabled: state.enabled,
    intervalMinutes: state.intervalMinutes,
    autoApply: state.autoApply,
    lastCheckTime: state.lastCheckTime ? new Date(state.lastCheckTime).toISOString() : "Never",
    lastCheckResult: state.lastCheckResult || "None",
    git: gitInfo,
  };
}

module.exports = {
  getCurrentGitInfo,
  checkGitUpdate,
  applyGitUpdate,
  startAutoUpdater,
  stopAutoUpdater,
  getAutoUpdaterStatus,
};
