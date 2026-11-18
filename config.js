/**
 * wa2shell Configuration Loader
 * Handles environment variables and runtime settings.
 */

const path = require("path");
const fs = require("fs");

try {
  require("dotenv").config();
} catch (_) {
  const envPath = path.join(__dirname, ".env");
  if (typeof process.loadEnvFile === "function" && fs.existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch (_) {}
  }
}

const ROOT_DIR = path.resolve(__dirname);
const TMP_DIR = path.join(ROOT_DIR, "tmp");
const SESSION_DIR = path.join(ROOT_DIR, "session");

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

// Resolve agy binary location
let resolvedAgyPath = process.env.AGY_PATH || "agy";
if (resolvedAgyPath === "agy") {
  const candidate = "/root/.local/bin/agy";
  if (fs.existsSync(candidate)) {
    resolvedAgyPath = candidate;
  }
}

const config = {
  botName: process.env.BOT_NAME || "wa2shell",
  botPrefix: process.env.BOT_PREFIX || ".",
  ownerNumber: (process.env.OWNER_NUMBER || "").replace(/[^0-9]/g, ""),
  ownerOnly: process.env.OWNER_ONLY === "true",
  usePairingCode: process.env.USE_PAIRING_CODE === "true",
  botPhoneNumber: (process.env.BOT_PHONE_NUMBER || "").replace(/[^0-9]/g, ""),

  agy: {
    binPath: resolvedAgyPath,
    defaultModel: process.env.AGY_DEFAULT_MODEL || "gemini-3.8-flash-low",
    workDir: process.env.AGY_WORKDIR || process.cwd(),
    sessionTtlMs: parseInt(process.env.SESSION_TTL_MS, 10) || 5 * 60 * 1000,
    liveProgress: process.env.AGY_LIVE_PROGRESS !== "false",
    typingHeartbeat: process.env.AGY_TYPING_HEARTBEAT !== "false",
    showExecutionFooter: process.env.AGY_SHOW_FOOTER !== "false",
    progressThrottleMs: parseInt(process.env.AGY_PROGRESS_THROTTLE_MS, 10) || 1200,
  },

  paths: {
    root: ROOT_DIR,
    tmp: TMP_DIR,
    session: SESSION_DIR,
  },

  updater: {
    enabled: process.env.AUTO_UPDATE === "true",
    intervalMinutes: parseInt(process.env.UPDATE_INTERVAL_MIN, 10) || 60,
    branch: process.env.UPDATE_BRANCH || "main",
    autoApply: process.env.AUTO_UPDATE_APPLY === "true",
  },

  health: {
    autoRecovery: process.env.AUTO_RECOVERY !== "false",
    checkIntervalMinutes: parseInt(process.env.HEALTH_CHECK_INTERVAL_MIN, 10) || 15,
    memThresholdPercent: parseInt(process.env.HEALTH_MEM_THRESHOLD, 10) || 85,
    diskThresholdPercent: parseInt(process.env.HEALTH_DISK_THRESHOLD, 10) || 90,
    tmpMaxMb: parseInt(process.env.HEALTH_TMP_MAX_MB, 10) || 300,
  },
};

module.exports = config;
