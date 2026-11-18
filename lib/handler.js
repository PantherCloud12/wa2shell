/**
 * Message Handler (v1.4.0)
 * Parses incoming WhatsApp messages, commands, direct bash triggers, and Antigravity queries.
 * Features:
 * - Automated Repository Update Engine & Scheduler (.update)
 * - System Health Diagnostics & Self-Healing / Recovery (.health, .heal, .recovery)
 * - WhatsApp-Native AI Response Typography Formatter (Anti-Berantakan Engine)
 * - System Telemetry Engine (.sys / .top)
 * - Remote File Explorer & Direct Document Delivery (.ls, .cat, .tail, .get)
 * - Process Termination & Inspection (.kill, .stop, .ps)
 * - Audit Trail Inspection (.audit)
 * - Auto-spillover for large outputs
 * - Credential Sanitization & Security Shield
 * - Zero-Downtime Hot-Reload (.reload / .r)
 */

const fs = require("fs");
const path = require("path");
const config = require("../config");
const { executeShell, killShell, getActiveShells } = require("./shell");
const {
  queryAgent,
  resetSession,
  killAgent,
  getActiveAgents,
  getActiveModel,
  setActiveModel,
  getLastSteps,
  formatStepsReport,
} = require("./agy_bridge");
const { sanitizeOutput } = require("./sanitizer");
const { logAuditEvent, AUDIT_FILE } = require("./audit");
const { getSystemReport, formatBytes } = require("./sysinfo");
const {
  readFile,
  tailFile,
  listDirectory,
  readAuditLog,
  getFileChecksum,
  MAX_TRANSFER_BYTES,
} = require("./files");
const {
  formatWhatsApp,
  formatAIResponse,
  parseActionTags,
} = require("./formatter");
const {
  getCurrentGitInfo,
  checkGitUpdate,
  applyGitUpdate,
  startAutoUpdater,
  stopAutoUpdater,
  getAutoUpdaterStatus,
} = require("./updater");
const {
  getSystemHealth,
  formatHealthReport,
  performSelfHealing,
  startHealthWatchdog,
  stopHealthWatchdog,
  getHealthWatchdogStatus,
} = require("./health");

const MAX_WA_TEXT_LENGTH = 3500;

/**
 * Sends a message with automatic file spillover if the text exceeds WhatsApp comfort limits.
 */
async function sendSafeMessage(sock, jid, text, quotedMsg, filePrefix = "output") {
  const sanitized = sanitizeOutput(text);

  if (sanitized.length <= MAX_WA_TEXT_LENGTH) {
    return await sock.sendMessage(jid, { text: sanitized }, { quoted: quotedMsg });
  }

  // Large output spillover into a downloadable text document
  const fileName = `wa2shell_${filePrefix}_${Date.now()}.txt`;
  const filePath = path.join(config.paths.tmp, fileName);
  fs.writeFileSync(filePath, sanitized, "utf8");

  const previewSnippet = sanitized.slice(0, 1000);
  const caption =
    `📄 *Output exceeded ${MAX_WA_TEXT_LENGTH} characters (${sanitized.length} bytes).*\n` +
    `Attached full log below.\n\n` +
    `*Preview:*\n\`\`\`\n${previewSnippet}\n...\n\`\`\``;

  await sock.sendMessage(
    jid,
    {
      document: { url: filePath },
      mimetype: "text/plain",
      fileName,
      caption,
    },
    { quoted: quotedMsg }
  );
}

async function handleMessage(sock, m, options = {}) {
  if (!m.messages || !m.messages[0]) return;
  const msg = m.messages[0];
  if (msg.key && msg.key.fromMe) return;

  const jid = msg.key.remoteJid;
  const isGroup = jid.endsWith("@g.us");
  const senderJid = isGroup ? (msg.key.participant || msg.participant || "") : jid;
  const senderNumber = senderJid.replace(/[^0-9]/g, "");

  const messageContent = msg.message;
  if (!messageContent) return;

  const rawText =
    messageContent.conversation ||
    messageContent.extendedTextMessage?.text ||
    messageContent.imageMessage?.caption ||
    messageContent.videoMessage?.caption ||
    "";

  const text = rawText.trim();
  if (!text) return;

  // Authorization check
  const isOwner = Boolean(
    config.ownerNumber &&
    (senderNumber === config.ownerNumber || senderNumber.endsWith(config.ownerNumber))
  );

  if (config.ownerOnly && !isOwner) {
    return; // Silently ignore unauthorized messages when owner-only policy is enforced
  }

  // 1. Command .help / .menu
  if (text === ".help" || text === ".menu") {
    const helpMsg =
      `⚡ *wa2shell Command Center (v1.5.0)*\n\n` +
      `🏥 *Health & Self-Healing*\n` +
      `• \`.health\` / \`.doctor\` — Complete hardware & health diagnostic report\n` +
      `• \`.heal\` / \`.recovery\` — Trigger immediate self-healing (tmp purge & zombie reaper)\n` +
      `• \`.health auto [on|off]\` — Toggle autonomous background health guard\n\n` +
      `🔄 *Auto-Update & Schedule*\n` +
      `• \`.update\` / \`.update check\` — Check for new commits on GitHub\n` +
      `• \`.update pull\` / \`.update now\` — Pull latest commits & hot-reload\n` +
      `• \`.update auto [on|off]\` — Toggle scheduled background auto-updater\n` +
      `• \`.update interval <min>\` — Set auto-update schedule interval\n` +
      `• \`.update status\` — View git branch, commit hash, and scheduler state\n\n` +
      `🖥️ *System & Telemetry*\n` +
      `• \`.sys\` / \`.top\` — Hardware monitor (CPU, RAM, Disk, Load, Top Processes)\n` +
      `• \`.status\` / \`.ping\` — Quick host daemon healthcheck\n` +
      `• \`.ps\` — Inspect running shell & agent tasks\n` +
      `• \`.kill\` / \`.stop\` — Terminate active tasks in current chat\n\n` +
      `📁 *Remote File Explorer*\n` +
      `• \`.ls [path]\` — List directory entries & sizes\n` +
      `• \`.cat <path>\` — Display text file with auto-spillover\n` +
      `• \`.tail [n] <path>\` — Read last N lines of a file (default 25)\n` +
      `• \`.get <path>\` — Download any file directly to WhatsApp\n\n` +
      `🤖 *Antigravity AI Agent (Live Telemetry & Typography)*\n` +
      `• Direct message / \`.ai <prompt>\` — Autonomous server assistant with live progress\n` +
      `• \`.ai --steps <prompt>\` — Execute query and append detailed execution trace\n` +
      `• \`.steps\` — Inspect tool and reasoning execution history of last query\n` +
      `• \`.model [name]\` — View or switch AI agent model\n` +
      `• \`.reset\` / \`.clear\` — Reset agent context memory\n\n` +
      `💻 *Direct Shell*\n` +
      `• \`$ <cmd>\` / \`.sh <cmd>\` — Run bash command with timeout\n\n` +
      `🛡️ *Security & Management*\n` +
      `• \`.audit [n]\` — View security audit log trail\n` +
      `• \`.reload\` / \`.r\` — Zero-downtime hot-reload`;

    await sock.sendMessage(jid, { text: helpMsg }, { quoted: msg });
    return;
  }

  // 1.1 Execution Steps Inspector (.steps)
  if (text === ".steps" || text === ".step" || text === ".ai steps") {
    const lastSteps = getLastSteps();
    const formatted = formatStepsReport(lastSteps, "N/A", getActiveModel());
    await sock.sendMessage(jid, { text: formatted }, { quoted: msg });
    return;
  }

  // 2. Hardware Telemetry & Resource Monitor (.sys / .top)
  if (text === ".sys" || text === ".top") {
    try {
      const report = getSystemReport();
      logAuditEvent({ type: "SYS_REPORT", sender: senderNumber });
      await sendSafeMessage(sock, jid, report, msg, "sysinfo");
    } catch (err) {
      await sock.sendMessage(jid, { text: `❌ *Telemetry Error:*\n\`${err.message}\`` }, { quoted: msg });
    }
    return;
  }

  // 3. Remote Directory Listing (.ls / .dir)
  if (text === ".ls" || text.startsWith(".ls ") || text === ".dir" || text.startsWith(".dir ")) {
    const targetDir = text.replace(/^\.(ls|dir)\s*/, "").trim() || ".";
    try {
      const listing = listDirectory(targetDir);
      logAuditEvent({ type: "DIR_LIST", sender: senderNumber, command: targetDir });
      await sendSafeMessage(sock, jid, listing, msg, "dir");
    } catch (err) {
      await sock.sendMessage(jid, { text: `❌ *Directory Error:*\n${err.message}` }, { quoted: msg });
    }
    return;
  }

  // 4. Remote Text File Inspection (.cat)
  if (text.startsWith(".cat ")) {
    const targetPath = text.slice(5).trim();
    if (!targetPath) return;

    try {
      const content = readFile(targetPath);
      logAuditEvent({ type: "FILE_READ", sender: senderNumber, command: targetPath });
      const formatted = `📄 *File:* \`${targetPath}\`\n\n\`\`\`\n${content}\n\`\`\``;
      await sendSafeMessage(sock, jid, formatted, msg, "cat");
    } catch (err) {
      await sock.sendMessage(jid, { text: `❌ *File Read Error:*\n${err.message}` }, { quoted: msg });
    }
    return;
  }

  // 5. Remote Log / File Tail (.tail)
  if (text.startsWith(".tail ") || text === ".tail") {
    const args = text.slice(5).trim().split(/\s+/).filter(Boolean);
    let lines = 25;
    let targetPath = "";

    if (args.length >= 2 && /^\d+$/.test(args[0])) {
      lines = parseInt(args[0], 10);
      targetPath = args.slice(1).join(" ");
    } else {
      targetPath = args.join(" ");
    }

    if (!targetPath) {
      await sock.sendMessage(
        jid,
        { text: "ℹ️ *Usage:* `.tail [lines] <filepath>`\nExample: `.tail 50 /var/log/syslog`" },
        { quoted: msg }
      );
      return;
    }

    try {
      const content = tailFile(targetPath, lines);
      logAuditEvent({ type: "FILE_TAIL", sender: senderNumber, command: `${lines} ${targetPath}` });
      const formatted = `📜 *Tail:* \`${targetPath}\` (last ${lines} lines)\n\n\`\`\`\n${content}\n\`\`\``;
      await sendSafeMessage(sock, jid, formatted, msg, "tail");
    } catch (err) {
      await sock.sendMessage(jid, { text: `❌ *Tail Error:*\n${err.message}` }, { quoted: msg });
    }
    return;
  }

  // 6. Direct File Transfer to WhatsApp (.get / .dl)
  if (text.startsWith(".get ") || text.startsWith(".dl ")) {
    if (!isOwner) {
      await sock.sendMessage(
        jid,
        { text: "❌ *Access Denied:* Remote file downloading is strictly restricted to the bot owner." },
        { quoted: msg }
      );
      return;
    }

    const targetPath = text.replace(/^\.(get|dl)\s+/, "").trim();
    if (!targetPath) return;

    const resolved = path.resolve(targetPath);
    if (!fs.existsSync(resolved)) {
      await sock.sendMessage(jid, { text: `❌ *File not found:* \`${targetPath}\`` }, { quoted: msg });
      return;
    }

    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      await sock.sendMessage(jid, { text: `❌ Path is a directory. Use \`.ls ${targetPath}\`` }, { quoted: msg });
      return;
    }

    if (stat.size > MAX_TRANSFER_BYTES) {
      await sock.sendMessage(
        jid,
        {
          text: `❌ *File Too Large:* File is ${formatBytes(stat.size)} (Maximum allowed is ${formatBytes(MAX_TRANSFER_BYTES)}).`,
        },
        { quoted: msg }
      );
      return;
    }

    const fileName = path.basename(resolved);
    const checksum = getFileChecksum(resolved);
    const caption =
      `📄 *File Delivery:* \`${fileName}\`\n` +
      `• Path: \`${resolved}\`\n` +
      `• Size: \`${formatBytes(stat.size)}\`\n` +
      `• SHA256: \`${checksum}...\``;

    try {
      await sock.sendMessage(
        jid,
        {
          document: { url: resolved },
          mimetype: "application/octet-stream",
          fileName,
          caption,
        },
        { quoted: msg }
      );
      logAuditEvent({ type: "FILE_DOWNLOAD", sender: senderNumber, command: resolved });
    } catch (err) {
      await sock.sendMessage(jid, { text: `❌ *Download Failed:*\n\`${err.message}\`` }, { quoted: msg });
    }
    return;
  }

  // 7. Security Audit Trail Inspection (.audit)
  if (text === ".audit" || text.startsWith(".audit ")) {
    const parts = text.split(" ").filter(Boolean);
    const count = parts[1] && /^\d+$/.test(parts[1]) ? parseInt(parts[1], 10) : 10;
    const report = readAuditLog(AUDIT_FILE, count);
    await sock.sendMessage(jid, { text: report }, { quoted: msg });
    return;
  }

  // 8. Process Termination (.kill / .stop)
  if (text === ".kill" || text === ".stop") {
    const killedShell = killShell(jid);
    const killedAgent = killAgent(jid);

    logAuditEvent({
      type: "PROCESS_KILL",
      sender: senderNumber,
      status: killedShell || killedAgent ? "TERMINATED" : "NOT_FOUND",
    });

    if (killedShell || killedAgent) {
      await sock.sendMessage(
        jid,
        {
          text: `🛑 *Process Terminated:*\n• Shell Job: ${killedShell ? "*Killed*" : "_None active_"}\n• Agent Job: ${killedAgent ? "*Killed*" : "_None active_"}`,
        },
        { quoted: msg }
      );
    } else {
      await sock.sendMessage(
        jid,
        { text: "ℹ️ *No active shell or agent tasks running for this chat.*" },
        { quoted: msg }
      );
    }
    return;
  }

  // 9. Active Process Inspection (.ps)
  if (text === ".ps") {
    const shells = getActiveShells();
    const agents = getActiveAgents();

    let reply = `📋 *Active Tasks Running on wa2shell:*\n\n`;
    reply += `*Shell Processes (${shells.length}):*\n`;
    if (shells.length === 0) {
      reply += `• _None running_\n`;
    } else {
      shells.forEach((s) => {
        reply += `• PID: \`${s.pid}\` (${s.elapsedSec}s) — \`${s.command.slice(0, 40)}\`\n`;
      });
    }

    reply += `\n*Antigravity Agent Jobs (${agents.length}):*\n`;
    if (agents.length === 0) {
      reply += `• _None running_\n`;
    } else {
      agents.forEach((a) => {
        reply += `• PID: \`${a.pid}\` (${a.elapsedSec}s) [${a.model}] — \`${a.prompt.slice(0, 35)}...\`\n`;
      });
    }

    reply += `\n_Tip: Send \`.kill\` to terminate running tasks in your current chat._`;
    await sock.sendMessage(jid, { text: reply }, { quoted: msg });
    return;
  }

  // 10. Direct Shell Execution ($ command or .sh command)
  if (text.startsWith("$ ") || text.startsWith(".sh ")) {
    if (!isOwner) {
      await sock.sendMessage(
        jid,
        { text: "❌ *Access Denied:* Direct shell execution is strictly restricted to the bot owner." },
        { quoted: msg }
      );
      return;
    }

    const command = text.startsWith("$ ") ? text.slice(2).trim() : text.slice(4).trim();
    if (!command) return;

    await sock.sendMessage(
      jid,
      { text: `⏳ *Executing shell:*\n\`${command}\`` },
      { quoted: msg }
    );

    const result = await executeShell(command, { jid });

    logAuditEvent({
      type: "SHELL_EXEC",
      sender: senderNumber,
      command,
      exitCode: result.exitCode,
      durationSec: result.durationSec,
      status: result.killed ? "KILLED" : result.exitCode === 0 ? "SUCCESS" : "ERROR",
    });

    let header = `*Exit Code:* ${result.exitCode} (${result.durationSec}s)`;
    if (result.killed) {
      header += ` 🛑 *[KILLED]*`;
    }

    const outputBody = result.output || "_(Command completed with empty output)_";
    const fullMessage = `${header}\n\n\`\`\`\n${outputBody}\n\`\`\``;

    await sendSafeMessage(sock, jid, fullMessage, msg, "shell");
    return;
  }

  // 11. Command .reset / .clear (Clear Agent Session)
  if (text === ".reset" || text === ".clear") {
    resetSession(jid);
    logAuditEvent({ type: "SESSION_RESET", sender: senderNumber });
    await sock.sendMessage(
      jid,
      { text: "🔄 *Session Cleared:* Conversation context has been reset. Your next message will start a fresh session." },
      { quoted: msg }
    );
    return;
  }

  // 12. Command .model (Inspect or Switch Agent Model)
  if (text.startsWith(".model")) {
    const parts = text.split(" ").filter(Boolean);
    if (parts.length === 1) {
      await sock.sendMessage(
        jid,
        {
          text: `🤖 *Active Antigravity Model:* \`${getActiveModel()}\`\n\nTo switch models: \`.model <model-id>\`\nExample: \`.model gemini-3.8-flash-high\``,
        },
        { quoted: msg }
      );
      return;
    }
    const newModel = parts[1].trim();
    setActiveModel(newModel);
    logAuditEvent({ type: "MODEL_SWITCH", sender: senderNumber, model: newModel });
    await sock.sendMessage(
      jid,
      { text: `✅ *Model Updated:* Switched active model to \`${newModel}\`` },
      { quoted: msg }
    );
    return;
  }

  // 13. Command .status / .ping (Quick Host Healthcheck)
  if (text === ".status" || text === ".ping") {
    const uptimeRes = await executeShell("uptime -p && free -h | grep Mem && df -h / | tail -n 1");
    const info = uptimeRes.output ? `\`\`\`\n${uptimeRes.output}\n\`\`\`` : "Host system operational.";
    await sock.sendMessage(
      jid,
      { text: `⚡ *wa2shell v1.4.0 Status*\n• Daemon: *Online*\n• Model: \`${getActiveModel()}\`\n\n${info}` },
      { quoted: msg }
    );
    return;
  }

  // 14. Command .health / .doctor (System Health Diagnostics)
  if (text === ".health" || text === ".doctor" || text.startsWith(".health ")) {
    const parts = text.split(/\s+/);
    if (parts.length >= 3 && parts[1] === "auto") {
      if (!isOwner) {
        await sock.sendMessage(jid, { text: "❌ *Access Denied:* Only the bot owner can toggle the health watchdog." }, { quoted: msg });
        return;
      }
      const enable = parts[2].toLowerCase() === "on" || parts[2].toLowerCase() === "enable";
      if (enable) {
        startHealthWatchdog(sock, jid, options.reloadModules, { enabled: true });
        await sock.sendMessage(jid, { text: "✅ *Health Watchdog Activated:* Automatic self-healing will trigger when memory/disk thresholds are exceeded." }, { quoted: msg });
      } else {
        stopHealthWatchdog();
        await sock.sendMessage(jid, { text: "🛑 *Health Watchdog Deactivated.*" }, { quoted: msg });
      }
      return;
    }

    try {
      const report = formatHealthReport();
      logAuditEvent({ type: "HEALTH_DIAGNOSTIC", sender: senderNumber });
      await sendSafeMessage(sock, jid, report, msg, "health");
    } catch (err) {
      await sock.sendMessage(jid, { text: `❌ *Health Diagnostic Error:*\n\`${err.message}\`` }, { quoted: msg });
    }
    return;
  }

  // 15. Command .heal / .recovery (System Self-Healing & Cleanup)
  if (text === ".heal" || text === ".recovery") {
    if (!isOwner) {
      await sock.sendMessage(jid, { text: "❌ *Access Denied:* Only the bot owner can trigger self-healing." }, { quoted: msg });
      return;
    }

    await sock.sendMessage(jid, { text: "⏳ *Initiating System Self-Healing & Recovery Routine...*" }, { quoted: msg });

    try {
      const result = await performSelfHealing({
        sender: senderNumber,
        reloadModules: options.reloadModules,
        force: true,
      });

      const reply =
        `🏥 *wa2shell Recovery Completed in ${result.durationSec}s*\n` +
        `• Tmp Scratch Cleaned: *${result.filesDeleted} files* (${result.reclaimedStr} reclaimed)\n` +
        `• Zombie Tasks Terminated: *${result.zombieTasksKilled}*\n` +
        `• V8 Garbage Collection: ${result.gcExecuted ? "*Executed*" : "_Not enabled in runtime_"}\n` +
        `• Hot-Reload Refreshed: ${result.modulesReloaded ? "*Yes (Zero Downtime)*" : "_Bypassed_"}\n\n` +
        `_All active subsystems restored to clean state._`;

      await sock.sendMessage(jid, { text: reply }, { quoted: msg });
    } catch (err) {
      await sock.sendMessage(jid, { text: `❌ *Recovery Failed:*\n\`${err.message}\`` }, { quoted: msg });
    }
    return;
  }

  // 16. Command .update (Repository Auto-Update & Schedule)
  if (text === ".update" || text.startsWith(".update ") || text.startsWith(".gitupdate")) {
    if (!isOwner) {
      await sock.sendMessage(jid, { text: "❌ *Access Denied:* Repository updates are strictly restricted to the bot owner." }, { quoted: msg });
      return;
    }

    const sub = text.replace(/^\.(update|gitupdate)\s*/, "").trim();

    // .update status
    if (sub === "status") {
      const status = getAutoUpdaterStatus();
      const git = status.git;
      const reply =
        `🔄 *wa2shell Update Engine Status*\n\n` +
        `*Git Repository:*\n` +
        `• Branch: \`${git.branch || "unknown"}\`\n` +
        `• Local Commit: \`${git.shortCommit || "unknown"}\`\n` +
        `• Latest Log: \`${git.commitInfo || "unknown"}\`\n` +
        `• Remote: \`${git.remoteUrl || "unknown"}\`\n\n` +
        `*Automated Scheduler:*\n` +
        `• Schedule State: *${status.enabled ? "ACTIVE (Running)" : "DISABLED"}*\n` +
        `• Check Interval: *${status.intervalMinutes} minutes*\n` +
        `• Auto-Apply Pull: *${status.autoApply ? "YES" : "NO (Notify Only)"}*\n` +
        `• Last Check: \`${status.lastCheckTime}\`\n` +
        `• Last Verdict: \`${status.lastCheckResult}\``;

      await sock.sendMessage(jid, { text: reply }, { quoted: msg });
      return;
    }

    // .update auto [on|off]
    if (sub.startsWith("auto")) {
      const mode = sub.slice(4).trim().toLowerCase();
      if (mode === "on" || mode === "enable" || mode === "true") {
        startAutoUpdater(sock, jid, options.reloadModules, { enabled: true });
        await sock.sendMessage(jid, { text: "✅ *Auto-Updater Activated:* wa2shell will periodically poll GitHub for updates in the background." }, { quoted: msg });
      } else if (mode === "off" || mode === "disable" || mode === "false") {
        stopAutoUpdater();
        await sock.sendMessage(jid, { text: "🛑 *Auto-Updater Deactivated.*" }, { quoted: msg });
      } else {
        await sock.sendMessage(jid, { text: "ℹ️ *Usage:* `.update auto on` or `.update auto off`" }, { quoted: msg });
      }
      return;
    }

    // .update interval <minutes>
    if (sub.startsWith("interval")) {
      const mins = parseInt(sub.slice(8).trim(), 10);
      if (isNaN(mins) || mins < 5) {
        await sock.sendMessage(jid, { text: "ℹ️ *Usage:* `.update interval <minutes>` (Minimum 5 minutes)" }, { quoted: msg });
        return;
      }
      startAutoUpdater(sock, jid, options.reloadModules, { intervalMinutes: mins, enabled: true });
      await sock.sendMessage(jid, { text: `✅ *Update Interval Set:* wa2shell will check GitHub every *${mins} minutes*.` }, { quoted: msg });
      return;
    }

    // .update pull / .update now
    if (sub === "pull" || sub === "now" || sub === "apply") {
      await sock.sendMessage(jid, { text: "⏳ *Pulling latest updates from GitHub...*" }, { quoted: msg });

      try {
        const result = await applyGitUpdate({
          sender: senderNumber,
          reloadModules: options.reloadModules,
        });

        const reply =
          `⚡ *wa2shell Updated Successfully!*\n` +
          `• Branch: \`${result.branch}\`\n` +
          `• Version Transition: \`${result.oldShort}\` ➜ \`${result.newShort}\`\n` +
          `• NPM Dependencies: ${result.npmInstalled ? "*Updated (npm install ran)*" : "_Up to date_"}\n` +
          `• Hot-Reload: ${result.reloaded ? "*Refreshed (Zero Downtime)*" : "_Require manual restart_"}\n\n` +
          `*Pulled Commits:*\n\`\`\`\n${result.logList || "Working tree updated."}\n\`\`\``;

        await sock.sendMessage(jid, { text: reply }, { quoted: msg });
      } catch (err) {
        await sock.sendMessage(jid, { text: `❌ *Update Failed:*\n\`${err.message}\`` }, { quoted: msg });
      }
      return;
    }

    // Default: .update or .update check
    await sock.sendMessage(jid, { text: "🔍 *Checking GitHub repository for updates...*" }, { quoted: msg });

    try {
      const checkRes = await checkGitUpdate();

      if (!checkRes.hasUpdate) {
        if (checkRes.error) {
          await sock.sendMessage(jid, { text: `⚠️ *Git Check Warning:*\n${checkRes.error}` }, { quoted: msg });
        } else {
          await sock.sendMessage(
            jid,
            { text: `✅ *wa2shell is Up to Date!*\n• Branch: \`${checkRes.branch}\`\n• Commit: \`${checkRes.localShort}\`\n• Status: Clean & Synced with remote.` },
            { quoted: msg }
          );
        }
        return;
      }

      const reply =
        `🔔 *Updates Available on GitHub!*\n` +
        `• Branch: \`${checkRes.branch}\`\n` +
        `• Commits Behind: *${checkRes.behindCount}*\n` +
        `• Local: \`${checkRes.localShort}\` ➜ Remote: \`${checkRes.remoteShort}\`\n\n` +
        `*Pending Commits:*\n\`\`\`\n${checkRes.commitsLog}\n\`\`\`\n` +
        `To apply this update now, type: \`.update pull\``;

      await sock.sendMessage(jid, { text: reply }, { quoted: msg });
    } catch (err) {
      await sock.sendMessage(jid, { text: `❌ *Update Check Failed:*\n\`${err.message}\`` }, { quoted: msg });
    }
    return;
  }

  // 17. Command .reload / .r (Zero-Downtime Hot-Reload)
  if (text === ".reload" || text === ".r") {
    if (!isOwner) {
      await sock.sendMessage(
        jid,
        { text: "❌ *Access Denied:* Only the bot owner can trigger hot reload." },
        { quoted: msg }
      );
      return;
    }

    try {
      if (options && typeof options.reloadModules === "function") {
        options.reloadModules();
      }
      logAuditEvent({ type: "HOT_RELOAD", sender: senderNumber });
      await sock.sendMessage(
        jid,
        {
          text:
            "⚡ *wa2shell Hot-Reloaded (v1.4.0)!*\n" +
            "• Status: *Active*\n" +
            "• Require Cache: *Purged & Refreshed*\n" +
            "• Security Sanitizer: *Loaded*\n" +
            "• AI Typography Engine: *Active (WhatsApp Native)*\n" +
            "• Telemetry, Health & Update Engines: *Active*\n" +
            "• Baileys Socket: *Intact (Zero Downtime)*\n" +
            `• Active Model: \`${getActiveModel()}\``,
        },
        { quoted: msg }
      );
    } catch (err) {
      await sock.sendMessage(
        jid,
        { text: `❌ *Hot-Reload Failed:*\n\`${err.message}\`` },
        { quoted: msg }
      );
    }
    return;
  }

  // 15. Antigravity Agent Query
  let promptText = "";
  if (!isGroup) {
    promptText = text;
  } else if (text.startsWith(".ai ") || text.startsWith(".agy ")) {
    promptText = text.replace(/^\.(ai|agy)\s+/, "").trim();
  } else {
    const botJid = sock.user?.id ? sock.user.id.split(":")[0] + "@s.whatsapp.net" : "";
    const mentionedJids = messageContent.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (botJid && mentionedJids.includes(botJid)) {
      promptText = text.replace(/@[0-9]+/g, "").trim();
    }
  }

  if (!promptText) return;

  // Check for verbose step flag
  let verboseSteps = false;
  if (/^(-v|--steps|--verbose)\s+/i.test(promptText)) {
    verboseSteps = true;
    promptText = promptText.replace(/^(-v|--steps|--verbose)\s+/i, "").trim();
  }

  // React to acknowledge receipt
  try {
    await sock.sendMessage(jid, { react: { text: "⚡", key: msg.key } });
  } catch (_) {}

  // Setup typing presence heartbeat
  let typingTimer = null;
  if (config.agy.typingHeartbeat !== false) {
    try {
      await sock.sendPresenceUpdate("composing", jid);
    } catch (_) {}
    typingTimer = setInterval(async () => {
      try {
        await sock.sendPresenceUpdate("composing", jid);
      } catch (_) {}
    }, 3500);
  }

  // Setup initial live progress tracking card
  let statusMsgKey = null;
  let lastProgressEditTime = 0;
  const THROTTLE_MS = config.agy.progressThrottleMs || 1200;
  const initialTime = Date.now();
  let currentCardText = "";

  const updateProgressCard = async (newText, force = false) => {
    if (!statusMsgKey) return;
    const now = Date.now();
    if (!force && now - lastProgressEditTime < THROTTLE_MS) return;
    lastProgressEditTime = now;
    currentCardText = newText;
    try {
      await sock.sendMessage(jid, { text: newText, edit: statusMsgKey });
    } catch (_) {}
  };

  if (config.agy.liveProgress !== false) {
    try {
      const initialCard =
        `⏳ *wa2shell Agent* • Menghubungkan...\n` +
        `• *Model:* \`${getActiveModel()}\`\n` +
        `• *Status:* 🧠 Menganalisa instruksi & merancang solusi...\n` +
        `• *Waktu Berjalan:* 0.0s`;
      const sentStatus = await sock.sendMessage(jid, { text: initialCard }, { quoted: msg });
      if (sentStatus?.key) {
        statusMsgKey = sentStatus.key;
        currentCardText = initialCard;
      }
    } catch (_) {}
  }

  // Heartbeat ticker to keep elapsed seconds fresh during long tool operations
  let ticker = null;
  if (statusMsgKey) {
    ticker = setInterval(async () => {
      const elapsed = ((Date.now() - initialTime) / 1000).toFixed(0);
      if (elapsed >= 3 && currentCardText) {
        let updated = currentCardText;
        if (updated.includes("• *Waktu Berjalan:*")) {
          updated = updated.replace(/• \*Waktu Berjalan:\* [0-9.]+s/, `• *Waktu Berjalan:* ${elapsed}s`);
        } else if (updated.includes("• Berjalan:")) {
          updated = updated.replace(/• Berjalan: [0-9.]+s/, `• Berjalan: ${elapsed}s`);
        }
        if (updated !== currentCardText) {
          await updateProgressCard(updated);
        }
      }
    }, 2500);
  }

  let result;
  try {
    // Invoke Antigravity Bridge with live tool & progress telemetry
    result = await queryAgent(jid, promptText, {
      onProgress: async (evt) => {
        if (evt.type === "tool_start") {
          const card =
            `⚙️ *wa2shell Agent* • Sedang Bekerja...\n` +
            `• *Model:* \`${getActiveModel()}\`\n` +
            `• *Status:* ${evt.emoji} \`${evt.toolName}\` — ${evt.toolSummary}\n` +
            `• *Langkah:* #${evt.stepIndex} • Berjalan: ${evt.elapsedSec}s`;
          await updateProgressCard(card);
        } else if (evt.type === "agent_responding") {
          const card =
            `✨ *wa2shell Agent* • Merangkum Output...\n` +
            `• *Model:* \`${getActiveModel()}\`\n` +
            `• *Status:* ✨ Menyusun format balasan WhatsApp...\n` +
            `• *Langkah:* #${evt.stepIndex} • Berjalan: ${evt.elapsedSec}s`;
          await updateProgressCard(card);
        }
      },
      onToolUpdate: async (toolName) => {
        try {
          const toolEmoji =
            toolName === "run_command" ? "⚙️" :
            toolName.includes("file") ? "📝" :
            toolName.includes("search") ? "🔍" : "🧠";
          await sock.sendMessage(jid, { react: { text: toolEmoji, key: msg.key } });
        } catch (_) {}
      },
    });
  } catch (err) {
    result = {
      conversationId: null,
      response: `Agent query failure: ${err.message}`,
      toolsUsed: [],
      steps: [],
      durationSec: ((Date.now() - initialTime) / 1000).toFixed(1),
      exitCode: 1,
    };
  } finally {
    if (ticker) clearInterval(ticker);
    if (typingTimer) {
      clearInterval(typingTimer);
      typingTimer = null;
    }
    try {
      await sock.sendPresenceUpdate("paused", jid);
    } catch (_) {}
  }

  logAuditEvent({
    type: "AGENT_QUERY",
    sender: senderNumber,
    command: promptText,
    model: getActiveModel(),
    durationSec: result.durationSec,
    exitCode: result.exitCode,
  });

  // Final completion reaction
  try {
    await sock.sendMessage(jid, { react: { text: "✅", key: msg.key } });
  } catch (_) {}

  // Update progress card to completed state
  if (statusMsgKey) {
    const stepCount = result.steps?.length || result.toolsUsed?.length || 1;
    const toolsStr = result.toolsUsed.length > 0 ? ` • ${result.toolsUsed.map((t) => `\`${t}\``).join(", ")}` : "";
    const finalCard = `✅ *wa2shell Agent Selesai* (⏱️ ${result.durationSec}s • ${stepCount} langkah${toolsStr})`;
    await updateProgressCard(finalCard, true);
  }

  // Format agent response using WhatsApp Native Typography Formatter (Anti-Berantakan)
  let { formattedText, actions } = formatAIResponse(result.response);

  // If user requested verbose steps, append full execution breakdown
  if (verboseSteps && result.steps && result.steps.length > 0) {
    const stepsReport = formatStepsReport(result.steps, result.durationSec, getActiveModel());
    formattedText = `${formattedText}\n\n────────────────────────────\n${stepsReport}`;
  }

  // Append transparent execution footer
  if (config.agy.showExecutionFooter !== false && formattedText) {
    const stepCount = result.steps?.length || result.toolsUsed?.length || 1;
    formattedText += `\n\n⚡ _wa2shell v1.5.0 • ${result.durationSec}s • ${getActiveModel()} • ${stepCount} langkah_`;
  }

  // Send textual agent response with safety chunking/spillover
  if (formattedText) {
    await sendSafeMessage(sock, jid, formattedText, msg, "agent");
  }

  // Dispatch action tags (SEND_FILE, SEND_IMAGE, SEND_AUDIO, SEND_VIDEO)
  for (const action of actions) {
    try {
      if (!fs.existsSync(action.targetPath)) continue;

      if (action.type === "SEND_FILE") {
        await sock.sendMessage(jid, {
          document: { url: action.targetPath },
          mimetype: "application/octet-stream",
          fileName: path.basename(action.targetPath),
        });
      } else if (action.type === "SEND_IMAGE") {
        await sock.sendMessage(jid, {
          image: { url: action.targetPath },
          caption: path.basename(action.targetPath),
        });
      } else if (action.type === "SEND_AUDIO") {
        await sock.sendMessage(jid, {
          audio: { url: action.targetPath },
          mimetype: "audio/mp4",
        });
      } else if (action.type === "SEND_VIDEO") {
        await sock.sendMessage(jid, {
          video: { url: action.targetPath },
          caption: path.basename(action.targetPath),
        });
      }
    } catch (err) {
      console.error(`[ActionTag Error] Failed to dispatch media: ${err.message}`);
    }
  }
}

module.exports = {
  handleMessage,
};
