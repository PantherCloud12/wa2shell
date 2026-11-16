/**
 * Message Handler
 * Parses incoming WhatsApp messages, commands, direct bash triggers, and Antigravity queries.
 */

const fs = require("fs");
const path = require("path");
const config = require("../config");
const { executeShell } = require("./shell");
const { queryAgent, resetSession, getActiveModel, setActiveModel } = require("./agy_bridge");

function parseActionTags(text) {
  const actions = [];
  const tagRegex = /\[\[(SEND_FILE|SEND_IMAGE|SEND_AUDIO|SEND_VIDEO):([^\]]+)\]\]/g;
  let match;
  while ((match = tagRegex.exec(text)) !== null) {
    actions.push({
      type: match[1],
      targetPath: match[2].trim(),
    });
  }
  const cleanText = text.replace(tagRegex, "").trim();
  return { cleanText, actions };
}

async function handleMessage(sock, m) {
  if (!m.messages || !m.messages[0]) return;
  const msg = m.messages[0];
  if (msg.key && msg.key.fromMe) return;

  const jid = msg.key.remoteJid;
  const isGroup = jid.endsWith("@g.us");
  const senderJid = isGroup ? (msg.key.participant || msg.participant || "") : jid;
  const senderNumber = senderJid.replace(/[^0-9]/g, "");

  // Extract text content across standard message types
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
    return; // Silently ignore unauthorized messages if owner-only policy is enforced
  }

  // 1. Direct Shell Execution ($ command or .sh command)
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

    const result = await executeShell(command);
    let reply = `*Exit Code:* ${result.exitCode} (${result.durationSec}s)\n`;
    if (result.output) {
      reply += `\n\`\`\`\n${result.output}\n\`\`\``;
    } else {
      reply += `\n_(Command completed with empty output)_`;
    }

    await sock.sendMessage(jid, { text: reply }, { quoted: msg });
    return;
  }

  // 2. Command .reset (Clear Agent Session)
  if (text === ".reset" || text === ".clear") {
    resetSession(jid);
    await sock.sendMessage(
      jid,
      { text: "🔄 *Session Cleared:* Conversation context has been reset. Your next message will start a fresh session." },
      { quoted: msg }
    );
    return;
  }

  // 3. Command .model (Inspect or Switch Agent Model)
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
    await sock.sendMessage(
      jid,
      { text: `✅ *Model Updated:* Switched active model to \`${newModel}\`` },
      { quoted: msg }
    );
    return;
  }

  // 4. Command .status (Quick Host Healthcheck)
  if (text === ".status" || text === ".ping") {
    const uptimeRes = await executeShell("uptime -p && free -h | grep Mem && df -h / | tail -n 1");
    const info = uptimeRes.output ? `\`\`\`\n${uptimeRes.output}\n\`\`\`` : "Host system operational.";
    await sock.sendMessage(
      jid,
      { text: `⚡ *wa2shell Status*\n• Daemon: *Online*\n• Model: \`${getActiveModel()}\`\n\n${info}` },
      { quoted: msg }
    );
    return;
  }

  // 5. Antigravity Agent Query
  // Triggered in 1-on-1 DMs, or prefixed with .ai/.agy, or by @mentioning the bot in groups
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

  // React to acknowledge receipt
  try {
    await sock.sendMessage(jid, { react: { text: "⚡", key: msg.key } });
  } catch (_) {}

  // Invoke Antigravity Bridge
  const result = await queryAgent(jid, promptText);
  const { cleanText, actions } = parseActionTags(result.response);

  // Send textual agent response
  if (cleanText) {
    await sock.sendMessage(jid, { text: cleanText }, { quoted: msg });
  }

  // Dispatch any action tags (SEND_FILE, SEND_IMAGE, SEND_AUDIO, SEND_VIDEO)
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
