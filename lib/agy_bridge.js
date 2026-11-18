/**
 * Antigravity (AGY) CLI Bridge (v1.5.0)
 * Streams interactions between WhatsApp and the Antigravity Agent engine.
 * Supports hot model switching, session persistence, live progress telemetry,
 * step execution auditing, tool activity hooks, and process termination.
 */

const { spawn } = require("child_process");
const config = require("../config");
const { buildSkillAugmentedPrompt } = require("./skills");

// Persistent state across Hot-Reload cycles
global.__wa2shell_state = global.__wa2shell_state || {
  sessions: new Map(),
  currentModel: config.agy.defaultModel,
  activeProcesses: new Map(),
  lastSteps: [],
};

const sessions = global.__wa2shell_state.sessions;
const activeProcesses = global.__wa2shell_state.activeProcesses;

function getActiveModel() {
  return global.__wa2shell_state.currentModel || config.agy.defaultModel;
}

function setActiveModel(modelName) {
  global.__wa2shell_state.currentModel = modelName;
  return global.__wa2shell_state.currentModel;
}

function getSession(jid) {
  const sess = sessions.get(jid);
  if (!sess) return null;
  const isExpired = Date.now() - sess.lastActive > config.agy.sessionTtlMs;
  if (isExpired) {
    sessions.delete(jid);
    return null;
  }
  return sess;
}

function resetSession(jid) {
  return sessions.delete(jid);
}

function getLastSteps() {
  return global.__wa2shell_state.lastSteps || [];
}

function killAgent(jid) {
  const proc = activeProcesses.get(jid);
  if (!proc || !proc.child) return false;
  try {
    proc.child.kill("SIGKILL");
    activeProcesses.delete(jid);
    return true;
  } catch (_) {
    return false;
  }
}

function getActiveAgents() {
  const list = [];
  activeProcesses.forEach((val, key) => {
    list.push({
      jid: key,
      pid: val.child ? val.child.pid : null,
      prompt: val.prompt,
      model: val.model,
      elapsedSec: ((Date.now() - val.startedAt) / 1000).toFixed(1),
    });
  });
  return list;
}

function getToolEmoji(toolName) {
  if (!toolName) return "🔧";
  if (toolName === "run_command") return "⚙️";
  if (toolName.includes("file") || toolName.includes("write") || toolName.includes("edit")) return "📝";
  if (toolName.includes("search") || toolName.includes("grep") || toolName.includes("find")) return "🔍";
  if (toolName.includes("subagent") || toolName.includes("swarm") || toolName.includes("workflow")) return "🤖";
  return "🔧";
}

function formatToolSummary(toolName, params = {}) {
  if (!params) return toolName;
  if (params.toolSummary) return params.toolSummary;
  if (toolName === "run_command" && params.CommandLine) {
    const cmd = String(params.CommandLine).trim().replace(/\r?\n+/g, " ");
    return cmd.length > 55 ? cmd.slice(0, 52) + "..." : cmd;
  }
  if ((toolName === "read_file" || toolName === "write_file" || toolName === "edit_file") && params.Path) {
    const p = String(params.Path).trim();
    const parts = p.split(/[/\\]/);
    return parts.length > 2 ? parts.slice(-2).join("/") : parts.pop() || p;
  }
  if (toolName === "search_web" && params.query) {
    const q = String(params.query).trim();
    return q.length > 45 ? `"${q.slice(0, 42)}..."` : `"${q}"`;
  }
  if (params.CommandLine) {
    const cmd = String(params.CommandLine).trim().replace(/\r?\n+/g, " ");
    return cmd.length > 55 ? cmd.slice(0, 52) + "..." : cmd;
  }
  return toolName;
}

function formatStepsReport(steps = [], durationSec = "0.0", model = "") {
  if (!Array.isArray(steps) || steps.length === 0) {
    return "ℹ️ *Tidak ada riwayat tool yang tercatat pada sesi ini.*";
  }

  let text = `📊 *AGY Agent Execution Steps* (⏱️ ${durationSec}s${model ? ` • \`${model}\`` : ""})\n\n`;
  steps.forEach((s, idx) => {
    const num = idx + 1;
    const dur = s.durationSec ? ` _(${s.durationSec}s)_` : "";
    if (s.type === "tool") {
      text += `*${num}.* ${s.emoji || "🔧"} *\`${s.toolName}\`:* ${s.summary}${dur}\n`;
    } else if (s.type === "thinking") {
      text += `*${num}.* 🧠 *Analisa Permintaan*${dur}\n`;
    } else if (s.type === "agent_response") {
      text += `*${num}.* ✨ *Sintesis Jawaban*${dur}\n`;
    } else {
      text += `*${num}.* 🔹 *${s.type}*${dur}\n`;
    }
  });

  return text.trim();
}

function runAgyPrompt({ prompt, conversationId, jid, onToolUpdate, onProgress, onTextDelta }) {
  return new Promise((resolve) => {
    const currentModel = getActiveModel();
    const args = [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--dangerously-skip-permissions",
      "--disable-slash-commands",
      "--model",
      currentModel,
    ];

    if (conversationId) {
      args.unshift(conversationId);
      args.unshift("--conversation");
    }

    const env = {
      ...process.env,
      PATH: `/root/.local/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ""}`,
    };

    const child = spawn(config.agy.binPath, args, {
      cwd: config.agy.workDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const startTime = Date.now();
    if (jid) {
      activeProcesses.set(jid, {
        child,
        prompt: prompt.slice(0, 100),
        model: currentModel,
        startedAt: startTime,
      });
    }

    let detectedConvId = conversationId || null;
    let finalResponse = "";
    let streamedText = "";
    let stderrBuf = "";
    let stdoutBuffer = "";
    const toolsUsed = [];
    const steps = [];

    const processLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("{")) return;
      try {
        const evt = JSON.parse(trimmed);
        if (evt.event === "init" && evt.conversation_id) {
          detectedConvId = evt.conversation_id;
        } else if (evt.event === "step_update" && evt.step_update) {
          const su = evt.step_update;
          if (su.conversation_id) detectedConvId = su.conversation_id;

          const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

          if (su.step_type === "tool" && su.tool_name) {
            const toolName = su.tool_name;
            const toolParams = su.tool_info?.parameters || {};
            const toolSummary = formatToolSummary(toolName, toolParams);
            const toolEmoji = getToolEmoji(toolName);

            if (su.state === "ACTIVE") {
              if (!toolsUsed.includes(toolName)) {
                toolsUsed.push(toolName);
              }
              const stepEntry = {
                stepIndex: su.step_index || (steps.length + 1),
                type: "tool",
                toolName,
                summary: toolSummary,
                emoji: toolEmoji,
                state: "ACTIVE",
                startedAt: Date.now(),
                durationSec: null,
              };
              steps.push(stepEntry);

              if (onProgress) {
                onProgress({
                  type: "tool_start",
                  stepIndex: stepEntry.stepIndex,
                  toolName,
                  toolSummary,
                  emoji: toolEmoji,
                  elapsedSec,
                  totalSteps: steps.length,
                });
              }
              if (onToolUpdate) {
                onToolUpdate(toolName, toolParams);
              }
            } else if (su.state === "DONE") {
              const lastActive = steps.slice().reverse().find((s) => s.type === "tool" && s.toolName === toolName && s.state === "ACTIVE");
              if (lastActive) {
                lastActive.state = "DONE";
                lastActive.durationSec = su.duration_seconds
                  ? Number(su.duration_seconds).toFixed(2)
                  : ((Date.now() - lastActive.startedAt) / 1000).toFixed(1);
              }

              if (onProgress) {
                onProgress({
                  type: "tool_done",
                  stepIndex: su.step_index || steps.length,
                  toolName,
                  toolSummary,
                  emoji: toolEmoji,
                  durationSec: su.duration_seconds ? Number(su.duration_seconds).toFixed(2) : "0.1",
                  elapsedSec,
                  totalSteps: steps.length,
                });
              }
            }
          } else if (su.step_type === "agent_response") {
            if (typeof su.text_delta === "string") {
              streamedText += su.text_delta;
              if (onTextDelta) onTextDelta(su.text_delta, streamedText);
            }
            if (su.state === "ACTIVE" && onProgress) {
              onProgress({
                type: "agent_responding",
                stepIndex: su.step_index || (steps.length + 1),
                elapsedSec,
                totalSteps: steps.length,
              });
            }
          } else if (su.step_type === "thinking" && su.state === "ACTIVE") {
            if (onProgress) {
              onProgress({
                type: "thinking",
                stepIndex: su.step_index || (steps.length + 1),
                elapsedSec,
                totalSteps: steps.length,
              });
            }
          }
        } else if (evt.event === "result" && evt.result) {
          const res = evt.result;
          if (res.conversation_id) detectedConvId = res.conversation_id;
          if (typeof res.response === "string" && res.response.trim()) {
            finalResponse = res.response;
          }
        }
      } catch (_) {
        // Silently bypass unparseable non-JSON log lines
      }
    };

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        processLine(line);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString();
    });

    child.on("close", (code) => {
      if (jid) activeProcesses.delete(jid);
      if (stdoutBuffer.trim()) {
        processLine(stdoutBuffer);
      }

      const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
      const answer =
        finalResponse ||
        streamedText ||
        (code === 0
          ? "Execution completed with no output."
          : `Process terminated with exit code ${code}.\n${stderrBuf.trim()}`);

      global.__wa2shell_state.lastSteps = steps;

      resolve({
        conversationId: detectedConvId,
        response: answer,
        toolsUsed,
        steps,
        durationSec,
        exitCode: code,
      });
    });

    child.on("error", (err) => {
      if (jid) activeProcesses.delete(jid);
      resolve({
        conversationId: detectedConvId,
        response: `Failed to execute Antigravity binary at '${config.agy.binPath}': ${err.message}`,
        toolsUsed: [],
        steps: [],
        durationSec: "0.0",
        exitCode: 1,
      });
    });
  });
}

async function queryAgent(jid, userPrompt, callbacks = {}) {
  const existing = getSession(jid);
  const convId = existing ? existing.conversationId : null;
  const augmentedPrompt = buildSkillAugmentedPrompt(userPrompt, callbacks.forceSkill || null);

  const result = await runAgyPrompt({
    prompt: augmentedPrompt,
    conversationId: convId,
    jid,
    onToolUpdate: callbacks.onToolUpdate,
    onProgress: callbacks.onProgress,
    onTextDelta: callbacks.onTextDelta,
  });

  if (result.conversationId) {
    sessions.set(jid, {
      conversationId: result.conversationId,
      lastActive: Date.now(),
    });
  }

  return result;
}

module.exports = {
  queryAgent,
  resetSession,
  killAgent,
  getActiveAgents,
  getActiveModel,
  setActiveModel,
  getLastSteps,
  formatStepsReport,
  getToolEmoji,
  formatToolSummary,
};
