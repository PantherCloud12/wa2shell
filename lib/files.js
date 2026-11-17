/**
 * Remote File & Directory Management Bridge
 * Provides safe file inspection (.cat), log monitoring (.tail), directory browsing (.ls),
 * and direct file delivery over WhatsApp (.get / .dl).
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { formatBytes } = require("./sysinfo");

const MAX_DIRECT_READ_BYTES = 1024 * 1024; // 1 MB limit for .cat in chat
const MAX_TRANSFER_BYTES = 100 * 1024 * 1024; // 100 MB ceiling for WhatsApp document

/**
 * Fast binary detection by inspecting null bytes in the header.
 */
function isBinaryFile(filePath) {
  try {
    const buf = Buffer.alloc(512);
    const fd = fs.openSync(filePath, "r");
    const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
    fs.closeSync(fd);
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return true;
    }
  } catch (_) {}
  return false;
}

/**
 * Calculates SHA256 snippet of a file.
 */
function getFileChecksum(filePath) {
  try {
    const hash = crypto.createHash("sha256");
    const data = fs.readFileSync(filePath);
    hash.update(data);
    return hash.digest("hex").slice(0, 16);
  } catch (_) {
    return "unknown";
  }
}

/**
 * Lists directory entries with icons and human-friendly metadata.
 */
function listDirectory(targetDir = ".") {
  const resolved = path.resolve(targetDir);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Directory not found: \`${targetDir}\``);
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`Path is a file, not a directory: \`${targetDir}\``);
  }

  const entries = fs.readdirSync(resolved);
  const items = [];

  for (const name of entries) {
    if (name === ".git") continue;
    const fullPath = path.join(resolved, name);
    try {
      const s = fs.statSync(fullPath);
      const isDir = s.isDirectory();
      const isExec = !isDir && (s.mode & 0o111) !== 0;
      items.push({
        name,
        isDir,
        isExec,
        size: s.size,
        mtime: s.mtime,
      });
    } catch (_) {}
  }

  // Sort folders first, then alphabetically
  items.sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });

  let output = `📁 *Directory Listing:* \`${resolved}\` (${items.length} items)\n\n`;
  if (items.length === 0) {
    output += `• _(empty directory)_\n`;
  } else {
    items.slice(0, 50).forEach((item) => {
      const icon = item.isDir ? "📁" : item.isExec ? "⚙️" : "📄";
      const sizeStr = item.isDir ? "DIR" : formatBytes(item.size);
      output += `${icon} \`${item.name}\` — _${sizeStr}_\n`;
    });
    if (items.length > 50) {
      output += `\n... and ${items.length - 50} more items.`;
    }
  }

  return output;
}

/**
 * Reads text file content safely.
 */
function readFile(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File does not exist: \`${filePath}\``);
  }

  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    throw new Error(`Path is a directory, not a file. Use \`.ls ${filePath}\``);
  }

  if (isBinaryFile(resolved)) {
    throw new Error(
      `File appears to be binary (${formatBytes(stat.size)}). Use \`.get ${filePath}\` to download it.`
    );
  }

  if (stat.size > MAX_DIRECT_READ_BYTES) {
    throw new Error(
      `File is too large for inline view (${formatBytes(stat.size)}). Use \`.tail ${filePath}\` or \`.get ${filePath}\`.`
    );
  }

  return fs.readFileSync(resolved, "utf8");
}

/**
 * Returns last N lines of a file.
 */
function tailFile(filePath, lines = 25) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: \`${filePath}\``);
  }

  const clampedLines = Math.min(Math.max(1, parseInt(lines, 10) || 25), 200);
  try {
    const raw = execSync(`tail -n ${clampedLines} "${resolved}"`, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 2,
    });
    return raw;
  } catch (err) {
    throw new Error(`Tail failed: ${err.message}`);
  }
}

/**
 * Reads recent entries from local audit log.
 */
function readAuditLog(auditFilePath, count = 10) {
  if (!fs.existsSync(auditFilePath)) {
    return "ℹ️ _No audit log entries recorded yet._";
  }

  try {
    const raw = fs.readFileSync(auditFilePath, "utf8").trim();
    if (!raw) return "ℹ️ _Audit log is currently empty._";

    const lines = raw.split("\n").filter(Boolean);
    const slice = lines.slice(-Math.min(count, 30));

    let reply = `🛡️ *Security Audit Log (Last ${slice.length} Events):*\n\n`;
    slice.reverse().forEach((line) => {
      try {
        const item = JSON.parse(line);
        const time = item.timestamp ? item.timestamp.split("T")[1].replace("Z", "") : "";
        reply += `• \`[${time}]\` *${item.type}* by \`${item.sender}\` (${item.status || "OK"})\n`;
        if (item.command) {
          reply += `   └ cmd: \`${item.command.slice(0, 50)}\`\n`;
        }
      } catch (_) {
        reply += `• ${line.slice(0, 60)}\n`;
      }
    });

    return reply;
  } catch (err) {
    return `❌ Failed to read audit log: ${err.message}`;
  }
}

module.exports = {
  isBinaryFile,
  getFileChecksum,
  listDirectory,
  readFile,
  tailFile,
  readAuditLog,
  MAX_TRANSFER_BYTES,
};
