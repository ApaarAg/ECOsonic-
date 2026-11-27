/* eslint-disable */
"use client";

import { motion } from "motion/react";
import FocusReveal from "./focus-reveal";

export type Hero13SceneVariant = "expected-species" | "observation-gap";

type HeroContentProps = {
  activeScene?: Hero13SceneVariant;
  reducedMotion?: boolean;
  align?: "center" | "responsive-start";
};

const SCENE_COPY: Record<
  Hero13SceneVariant,
  {
    heading: string;
    supportingText: string;
  }
> = {
  "expected-species": {
    heading: "EXPECTED SPECIES",
    supportingText:
      "Species expected in this ecological context based on the available acoustic and environmental evidence.",
  },
  "observation-gap": {
    heading: "OBSERVATION GAP",
    supportingText:
      "Compare expected taxa with what was actually detected in the acoustic record.",
  },
};

export const HeroContent = ({
  activeScene = "expected-species",
  reducedMotion = false,
  align = "center",
}: HeroContentProps) => {
  const copy = SCENE_COPY[activeScene];
  const alignClasses =
    align === "responsive-start"
      ? "items-center text-center md:items-start md:text-left"
      : "items-center text-center";

  return (
    <div
      className={`relative z-20 flex w-full py-1 ${
        align === "responsive-start" ? "justify-center md:justify-start" : "justify-center"
      }`}
      data-testid="hero13-scene-copy"
      data-active-scene={activeScene}
    >
      <div className={`relative z-10 flex w-full flex-col gap-1.5 ${alignClasses}`}>
        <motion.div
          key={activeScene}
          initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0.05 : 0.35, ease: [0.22, 1, 0.36, 1] }}
          className={`flex w-full flex-col gap-1 ${alignClasses}`}
        >
          <FocusReveal
            key={`heading-${activeScene}`}
            as="h2"
            text={copy.heading}
            className="w-full font-instrument-serif text-[20px] leading-[1.12] tracking-[0.04em] text-[#E8E4DC]/90 md:text-[26px]"
            staggerFrom="start"
            blur={reducedMotion ? 0 : 12}
            transition={{
              type: "tween",
              duration: reducedMotion ? 0.1 : 0.32,
              staggerChildren: reducedMotion ? 0 : 0.02,
              ease: "easeOut",
            }}
          />

          <p
            className={`font-tight text-[11px] leading-[1.4] tracking-[-0.01em] text-[#D8D4C8]/65 md:text-[12px] ${
              align === "responsive-start"
                ? "max-w-[330px] md:max-w-[295px]"
                : "max-w-[330px]"
            }`}
          >
            {copy.supportingText}
          </p>
        </motion.div>
      </div>
    </div>
  );
};
