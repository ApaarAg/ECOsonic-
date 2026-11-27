/* eslint-disable */
"use client";

import {
  DEFAULT_BIRD_TUNNEL_SLIDES,
  type BirdTunnelSlide,
} from "../../../../visual/ExpectedSpecies/birdTunnelAssets";
import GalleryTunnel from "./gallery-tunnel";
import { HeroContent, type Hero13SceneVariant } from "./hero-content";

export interface Section20HeroProps {
  activeScene?: Hero13SceneVariant;
  images?: readonly BirdTunnelSlide[];
  overlayOnly?: boolean;
  opacity?: number;
  reducedMotion?: boolean;
}

export const Section20Hero = ({
  activeScene = "expected-species",
  images = DEFAULT_BIRD_TUNNEL_SLIDES,
  overlayOnly = false,
  opacity = 1,
  reducedMotion = false,
}: Section20HeroProps) => {
  if (overlayOnly) {
    return (
      <div
        aria-label={
          activeScene === "expected-species"
            ? "Expected Species"
            : "Observation Gap"
        }
        data-testid="shared-hero13-chapter"
        className="pointer-events-none fixed inset-0 z-10 hidden flex-col items-start justify-end px-8 pb-7 md:flex xl:px-12"
        style={{
          opacity,
          transition: reducedMotion ? undefined : "opacity 280ms ease-out",
        }}
      >
        <div className="w-full max-w-[300px]">
          <HeroContent
            activeScene={activeScene}
            reducedMotion={reducedMotion}
            align="responsive-start"
          />
        </div>
      </div>
    );
  }

  return (
    <section
      aria-label={
        activeScene === "expected-species"
          ? "Expected Species"
          : "Observation Gap"
      }
      className="relative isolate flex min-h-svh w-full items-center justify-center overflow-hidden bg-[#131313]"
    >
      {/* 3D bird-photography tunnel */}
      <div
        aria-hidden="true"
        className="pointer-events-auto absolute inset-0 z-0"
      >
        <GalleryTunnel
          images={[...images]}
          background="#131313"
          lineColor="#B0B0B0"
          lineOpacity={0}
          grid={8}
          speed={50}
          boost={100}
          fade={100}
          label={false}
          cellMode="square"
        />
      </div>

      {/* Smooth radial vignette wash behind text so copy stays readable while 3D images blend naturally */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 z-10 h-[80vh] w-[100vw] wide-lg:w-[50vw] wide-lg:h-[50vh] ipad:w-[75vw] desktop-sm:w-[55vw] -translate-x-1/2 -translate-y-1/2 bg-[#131313]/75 blur-[25px]"
      />

      <div className="pointer-events-none relative z-20 flex w-full max-w-[763px] items-center justify-center py-12">
        <div className="pointer-events-auto relative flex w-full items-center justify-center">
          <HeroContent
            activeScene={activeScene}
            reducedMotion={reducedMotion}
            align="center"
          />
        </div>
      </div>
    </section>
  );
};
