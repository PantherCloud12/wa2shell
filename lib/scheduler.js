/**
 * Autonomous Task & Cron Scheduler Engine (v1.7.0)
 * Schedules recurring shell commands or Antigravity AI checks from WhatsApp.
 */

const fs = require("fs");
const path = require("path");
const config = require("../config");
const { executeShell } = require("./shell");
const { queryAgent } = require("./agy_bridge");
const { sanitizeOutput } = require("./sanitizer");
const { formatAIResponse } = require("./formatter");

const CRON_FILE = path.join(config.paths.session, "cron_jobs.json");

global.__wa2shell_state = global.__wa2shell_state || {};

function loadJobs() {
  try {
    if (!fs.existsSync(CRON_FILE)) return [];
    const raw = fs.readFileSync(CRON_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function saveJobs(jobs) {
  try {
    fs.writeFileSync(CRON_FILE, JSON.stringify(jobs, null, 2), "utf8");
  } catch (err) {
    console.error("[wa2shell Scheduler] Failed to save cron jobs:", err.message);
  }
}

function addCronJob({ jid, intervalMin, command }) {
  const mins = Math.max(1, parseInt(intervalMin, 10) || 60);
  const trimmed = String(command || "").trim();
  const isShell = trimmed.startsWith("$ ") || trimmed.startsWith(".sh ");
  const cleanCmd = isShell ? trimmed.replace(/^(\$\s+|\.sh\s+)/, "").trim() : trimmed;

  const jobs = loadJobs();
  const id = `c${Date.now().toString(36).slice(-5)}`;
  const now = Date.now();
  const job = {
    id,
    jid,
    type: isShell ? "shell" : "ai",
    command: cleanCmd,
    intervalMin: mins,
    createdAt: now,
    lastRunAt: 0,
    nextRunAt: now + mins * 60 * 1000,
    runCount: 0,
    lastStatus: "pending",
  };
  jobs.push(job);
  saveJobs(jobs);
  return job;
}

function listCronJobs(jid = null) {
  const jobs = loadJobs();
  return jid ? jobs.filter((j) => j.jid === jid) : jobs;
}

function removeCronJob(id) {
  const jobs = loadJobs();
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx === -1) return null;
  const [removed] = jobs.splice(idx, 1);
  saveJobs(jobs);
  return removed;
}

function clearCronJobs(jid = null) {
  if (!jid) {
    saveJobs([]);
    return true;
  }
  const jobs = loadJobs().filter((j) => j.jid !== jid);
  saveJobs(jobs);
  return true;
}

async function runJob(sock, job) {
  const now = Date.now();
  try {
    let outputText = "";
    if (job.type === "shell") {
      const res = await executeShell(job.command, job.jid);
      const raw = res.stdout || res.stderr || "(no output)";
      outputText = `⏰ *Cron Shell [${job.id}]* (\`$ ${job.command}\`)\n\`\`\`\n${sanitizeOutput(raw).slice(0, 2800)}\n\`\`\``;
    } else {
      const res = await queryAgent(job.jid, job.command, {});
      const { formattedText } = formatAIResponse(res.response || "");
      outputText = `⏰ *Cron AI [${job.id}]* (\`${job.command.slice(0, 40)}\`)\n\n${sanitizeOutput(formattedText).slice(0, 2800)}`;
    }
    await sock.sendMessage(job.jid, { text: outputText });
    return "ok";
  } catch (err) {
    try {
      await sock.sendMessage(job.jid, {
        text: `❌ *Cron Job [${job.id}] Failed:*\n\`${err.message}\``,
      });
    } catch (_) {}
    return `error: ${err.message}`;
  } finally {
    const jobs = loadJobs();
    const target = jobs.find((j) => j.id === job.id);
    if (target) {
      target.lastRunAt = now;
      target.nextRunAt = now + target.intervalMin * 60 * 1000;
      target.runCount = (target.runCount || 0) + 1;
      saveJobs(jobs);
    }
  }
}

function startScheduler(sock) {
  if (global.__wa2shell_state.cronTimer) {
    clearInterval(global.__wa2shell_state.cronTimer);
  }
  global.__wa2shell_state.cronRunning = global.__wa2shell_state.cronRunning || new Set();

  global.__wa2shell_state.cronTimer = setInterval(async () => {
    if (!sock || !sock.user) return;
    const now = Date.now();
    const jobs = loadJobs();
    for (const job of jobs) {
      if (job.nextRunAt <= now && !global.__wa2shell_state.cronRunning.has(job.id)) {
        global.__wa2shell_state.cronRunning.add(job.id);
        runJob(sock, job)
          .then((status) => {
            const latest = loadJobs();
            const item = latest.find((j) => j.id === job.id);
            if (item) {
              item.lastStatus = status;
              saveJobs(latest);
            }
          })
          .finally(() => {
            global.__wa2shell_state.cronRunning.delete(job.id);
          });
      }
    }
  }, 30 * 1000);
}

module.exports = {
  addCronJob,
  listCronJobs,
  removeCronJob,
  clearCronJobs,
  startScheduler,
};
