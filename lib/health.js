/**
 * System Health Diagnostic & Self-Healing / Recovery Engine (v1.4.0)
 * Performs in-depth health audits, memory and process inspection, automated tmp cleanup,
 * zombie process termination, and autonomous background self-healing for wa2shell.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const config = require("../config");
const { logAuditEvent } = require("./audit");
const { formatBytes, renderProgressBar, formatDuration } = require("./sysinfo");
const { getActiveShells, killShell } = require("./shell");
const { getActiveAgents, killAgent } = require("./agy_bridge");

const TMP_DIR = config.paths.tmp;
const SESSION_DIR = config.paths.session;

// Persistent health state across hot-reloads
global.__wa2shell_health_state = global.__wa2shell_health_state || {
  watchdogEnabled: config.health?.autoRecovery !== false,
  intervalMinutes: config.health?.checkIntervalMinutes || 15,
  memThresholdPercent: config.health?.memThresholdPercent || 85,
  diskThresholdPercent: config.health?.diskThresholdPercent || 90,
  tmpMaxMb: config.health?.tmpMaxMb || 300,
  lastCheckTime: null,
  lastHealthVerdict: "OPTIMAL",
  recoveryHistory: [],
  timer: null,
  sock: null,
  notifyJid: null,
  reloadModulesFn: null,
};

const state = global.__wa2shell_health_state;

/**
 * Calculates directory size and file count recursively.
 */
function getDirectoryStats(dirPath) {
  if (!fs.existsSync(dirPath)) return { size: 0, count: 0 };
  let totalBytes = 0;
  let fileCount = 0;

  function walk(current) {
    try {
      const files = fs.readdirSync(current, { withFileTypes: true });
      for (const file of files) {
        const full = path.join(current, file.name);
        if (file.isDirectory()) {
          walk(full);
        } else if (file.isFile()) {
          try {
            const stat = fs.statSync(full);
            totalBytes += stat.size;
            fileCount++;
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  walk(dirPath);
  return { size: totalBytes, count: fileCount };
}

/**
 * Gathers complete system health metrics and diagnostic anomalies.
 */
function getSystemHealth() {
  const cpus = os.cpus();
  const cpuCount = cpus.length || 1;
  const loadAvg = os.loadavg();
  const normalizedLoad1m = ((loadAvg[0] / cpuCount) * 100).toFixed(1);

  // Memory metrics
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  let availMem = freeMem;
  let swapTotal = 0;
  let swapUsed = 0;

  try {
    if (fs.existsSync("/proc/meminfo")) {
      const meminfo = fs.readFileSync("/proc/meminfo", "utf8");
      const map = {};
      meminfo.split("\n").forEach((line) => {
        const p = line.split(":");
        if (p.length === 2) map[p[0].trim()] = parseInt(p[1].trim(), 10) * 1024;
      });
      if (map.MemAvailable) availMem = map.MemAvailable;
      if (map.SwapTotal) swapTotal = map.SwapTotal;
      if (map.SwapFree) swapUsed = swapTotal - map.SwapFree;
    }
  } catch (_) {}

  const usedMem = totalMem - availMem;
  const memPercent = (usedMem / totalMem) * 100;
  const swapPercent = swapTotal > 0 ? (swapUsed / swapTotal) * 100 : 0;

  // Process Memory (Node.js)
  const nodeMem = process.memoryUsage();

  // Root Disk metrics
  let diskTotal = 0;
  let diskUsed = 0;
  let diskFree = 0;
  let diskPercent = 0;
  try {
    const dfOut = execSync("df -B1 / | tail -n 1", { encoding: "utf8" }).trim();
    const parts = dfOut.split(/\s+/);
    if (parts.length >= 5) {
      diskTotal = parseInt(parts[1], 10) || 0;
      diskUsed = parseInt(parts[2], 10) || 0;
      diskFree = parseInt(parts[3], 10) || 0;
      diskPercent = parseFloat(parts[4].replace("%", "")) || 0;
    }
  } catch (_) {}

  // Storage Stats
  const tmpStats = getDirectoryStats(TMP_DIR);
  const sessionStats = getDirectoryStats(SESSION_DIR);

  // Active Tasks & Hung/Zombie Detection
  const activeShells = getActiveShells();
  const activeAgents = getActiveAgents();

  // Shell running > 3 minutes is flagged as potentially hung
  const hungShells = activeShells.filter((s) => parseFloat(s.elapsedSec) > 180);
  // Agent running > 10 minutes is flagged as potentially hung
  const hungAgents = activeAgents.filter((a) => parseFloat(a.elapsedSec) > 600);

  // Diagnostic Findings
  const issues = [];
  if (memPercent >= state.memThresholdPercent) {
    issues.push(`Memory usage high (${memPercent.toFixed(1)}% >= ${state.memThresholdPercent}%)`);
  }
  if (diskPercent >= state.diskThresholdPercent) {
    issues.push(`Disk space critical (${diskPercent.toFixed(1)}% >= ${state.diskThresholdPercent}%)`);
  }
  if (tmpStats.size > state.tmpMaxMb * 1024 * 1024) {
    issues.push(`Tmp storage bloated (${formatBytes(tmpStats.size)} >= ${state.tmpMaxMb}MB)`);
  }
  if (hungShells.length > 0) {
    issues.push(`${hungShells.length} long-running/hung shell task(s) detected`);
  }
  if (hungAgents.length > 0) {
    issues.push(`${hungAgents.length} long-running/hung agent job(s) detected`);
  }

  // Determine overall verdict
  let verdict = "OPTIMAL";
  let statusEmoji = "🟢";
  if (memPercent >= 92 || diskPercent >= 92) {
    verdict = "CRITICAL";
    statusEmoji = "🔴";
  } else if (issues.length > 0) {
    verdict = "WARNING";
    statusEmoji = "🟡";
  }

  state.lastHealthVerdict = verdict;
  state.lastCheckTime = Date.now();

  return {
    verdict,
    statusEmoji,
    issues,
    cpu: {
      count: cpuCount,
      load1m: loadAvg[0].toFixed(2),
      load5m: loadAvg[1].toFixed(2),
      load15m: loadAvg[2].toFixed(2),
      normalizedPercent: normalizedLoad1m,
    },
    memory: {
      total: formatBytes(totalMem),
      used: formatBytes(usedMem),
      avail: formatBytes(availMem),
      percent: memPercent,
      bar: renderProgressBar(memPercent, 10),
      nodeRss: formatBytes(nodeMem.rss),
      nodeHeap: formatBytes(nodeMem.heapUsed),
      swapTotal: formatBytes(swapTotal),
      swapUsed: formatBytes(swapUsed),
      swapPercent,
    },
    disk: {
      total: formatBytes(diskTotal),
      used: formatBytes(diskUsed),
      free: formatBytes(diskFree),
      percent: diskPercent,
      bar: renderProgressBar(diskPercent, 10),
    },
    storage: {
      tmpSize: formatBytes(tmpStats.size),
      tmpFiles: tmpStats.count,
      sessionSize: formatBytes(sessionStats.size),
      sessionFiles: sessionStats.count,
    },
    tasks: {
      activeShells: activeShells.length,
      activeAgents: activeAgents.length,
      hungShells: hungShells.length,
      hungAgents: hungAgents.length,
    },
    uptime: {
      system: formatDuration(os.uptime()),
      process: formatDuration(process.uptime()),
    },
  };
}

/**
 * Builds a clean WhatsApp formatted diagnostic card.
 */
function formatHealthReport() {
  const h = getSystemHealth();

  let text =
    `🏥 *wa2shell System Health Diagnostic (v1.4.0)*\n` +
    `Overall Verdict: ${h.statusEmoji} *${h.verdict}*\n` +
    `────────────────────────────\n\n` +
    `🧠 *RAM & Heap Allocation:*\n` +
    `• OS RAM: ${h.memory.bar} (${h.memory.used} / ${h.memory.total})\n` +
    `• Process RSS: \`${h.memory.nodeRss}\` | Heap: \`${h.memory.nodeHeap}\`\n` +
    `• Swap Usage: \`${h.memory.swapUsed} / ${h.memory.swapTotal}\` (${h.memory.swapPercent.toFixed(1)}%)\n\n` +
    `⚙️ *CPU & Processing:*\n` +
    `• Cores: ${h.cpu.count}x Cores\n` +
    `• Load Average: \`${h.cpu.load1m}\`, \`${h.cpu.load5m}\`, \`${h.cpu.load15m}\`\n` +
    `• Estimated Load: \`${h.cpu.normalizedPercent}%\`\n\n` +
    `💾 *Storage & Partitions:*\n` +
    `• Root Disk: ${h.disk.bar} (${h.disk.used} / ${h.disk.total})\n` +
    `• Tmp Scratch: \`${h.storage.tmpSize}\` (${h.storage.tmpFiles} files)\n` +
    `• Session Store: \`${h.storage.sessionSize}\` (${h.storage.sessionFiles} files)\n\n` +
    `⏱️ *Uptime & Runtime:*\n` +
    `• Host Uptime: \`${h.uptime.system}\`\n` +
    `• Node Daemon: \`${h.uptime.process}\`\n` +
    `• Active Shell Tasks: *${h.tasks.activeShells}* (${h.tasks.hungShells} hung)\n` +
    `• Active Agent Jobs: *${h.tasks.activeAgents}* (${h.tasks.hungAgents} hung)\n`;

  if (h.issues.length > 0) {
    text += `\n⚠️ *Diagnostic Alerts:*\n`;
    h.issues.forEach((issue) => {
      text += `• ${issue}\n`;
    });
    text += `\n_Tip: Run \`.heal\` or \`.recovery\` to trigger automatic cleanup._`;
  } else {
    text += `\n✅ *All systems running smoothly and within safe thresholds.*`;
  }

  return text;
}

/**
 * Executes system self-healing, purging garbage files, terminating hung processes,
 * defragmenting memory, and restoring module stability.
 */
async function performSelfHealing(options = {}) {
  const startTime = Date.now();
  const maxAgeHours = options.maxAgeHours || 6;
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const now = Date.now();

  let filesDeleted = 0;
  let bytesReclaimed = 0;

  // 1. Clean Temporary Scratch Files (tmp/)
  try {
    if (fs.existsSync(TMP_DIR)) {
      const files = fs.readdirSync(TMP_DIR);
      for (const file of files) {
        // Never delete audit.log, .gitkeep, or active session files
        if (file === "audit.log" || file === ".gitkeep" || file.startsWith("session")) continue;

        const filePath = path.join(TMP_DIR, file);
        try {
          const stat = fs.statSync(filePath);
          const age = now - stat.mtimeMs;
          if (options.force || age > maxAgeMs) {
            bytesReclaimed += stat.size;
            fs.unlinkSync(filePath);
            filesDeleted++;
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    console.error("[wa2shell] [SelfHealing] Tmp cleanup error:", err.message);
  }

  // 2. Kill Hung / Zombie Shell and Agent Processes
  let zombieTasksKilled = 0;
  try {
    const activeShells = getActiveShells();
    for (const shell of activeShells) {
      if (parseFloat(shell.elapsedSec) > 180 || options.force) {
        killShell(shell.jid);
        zombieTasksKilled++;
      }
    }

    const activeAgents = getActiveAgents();
    for (const agent of activeAgents) {
      if (parseFloat(agent.elapsedSec) > 600 || options.force) {
        killAgent(agent.jid);
        zombieTasksKilled++;
      }
    }
  } catch (err) {
    console.error("[wa2shell] [SelfHealing] Task cleanup error:", err.message);
  }

  // 3. V8 Garbage Collection & Cache Release
  let gcExecuted = false;
  try {
    if (typeof global.gc === "function") {
      global.gc();
      gcExecuted = true;
    }
  } catch (_) {}

  // 4. Hot-Reload Modules to Flush Stale Memory
  let modulesReloaded = false;
  if (options.reloadModules || state.reloadModulesFn) {
    try {
      const reloadFn = options.reloadModules || state.reloadModulesFn;
      reloadFn();
      modulesReloaded = true;
    } catch (_) {}
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  const result = {
    success: true,
    durationSec,
    filesDeleted,
    reclaimedStr: formatBytes(bytesReclaimed),
    zombieTasksKilled,
    gcExecuted,
    modulesReloaded,
    timestamp: new Date().toISOString(),
  };

  state.recoveryHistory.unshift(result);
  if (state.recoveryHistory.length > 10) state.recoveryHistory.pop();

  logAuditEvent({
    type: "SELF_HEALING",
    sender: options.sender || "SYSTEM",
    command: `recovery (freed ${formatBytes(bytesReclaimed)}, killed ${zombieTasksKilled})`,
    status: "SUCCESS",
  });

  return result;
}

/**
 * Initializes autonomous background health watchdog.
 */
function startHealthWatchdog(sock, notifyJid, reloadModulesFn, options = {}) {
  if (sock) state.sock = sock;
  if (notifyJid) state.notifyJid = notifyJid;
  if (reloadModulesFn) state.reloadModulesFn = reloadModulesFn;

  if (typeof options.enabled === "boolean") state.watchdogEnabled = options.enabled;
  if (options.intervalMinutes) state.intervalMinutes = Math.max(5, options.intervalMinutes);
  if (options.memThresholdPercent) state.memThresholdPercent = options.memThresholdPercent;

  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }

  if (!state.watchdogEnabled) {
    return {
      status: "DISABLED",
      intervalMinutes: state.intervalMinutes,
    };
  }

  const intervalMs = state.intervalMinutes * 60 * 1000;

  state.timer = setInterval(async () => {
    try {
      const health = getSystemHealth();

      // Trigger self-healing if memory or disk is critical or hung tasks detected
      if (health.verdict !== "OPTIMAL") {
        console.log(`[wa2shell] [HealthWatchdog] Anomaly detected (${health.verdict}). Initiating self-healing...`);

        const recoveryRes = await performSelfHealing({
          sender: "HEALTH_WATCHDOG",
          reloadModules: state.reloadModulesFn,
        });

        // Notify owner if critical
        if (health.verdict === "CRITICAL" && state.sock && state.notifyJid) {
          const alertMsg =
            `🚨 *wa2shell Autonomous Recovery Alert!*\n` +
            `• Health State: *${health.verdict}*\n` +
            `• Issues: ${health.issues.join(", ")}\n\n` +
            `*Recovery Actions Taken:*\n` +
            `• Temp Files Purged: *${recoveryRes.filesDeleted}* (${recoveryRes.reclaimedStr})\n` +
            `• Zombie Tasks Killed: *${recoveryRes.zombieTasksKilled}*\n` +
            `• Hot-Reload Refreshed: *${recoveryRes.modulesReloaded ? "Yes" : "No"}*\n\n` +
            `Type \`.health\` to inspect current telemetry.`;

          await state.sock.sendMessage(state.notifyJid, { text: alertMsg });
        }
      }
    } catch (err) {
      console.error("[wa2shell] HealthWatchdog tick error:", err.message);
    }
  }, intervalMs);

  return {
    status: "ACTIVE",
    intervalMinutes: state.intervalMinutes,
    memThreshold: `${state.memThresholdPercent}%`,
  };
}

function stopHealthWatchdog() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  state.watchdogEnabled = false;
  return { status: "STOPPED" };
}

function getHealthWatchdogStatus() {
  return {
    watchdogEnabled: state.watchdogEnabled,
    intervalMinutes: state.intervalMinutes,
    lastCheckTime: state.lastCheckTime ? new Date(state.lastCheckTime).toISOString() : "Never",
    lastVerdict: state.lastHealthVerdict,
    historyCount: state.recoveryHistory.length,
  };
}

module.exports = {
  getSystemHealth,
  formatHealthReport,
  performSelfHealing,
  startHealthWatchdog,
  stopHealthWatchdog,
  getHealthWatchdogStatus,
};
