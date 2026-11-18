#!/usr/bin/env node
/**
 * wa2shell Remotion CLI Tool (v1.6.0)
 * Usage:
 *   node tools/remotion/cli.js check
 *   node tools/remotion/cli.js scaffold [--install]
 *   node tools/remotion/cli.js tts "<text>" <output.mp3> [--voice=id-ID-ArdiNeural]
 *   node tools/remotion/cli.js render <output.mp4> [--composition=KineticShort] [--props=props.json] [--mode=final|preview]
 *   node tools/remotion/cli.js create <spec.json> <output.mp4> [--mode=final|preview]
 */

const fs = require("fs");
const path = require("path");
const {
  checkRemotionEnvironment,
  scaffoldRemotionStudio,
  generateNarrationAudio,
  renderRemotionVideo,
  createQuickMotionVideo,
} = require("../../lib/remotion");

function parseFlags(args) {
  const positional = [];
  const flags = {};
  for (const arg of args) {
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        flags[arg.slice(2)] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function main() {
  const [, , subcmd, ...rest] = process.argv;
  const { positional, flags } = parseFlags(rest);

  if (!subcmd || subcmd === "--help" || subcmd === "-h") {
    console.log(
      [
        "wa2shell Remotion CLI Tool",
        "Commands:",
        "  check                                    Check FFmpeg, Edge-TTS, and Remotion Studio readiness",
        "  scaffold [--install]                     Copy templates to tools/remotion/studio",
        "  tts \"<text>\" <out.mp3> [--voice=...]     Generate double-boosted Edge-TTS audio + frame count",
        "  render <out.mp4> [--props=...] [--mode]  Render a Remotion composition (mode: final|preview)",
        "  create <spec.json> <out.mp4> [--mode]    Generate TTS + render 9:16 motion video from JSON spec",
      ].join("\n")
    );
    process.exit(0);
  }

  if (subcmd === "check") {
    const env = checkRemotionEnvironment();
    console.log(JSON.stringify(env, null, 2));
    process.exit(env.ffmpeg.ok && env.edgeTts.ok && env.node.ok ? 0 : 1);
  }

  if (subcmd === "scaffold") {
    const res = scaffoldRemotionStudio(undefined, { installDeps: Boolean(flags.install) });
    console.log(JSON.stringify(res, null, 2));
    process.exit(0);
  }

  if (subcmd === "tts") {
    const [text, outPath] = positional;
    if (!text || !outPath) {
      console.error("Usage: cli.js tts \"<text>\" <output.mp3> [--voice=id-ID-ArdiNeural]");
      process.exit(1);
    }
    const res = generateNarrationAudio({
      text,
      outputPath: outPath,
      voice: flags.voice || "id-ID-ArdiNeural",
      rate: flags.rate || "+0%",
    });
    console.log(JSON.stringify(res, null, 2));
    process.exit(0);
  }

  if (subcmd === "render") {
    const [outPath] = positional;
    if (!outPath) {
      console.error("Usage: cli.js render <output.mp4> [--composition=KineticShort] [--props=props.json] [--mode=final|preview]");
      process.exit(1);
    }
    const res = renderRemotionVideo({
      compositionId: flags.composition || "KineticShort",
      propsPath: flags.props || null,
      outputPath: outPath,
      mode: flags.mode || "final",
    });
    console.log(JSON.stringify(res, null, 2));
    process.exit(0);
  }

  if (subcmd === "create") {
    const [specPath, outPath] = positional;
    if (!specPath || !outPath) {
      console.error("Usage: cli.js create <spec.json> <output.mp4> [--mode=final|preview]");
      process.exit(1);
    }
    const spec = JSON.parse(fs.readFileSync(path.resolve(specPath), "utf8"));
    const res = createQuickMotionVideo({
      ...spec,
      mode: flags.mode || spec.mode || "final",
      outputPath: outPath,
    });
    console.log(JSON.stringify(res, null, 2));
    process.exit(0);
  }

  console.error(`Unknown subcommand: ${subcmd}`);
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error(`[Remotion CLI Error] ${err.message}`);
  process.exit(1);
}
