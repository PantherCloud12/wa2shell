/**
 * wa2shell Remotion Video Production & Audio Engine (v1.6.0)
 * Provides environment diagnostics, studio scaffolding, Edge-TTS + FFmpeg double-boosted
 * narration generation, and VPS-optimized 9:16 Remotion rendering.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync, execSync } = require("child_process");
const config = require("../config");

const REMOTION_TOOLS_DIR = path.join(config.paths.root, "tools", "remotion");
const TEMPLATES_DIR = path.join(REMOTION_TOOLS_DIR, "templates");
const DEFAULT_STUDIO_DIR = path.join(REMOTION_TOOLS_DIR, "studio");

function whichBin(name) {
  try {
    return execSync(`command -v ${name}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (_) {
    return null;
  }
}

/**
 * Checks if Remotion, FFmpeg, FFprobe, and Edge-TTS are available on this host.
 */
function checkRemotionEnvironment(studioDir = DEFAULT_STUDIO_DIR) {
  const nodeBin = whichBin("node");
  const ffmpegBin = whichBin("ffmpeg");
  const ffprobeBin = whichBin("ffprobe");
  const edgeTtsBin = whichBin("edge-tts");

  const studioPkg = path.join(studioDir, "package.json");
  const studioModules = path.join(studioDir, "node_modules", "@remotion", "cli");

  const studioInitialized = fs.existsSync(studioPkg);
  const studioInstalled = fs.existsSync(studioModules);

  return {
    node: { ok: Boolean(nodeBin), path: nodeBin, version: process.version },
    ffmpeg: { ok: Boolean(ffmpegBin), path: ffmpegBin },
    ffprobe: { ok: Boolean(ffprobeBin), path: ffprobeBin },
    edgeTts: { ok: Boolean(edgeTtsBin), path: edgeTtsBin },
    studio: {
      dir: studioDir,
      initialized: studioInitialized,
      installed: studioInstalled,
    },
    ready: Boolean(nodeBin && ffmpegBin && ffprobeBin && edgeTtsBin && studioInitialized && studioInstalled),
  };
}

/**
 * Formats environment check for WhatsApp display.
 */
function formatEnvironmentReport(env) {
  const mark = (ok) => (ok ? "✅" : "❌");
  return (
    `🎬 *Remotion Video Environment Status*\n\n` +
    `• ${mark(env.node.ok)} *Node.js:* \`${env.node.version}\`\n` +
    `• ${mark(env.ffmpeg.ok)} *FFmpeg:* ${env.ffmpeg.ok ? `\`${env.ffmpeg.path}\`` : "_Not found_"}\n` +
    `• ${mark(env.ffprobe.ok)} *FFprobe:* ${env.ffprobe.ok ? `\`${env.ffprobe.path}\`` : "_Not found_"}\n` +
    `• ${mark(env.edgeTts.ok)} *Edge-TTS:* ${env.edgeTts.ok ? `\`${env.edgeTts.path}\`` : "_Not found_"}\n` +
    `• ${mark(env.studio.initialized)} *Studio Scaffold:* ${env.studio.initialized ? "Ready" : "Not initialized"}\n` +
    `• ${mark(env.studio.installed)} *Remotion CLI Deps:* ${env.studio.installed ? "Installed" : "Not installed"}\n\n` +
    `📁 *Studio Path:* \`${env.studio.dir}\`\n` +
    (env.ready
      ? `✅ *Status:* Siap render video 9:16! Gunakan \`.video <topik>\` untuk membuat video.`
      : `⚠️ *Tip:* Jalankan \`.remotion setup\` untuk menginisialisasi & menginstall Remotion Studio.`)
  );
}

/**
 * Recursively copies template files into the Remotion studio directory.
 */
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Scaffolds the Remotion Studio workspace and optionally installs npm dependencies.
 */
function scaffoldRemotionStudio(studioDir = DEFAULT_STUDIO_DIR, { installDeps = false } = {}) {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    throw new Error(`Templates directory missing: ${TEMPLATES_DIR}`);
  }

  copyDirRecursive(TEMPLATES_DIR, studioDir);
  fs.mkdirSync(path.join(studioDir, "public", "audio"), { recursive: true });
  fs.mkdirSync(path.join(studioDir, "out"), { recursive: true });

  if (installDeps) {
    execSync("npm install --no-audit --no-fund", {
      cwd: studioDir,
      stdio: "inherit",
    });
  }

  return {
    studioDir,
    installed: fs.existsSync(path.join(studioDir, "node_modules", "@remotion", "cli")),
  };
}

/**
 * Probes media duration in seconds using ffprobe.
 */
function probeDurationSec(filePath) {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
    { encoding: "utf8" }
  ).trim();
  const sec = parseFloat(out);
  if (!Number.isFinite(sec) || sec <= 0) {
    throw new Error(`Invalid media duration from ffprobe for ${filePath}`);
  }
  return sec;
}

/**
 * Generates double-boosted Edge-TTS narration audio and measures exact frame count (30fps).
 */
function generateNarrationAudio({
  text,
  outputPath,
  voice = "id-ID-ArdiNeural",
  rate = "+0%",
  fps = 30,
}) {
  if (!text || !String(text).trim()) {
    throw new Error("Narration text is required");
  }
  const absOut = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });

  const rawPath = `${absOut}.raw.mp3`;

  execFileSync(
    "edge-tts",
    ["--voice", voice, "--rate", rate, "--volume=+50%", "--text", String(text).trim(), "--write-media", rawPath],
    { stdio: "pipe" }
  );

  execFileSync(
    "ffmpeg",
    ["-y", "-i", rawPath, "-filter:a", "volume=2.2,alimiter=limit=0.98", absOut],
    { stdio: "pipe" }
  );

  try {
    fs.unlinkSync(rawPath);
  } catch (_) {}

  const durationSec = probeDurationSec(absOut);
  const durationInFrames = Math.ceil(durationSec * fps) + 12; // +0.4s breathing tail

  return {
    outputPath: absOut,
    durationSec: Number(durationSec.toFixed(2)),
    durationInFrames,
  };
}

/**
 * Renders a Remotion composition with VPS-optimized preset flags.
 */
function renderRemotionVideo({
  studioDir = DEFAULT_STUDIO_DIR,
  compositionId = "KineticShort",
  propsPath = null,
  outputPath,
  mode = "final",
}) {
  if (!fs.existsSync(path.join(studioDir, "node_modules", "@remotion", "cli"))) {
    throw new Error(`Remotion CLI not installed in ${studioDir}. Run: node tools/remotion/cli.js scaffold --install`);
  }

  const absOut = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });

  const args = ["remotion", "render", "src/index.ts", compositionId, absOut];

  if (propsPath) {
    args.push(`--props=${path.resolve(propsPath)}`);
  }

  if (mode === "preview") {
    args.push("--scale=0.5", "--crf=24", "--x264-preset=ultrafast", "--frames=0-150");
  } else {
    args.push("--scale=0.75", "--crf=23", "--x264-preset=ultrafast", "--gl=angle", "--concurrency=2");
  }

  execFileSync("npx", args, {
    cwd: studioDir,
    stdio: "inherit",
  });

  const stat = fs.statSync(absOut);
  const durationSec = probeDurationSec(absOut);

  return {
    outputPath: absOut,
    sizeBytes: stat.size,
    durationSec: Number(durationSec.toFixed(2)),
    mode,
  };
}

/**
 * End-to-end helper: generates TTS for each scene, builds props.json, and renders 9:16 MP4.
 */
function createQuickMotionVideo({
  title = "wa2shell Video",
  accentColor = "#38bdf8",
  secondaryColor = "#a855f7",
  voice = "id-ID-ArdiNeural",
  scenes = [],
  mode = "final",
  outputPath,
  studioDir = DEFAULT_STUDIO_DIR,
}) {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error("At least 1 scene is required in video spec.");
  }

  if (!fs.existsSync(path.join(studioDir, "node_modules", "@remotion", "cli"))) {
    scaffoldRemotionStudio(studioDir, { installDeps: true });
  }

  const audioPublicDir = path.join(studioDir, "public", "audio");
  fs.mkdirSync(audioPublicDir, { recursive: true });

  const runId = Date.now();
  const builtScenes = scenes.map((scene, idx) => {
    const narration = scene.narration || `${scene.heading}. ${scene.body}`;
    const audioFileName = `tts_${runId}_${idx + 1}.mp3`;
    const audioAbsPath = path.join(audioPublicDir, audioFileName);

    const tts = generateNarrationAudio({
      text: narration,
      outputPath: audioAbsPath,
      voice: scene.voice || voice,
    });

    return {
      badge: scene.badge || `SCENE ${idx + 1}`,
      heading: scene.heading || "",
      body: scene.body || "",
      durationInFrames: scene.durationInFrames || tts.durationInFrames,
      audioFile: `audio/${audioFileName}`,
    };
  });

  const propsPath = path.join(config.paths.tmp, `remotion_props_${runId}.json`);
  fs.writeFileSync(
    propsPath,
    JSON.stringify(
      {
        title,
        accentColor,
        secondaryColor,
        scenes: builtScenes,
      },
      null,
      2
    ),
    "utf8"
  );

  return renderRemotionVideo({
    studioDir,
    compositionId: "KineticShort",
    propsPath,
    outputPath,
    mode,
  });
}

module.exports = {
  REMOTION_TOOLS_DIR,
  TEMPLATES_DIR,
  DEFAULT_STUDIO_DIR,
  checkRemotionEnvironment,
  formatEnvironmentReport,
  scaffoldRemotionStudio,
  probeDurationSec,
  generateNarrationAudio,
  renderRemotionVideo,
  createQuickMotionVideo,
};
