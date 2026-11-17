/**
 * Antigravity (AGY) CLI Bridge
 * Streams interactions between WhatsApp and the Antigravity Agent engine.
 * Supports hot model switching, session persistence, tool activity hooks, and process termination.
 */

const { spawn } = require("child_process");
const config = require("../config");

// Persistent state across Hot-Reload cycles
global.__wa2shell_state = global.__wa2shell_state || {
  sessions: new Map(),
  currentModel: config.agy.defaultModel,
  activeProcesses: new Map(),
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

function runAgyPrompt({ prompt, conversationId, jid, onToolUpdate, onTextDelta }) {
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

          if (su.step_type === "tool" && su.state === "ACTIVE" && su.tool_name) {
            const toolName = su.tool_name;
            if (!toolsUsed.includes(toolName)) {
              toolsUsed.push(toolName);
            }
            if (onToolUpdate) onToolUpdate(toolName, su.tool_info?.parameters);
          } else if (
            su.step_type === "agent_response" &&
            typeof su.text_delta === "string"
          ) {
            streamedText += su.text_delta;
            if (onTextDelta) onTextDelta(su.text_delta, streamedText);
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

      resolve({
        conversationId: detectedConvId,
        response: answer,
        toolsUsed,
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
        durationSec: "0.0",
        exitCode: 1,
      });
    });
  });
}

async function queryAgent(jid, userPrompt, callbacks = {}) {
  const existing = getSession(jid);
  const convId = existing ? existing.conversationId : null;

  const result = await runAgyPrompt({
    prompt: userPrompt,
    conversationId: convId,
    jid,
    onToolUpdate: callbacks.onToolUpdate,
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
};
