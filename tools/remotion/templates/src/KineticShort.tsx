import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export interface SceneSpec {
  badge: string;
  heading: string;
  body: string;
  durationInFrames: number;
  audioFile?: string;
  sfxFile?: string;
}

export interface KineticShortProps {
  title: string;
  accentColor?: string;
  secondaryColor?: string;
  bgmFile?: string;
  scenes: SceneSpec[];
}

const BackgroundLayer: React.FC<{
  accentColor: string;
  secondaryColor: string;
}> = ({ accentColor, secondaryColor }) => {
  const frame = useCurrentFrame();
  const scanY = (frame * 8) % 1920;
  const pulse = 0.85 + Math.sin(frame * 0.06) * 0.15;

  return (
    <AbsoluteFill style={{ backgroundColor: "#060913", overflow: "hidden" }}>
      {/* Radial ambient dual glow */}
      <div
        style={{
          position: "absolute",
          top: -220,
          left: -180,
          width: 900,
          height: 900,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${accentColor}33 0%, transparent 70%)`,
          transform: `scale(${pulse})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -240,
          right: -180,
          width: 950,
          height: 950,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${secondaryColor}2e 0%, transparent 70%)`,
          transform: `scale(${1.8 - pulse * 0.8})`,
        }}
      />

      {/* Subtle SVG cyber grid */}
      <svg width="1080" height="1920" style={{ position: "absolute", opacity: 0.16 }}>
        <defs>
          <pattern id="grid" width="90" height="90" patternUnits="userSpaceOnUse">
            <path
              d="M 90 0 L 0 0 0 90"
              fill="none"
              stroke={accentColor}
              strokeWidth="1.2"
            />
          </pattern>
        </defs>
        <rect width="1080" height="1920" fill="url(#grid)" />
      </svg>

      {/* Moving laser scanline */}
      <div
        style={{
          position: "absolute",
          top: scanY,
          left: 0,
          right: 0,
          height: 4,
          background: `linear-gradient(90deg, transparent, ${accentColor}88, transparent)`,
          boxShadow: `0 0 24px ${accentColor}`,
        }}
      />
    </AbsoluteFill>
  );
};

const SceneVisualMetaphor: React.FC<{
  sceneIndex: number;
  accentColor: string;
  secondaryColor: string;
}> = ({ sceneIndex, accentColor, secondaryColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const drawProgress = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 120, mass: 0.8 },
  });

  const dashOffset = interpolate(drawProgress, [0, 1], [600, 0]);
  const packetT = (frame % 60) / 60;
  const packetX = interpolate(packetT, [0, 1], [140, 780]);
  const packetY = 170 + Math.sin(packetT * Math.PI * 2 + sceneIndex) * 45;

  return (
    <div style={{ width: "100%", height: 340, display: "flex", justifyContent: "center", alignItems: "center" }}>
      <svg width="920" height="320" viewBox="0 0 920 320">
        {/* Circuit path */}
        <path
          d="M 100 170 C 260 70, 420 270, 580 170 C 680 110, 760 200, 820 170"
          fill="none"
          stroke={accentColor}
          strokeWidth="5"
          strokeDasharray="600"
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
        />
        <path
          d="M 100 220 C 300 290, 520 60, 820 210"
          fill="none"
          stroke={secondaryColor}
          strokeWidth="3"
          strokeOpacity="0.65"
          strokeDasharray="600"
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
        />
        {/* Nodes */}
        {[100, 460, 820].map((cx, i) => (
          <g key={cx}>
            <circle
              cx={cx}
              cy={i === 1 ? 170 : 185}
              r={22 + Math.sin(frame * 0.15 + i) * 3}
              fill="#0b1224"
              stroke={i === 1 ? secondaryColor : accentColor}
              strokeWidth="4"
            />
            <circle
              cx={cx}
              cy={i === 1 ? 170 : 185}
              r="8"
              fill={i === 1 ? secondaryColor : accentColor}
            />
          </g>
        ))}
        {/* Moving data packet */}
        <circle cx={packetX} cy={packetY} r="11" fill="#ffffff" />
        <circle cx={packetX} cy={packetY} r="20" fill={accentColor} opacity="0.35" />
      </svg>
    </div>
  );
};

const SceneCard: React.FC<{
  scene: SceneSpec;
  sceneIndex: number;
  totalScenes: number;
  accentColor: string;
  secondaryColor: string;
}> = ({ scene, sceneIndex, totalScenes, accentColor, secondaryColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 140, mass: 0.8 },
  });

  const translateY = interpolate(enter, [0, 1], [60, 0]);
  const opacity = interpolate(enter, [0, 1], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        paddingTop: 210,
        paddingBottom: 230,
        paddingLeft: 80,
        paddingRight: 80,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* Top Header & Badge */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          opacity,
          transform: `translateY(${translateY * 0.5}px)`,
        }}
      >
        <div
          style={{
            padding: "14px 30px",
            borderRadius: 999,
            backgroundColor: `${accentColor}22`,
            border: `2px solid ${accentColor}`,
            color: accentColor,
            fontSize: 30,
            fontWeight: 800,
            letterSpacing: 2,
          }}
        >
          {scene.badge || `SCENE ${sceneIndex + 1}`}
        </div>
        <div style={{ color: "#94a3b8", fontSize: 28, fontWeight: 700 }}>
          {sceneIndex + 1} / {totalScenes}
        </div>
      </div>

      {/* Center Stage Metaphor */}
      <SceneVisualMetaphor
        sceneIndex={sceneIndex}
        accentColor={accentColor}
        secondaryColor={secondaryColor}
      />

      {/* Kinetic Typography Block */}
      <div
        style={{
          opacity,
          transform: `translateY(${translateY}px)`,
          background: "linear-gradient(145deg, rgba(15,23,42,0.88), rgba(15,23,42,0.62))",
          border: `2px solid ${accentColor}44`,
          borderRadius: 36,
          padding: "48px 44px",
          boxShadow: `0 24px 60px rgba(0,0,0,0.55), 0 0 40px ${accentColor}1a`,
        }}
      >
        <h1
          style={{
            margin: 0,
            color: "#f8fafc",
            fontSize: 70,
            fontWeight: 900,
            lineHeight: 1.15,
            marginBottom: 24,
          }}
        >
          {scene.heading}
        </h1>
        <p
          style={{
            margin: 0,
            color: "#cbd5e1",
            fontSize: 42,
            fontWeight: 500,
            lineHeight: 1.4,
          }}
        >
          {scene.body}
        </p>
      </div>
    </AbsoluteFill>
  );
};

export const KineticShort: React.FC<KineticShortProps> = ({
  title,
  accentColor = "#38bdf8",
  secondaryColor = "#a855f7",
  bgmFile = "",
  scenes = [],
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progressPct = Math.min(100, Math.max(0, (frame / Math.max(1, durationInFrames)) * 100));

  let cursor = 0;

  return (
    <AbsoluteFill>
      <BackgroundLayer accentColor={accentColor} secondaryColor={secondaryColor} />

      {bgmFile ? (
        <Audio src={bgmFile.startsWith("/") ? bgmFile : staticFile(bgmFile)} volume={0.22} />
      ) : null}

      {scenes.map((scene, idx) => {
        const dur = Math.max(30, scene.durationInFrames || 120);
        const startFrame = cursor;
        cursor += dur;

        return (
          <Sequence key={`${idx}-${scene.badge}`} from={startFrame} durationInFrames={dur}>
            <SceneCard
              scene={scene}
              sceneIndex={idx}
              totalScenes={scenes.length}
              accentColor={accentColor}
              secondaryColor={secondaryColor}
            />
            {scene.audioFile ? (
              <Audio
                src={scene.audioFile.startsWith("/") ? scene.audioFile : staticFile(scene.audioFile)}
                volume={1.6}
              />
            ) : null}
            {scene.sfxFile ? (
              <Audio
                src={scene.sfxFile.startsWith("/") ? scene.sfxFile : staticFile(scene.sfxFile)}
                volume={0.7}
              />
            ) : null}
          </Sequence>
        );
      })}

      {/* Persistent Top Brand & Bottom Progress Bar */}
      <div
        style={{
          position: "absolute",
          top: 90,
          left: 80,
          right: 80,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <span style={{ color: "#e2e8f0", fontSize: 30, fontWeight: 800, letterSpacing: 1 }}>
          ⚡ {title}
        </span>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 130,
          left: 80,
          right: 80,
          height: 10,
          borderRadius: 99,
          backgroundColor: "rgba(255,255,255,0.12)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progressPct}%`,
            height: "100%",
            background: `linear-gradient(90deg, ${accentColor}, ${secondaryColor})`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
