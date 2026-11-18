import React from "react";
import { Composition } from "remotion";
import { KineticShort, KineticShortProps } from "./KineticShort";

const defaultProps: KineticShortProps = {
  title: "wa2shell Motion Engine",
  accentColor: "#38bdf8",
  secondaryColor: "#a855f7",
  bgmFile: "",
  scenes: [
    {
      badge: "HOOK",
      heading: "Kontrol Server Cukup Lewat WhatsApp",
      body: "Jalankan AI Agent, pantau hardware, dan render video langsung dari chat.",
      durationInFrames: 120,
      audioFile: "",
    },
    {
      badge: "FITUR",
      heading: "Otomatisasi Tanpa Batas",
      body: "Dilengkapi telemetry live, hot-reload instan, dan Remotion 9:16 engine.",
      durationInFrames: 120,
      audioFile: "",
    },
  ],
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="KineticShort"
      component={KineticShort}
      durationInFrames={240}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => {
        const total = (props.scenes || []).reduce(
          (acc, s) => acc + Math.max(30, s.durationInFrames || 120),
          0
        );
        return {
          durationInFrames: Math.max(60, total),
          fps: 30,
          width: 1080,
          height: 1920,
        };
      }}
    />
  );
};
