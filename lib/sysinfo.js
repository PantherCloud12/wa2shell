/**
 * Hardware & Telemetry Diagnostics Engine
 * Generates structured, visual ASCII telemetry reports for CPU, Memory, Disk,
 * Uptime, and Top Process Consumers without third-party dependencies.
 */

const os = require("os");
const fs = require("fs");
const { execSync } = require("child_process");

function renderProgressBar(percentage, length = 10) {
  const clamped = Math.max(0, Math.min(100, isNaN(percentage) ? 0 : percentage));
  const filled = Math.round((clamped / 100) * length);
  const empty = length - filled;
  return "[" + "█".repeat(filled) + "░".repeat(empty) + "] " + clamped.toFixed(1) + "%";
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function formatDuration(seconds) {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

/**
 * Extracts accurate memory and swap metrics from /proc/meminfo if on Linux.
 */
function getMemoryMetrics() {
  try {
    if (fs.existsSync("/proc/meminfo")) {
      const content = fs.readFileSync("/proc/meminfo", "utf8");
      const map = {};
      content.split("\n").forEach((line) => {
        const parts = line.split(":");
        if (parts.length === 2) {
          map[parts[0].trim()] = parseInt(parts[1].trim(), 10) * 1024;
        }
      });

      const totalMem = map.MemTotal || os.totalmem();
      const availMem = map.MemAvailable || os.freemem();
      const usedMem = totalMem - availMem;
      const memPercent = (usedMem / totalMem) * 100;

      const totalSwap = map.SwapTotal || 0;
      const freeSwap = map.SwapFree || 0;
      const usedSwap = totalSwap - freeSwap;
      const swapPercent = totalSwap > 0 ? (usedSwap / totalSwap) * 100 : 0;

      return {
        totalMem,
        usedMem,
        availMem,
        memPercent,
        totalSwap,
        usedSwap,
        freeSwap,
        swapPercent,
      };
    }
  } catch (_) {}

  // Fallback to standard os module
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    totalMem: total,
    usedMem: used,
    availMem: free,
    memPercent: (used / total) * 100,
    totalSwap: 0,
    usedSwap: 0,
    freeSwap: 0,
    swapPercent: 0,
  };
}

/**
 * Obtains root filesystem disk statistics via df.
 */
function getDiskMetrics() {
  try {
    const raw = execSync("df -k / | tail -n 1", { encoding: "utf8" }).trim();
    const parts = raw.split(/\s+/);
    if (parts.length >= 6) {
      const totalBytes = parseInt(parts[1], 10) * 1024;
      const usedBytes = parseInt(parts[2], 10) * 1024;
      const availBytes = parseInt(parts[3], 10) * 1024;
      const percent = (usedBytes / totalBytes) * 100;
      return {
        filesystem: parts[0],
        totalBytes,
        usedBytes,
        availBytes,
        percent,
        mount: parts[5],
      };
    }
  } catch (_) {}
  return null;
}

/**
 * Retrieves top resource-consuming processes.
 */
function getTopProcesses() {
  let topCpu = "";
  let topMem = "";

  try {
    topCpu = execSync("ps -eo pid,user,%cpu,%mem,comm --sort=-%cpu | head -n 6", {
      encoding: "utf8",
    }).trim();
  } catch (_) {}

  try {
    topMem = execSync("ps -eo pid,user,%mem,%cpu,comm --sort=-%mem | head -n 6", {
      encoding: "utf8",
    }).trim();
  } catch (_) {}

  return { topCpu, topMem };
}

/**
 * Compiles a comprehensive, beautiful telemetry report suitable for WhatsApp.
 */
function getSystemReport() {
  const cpus = os.cpus();
  const cpuModel = cpus && cpus[0] ? cpus[0].model.replace(/\s+/g, " ") : "Unknown CPU";
  const cpuCores = cpus ? cpus.length : 1;
  const load = os.loadavg();
  const uptime = formatDuration(os.uptime());
  const mem = getMemoryMetrics();
  const disk = getDiskMetrics();
  const { topCpu, topMem } = getTopProcesses();

  let text = `🖥️ *SYSTEM TELEMETRY & HARDWARE MONITOR*\n\n`;
  text += `*Host Details:*\n`;
  text += `• Hostname: \`${os.hostname()}\`\n`;
  text += `• OS: \`${os.type()} ${os.release()} (${os.arch()})\`\n`;
  text += `• Node.js: \`${process.version}\`\n`;
  text += `• Uptime: *${uptime}*\n\n`;

  text += `*Processor (${cpuCores} Cores):*\n`;
  text += `• Model: \`${cpuModel}\`\n`;
  text += `• Load Average: \`${load[0].toFixed(2)}\` (1m), \`${load[1].toFixed(2)}\` (5m), \`${load[2].toFixed(2)}\` (15m)\n\n`;

  text += `*Memory Usage:*\n`;
  text += `• RAM: ${renderProgressBar(mem.memPercent)} (${formatBytes(mem.usedMem)} / ${formatBytes(mem.totalMem)})\n`;
  text += `• Available: \`${formatBytes(mem.availMem)}\`\n`;
  if (mem.totalSwap > 0) {
    text += `• Swap: ${renderProgressBar(mem.swapPercent)} (${formatBytes(mem.usedSwap)} / ${formatBytes(mem.totalSwap)})\n`;
  }
  text += `\n`;

  if (disk) {
    text += `*Disk Storage (${disk.mount}):*\n`;
    text += `• Root: ${renderProgressBar(disk.percent)} (${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)})\n`;
    text += `• Free Space: \`${formatBytes(disk.availBytes)}\`\n\n`;
  }

  if (topCpu) {
    text += `*Top CPU Consumers:*\n\`\`\`\n${topCpu}\n\`\`\`\n\n`;
  }

  if (topMem) {
    text += `*Top Memory Consumers:*\n\`\`\`\n${topMem}\n\`\`\``;
  }

  return text;
}

module.exports = {
  renderProgressBar,
  formatBytes,
  formatDuration,
  getMemoryMetrics,
  getDiskMetrics,
  getTopProcesses,
  getSystemReport,
};
