/**
 * Local Audit Logger
 * Maintains an append-only, privacy-respecting audit trail of server commands
 * and agent interactions on the local filesystem.
 */

const fs = require("fs");
const path = require("path");
const config = require("../config");

const AUDIT_FILE = path.join(config.paths.tmp, "audit.log");
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB rotation ceiling

function logAuditEvent(event) {
  try {
    const timestamp = new Date().toISOString();
    const entry = JSON.stringify({
      timestamp,
      type: event.type || "INFO",
      sender: event.sender || "unknown",
      command: event.command ? event.command.slice(0, 500) : undefined,
      model: event.model,
      durationSec: event.durationSec,
      exitCode: event.exitCode,
      status: event.status || "OK",
    }) + "\n";

    // Rotate if file exceeds maximum allowed size
    if (fs.existsSync(AUDIT_FILE)) {
      const stats = fs.statSync(AUDIT_FILE);
      if (stats.size > MAX_LOG_SIZE) {
        const rotatedFile = path.join(config.paths.tmp, `audit-${Date.now()}.log.bak`);
        fs.renameSync(AUDIT_FILE, rotatedFile);
      }
    }

    fs.appendFileSync(AUDIT_FILE, entry, "utf8");
  } catch (err) {
    console.error("[wa2shell] [AuditLog Error]", err.message);
  }
}

module.exports = {
  logAuditEvent,
  AUDIT_FILE,
};
