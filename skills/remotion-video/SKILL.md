---
name: remotion-video
description: Create polished 9:16 portrait motion graphics videos with Remotion, Edge-TTS double-boosted narration, SFX, BGM ducking, and fast VPS rendering, then deliver directly to WhatsApp via [[SEND_VIDEO:...]].
---

# Remotion Motion Graphics Video Skill (wa2shell)

Use this skill whenever the user asks to create a video, motion graphic, explainer, promo, Reels, TikTok, or YouTube Shorts with Remotion.

## 1. Mandatory Video & Audio Standards
1. **Format Portrait 9:16 (1080x1920 @ 30fps)**:
   - Every video MUST be vertical `1080x1920` at `30` fps.
   - Safe area padding: top `>= 200px`, bottom `>= 220px`, left/right `>= 80px`.
2. **Structured 4-Scene Narrative**:
   - Before coding visuals, write a concise 4-part script:
     1. **Hook** (0–4s): Bold question or surprising fact.
     2. **Problem / Context**: Core tension or data.
     3. **Deep Dive / Solution**: Key explanation with visual metaphor.
     4. **Conclusion / Outro**: Crisp takeaway or CTA.
3. **Loud, Clear TTS Narration (Double-Boosted)**:
   - Use `edge-tts` with Indonesian voices:
     - `id-ID-ArdiNeural` (male): tech, server, coding, science, news, serious topics.
     - `id-ID-GadisNeural` (female): friendly education, tips, lifestyle, motivation.
   - Generate with `--volume=+50%`, then boost via FFmpeg:
     `ffmpeg -i raw.mp3 -filter:a "volume=2.2,alimiter=limit=0.98" boosted.mp3 -y`
   - Or use the built-in tool:
     `node /root/wa2shell/tools/remotion/cli.js tts "Teks narasi" /root/wa2shell/tmp/narration.mp3 --voice=id-ID-ArdiNeural`
   - Measure exact duration with `ffprobe` so scene frame counts match the spoken audio!
4. **SFX & BGM Ducking**:
   - Frame-lock SFX to animations (`pop_clean.wav` on UI reveal, `whoosh_fast.wav` on scene transition, `hit_bass.wav` on impact frame, `chime_success.wav` on outro).
   - Keep BGM volume at `0.18–0.26` during narration and `0.40–0.55` during pauses.
5. **Anti-Slop 3-Layer Visual Architecture**:
   - **Layer 0 (Background)**: Radial ambient glow, subtle SVG cyber/dot grid, moving scanline.
   - **Layer 1 (Center Stage Metaphor)**: Animated SVG paths (`strokeDashoffset`), data packets, server nodes, neural links, or dynamic charts — never just plain empty boxes.
   - **Layer 2 (Foreground)**: Large high-contrast kinetic typography (Headline `72–100px`, Body `42–52px`), pill highlight badges, and subtle impact shake.
   - Use snappy spring physics: `config: { damping: 14, stiffness: 140, mass: 0.8 }`.
6. **Fast VPS Rendering**:
   - **Preview / Sample**: `--scale=0.5 --crf=24 --x264-preset=ultrafast --frames=0-150`
   - **Final HD Render**: `--scale=0.75 --crf=23 --x264-preset=ultrafast --gl=angle --concurrency=2`

## 2. Built-in wa2shell Remotion CLI Tool
Use `/root/wa2shell/tools/remotion/cli.js` to inspect, scaffold, generate TTS, or render quickly:

- **Check environment**:
  `node /root/wa2shell/tools/remotion/cli.js check`
- **Scaffold Remotion Studio** (if not yet initialized):
  `node /root/wa2shell/tools/remotion/cli.js scaffold --install`
- **Generate boosted TTS + get exact frames**:
  `node /root/wa2shell/tools/remotion/cli.js tts "Halo dunia!" /root/wa2shell/tmp/scene1.mp3 --voice=id-ID-ArdiNeural`
- **Quick multi-scene video from JSON config**:
  `node /root/wa2shell/tools/remotion/cli.js create /root/wa2shell/tmp/video_spec.json /root/wa2shell/tmp/output.mp4 --mode=final`
- **Render a custom composition**:
  `node /root/wa2shell/tools/remotion/cli.js render /root/wa2shell/tmp/output.mp4 --composition=KineticShort --props=/root/wa2shell/tmp/props.json --mode=final`

## 3. WhatsApp Delivery
Once the `.mp4` render succeeds and you verify the file exists (`ls -lh /path/to/video.mp4`), include this tag at the end of your response so `wa2shell` sends the video directly to WhatsApp:
`[[SEND_VIDEO:/root/wa2shell/tmp/output.mp4]]`
