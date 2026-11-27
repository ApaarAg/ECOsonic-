import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import PhotoCardGlobe from "../../components/originkit/ui/photo-card-globe";
import { acousticStore } from "../../domain/acousticStore";
import { resolveBirdTunnelSlides } from "../ExpectedSpecies/birdTunnelAssets";

export interface Act10PhotoCardGlobeProps {
  /** Combined ACT 10 globe visibility [0..1] from CinematicTransition */
  opacity: number;
  /** Camera exit / pullback progress [0..1] across ACT 10 -> ACT 11 */
  globePullback: number;
  /** Global timeline progress [0..1] */
  scrollProgress: number;
  /** Whether ACT 10 is the active interactive focus */
  interactive: boolean;
  reducedMotion: boolean;
}

function deriveShortCenterWord(
  locationName: string | null | undefined,
  ecosystemCategory: string | null | undefined,
): string {
  const eco = (ecosystemCategory ?? "").trim();
  if (eco) {
    const firstWord = eco.split(/[\s\-_/]+/).find((w) => w.length >= 3);
    if (firstWord && firstWord.length <= 11) {
      return firstWord.toUpperCase();
    }
  }
  const loc = (locationName ?? "").trim();
  if (loc) {
    const token = loc.split(/[\s,]+/).find((w) => w.length >= 3);
    if (token && token.length <= 10) {
      return token.toUpperCase();
    }
  }
  return "CONTEXT";
}

/**
 * ACT 10 spatial globe powered by the installed OriginKit PhotoCardGlobe component.
 * Replaces the previous Three.js dotted sphere with rotating ecological avian specimen
 * photo cards over a transparent obsidian canvas aligned to desktop-left / mobile-top.
 */
export const Act10PhotoCardGlobe: React.FC<Act10PhotoCardGlobeProps> = ({
  opacity,
  globePullback,
  scrollProgress,
  interactive,
  reducedMotion,
}) => {
  const snapshot = useSyncExternalStore(
    acousticStore.subscribe,
    acousticStore.getSnapshot,
    acousticStore.getSnapshot,
  );

  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== "undefined" ? window.innerWidth : 1440,
  );

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const slides = useMemo(
    () => resolveBirdTunnelSlides(snapshot.expectedBaseline),
    [snapshot.expectedBaseline],
  );

  const globeImages = useMemo(
    () =>
      slides.map((s) => ({
        image: s.image,
        offsetY: Math.round((50 - s.y) * 2),
      })),
    [slides],
  );

  const centerWord = useMemo(
    () =>
      deriveShortCenterWord(
        snapshot.ecologicalContext?.context.location_name ??
          snapshot.expectedBaseline?.context.locationName,
        snapshot.ecologicalContext?.context.ecosystem_category ??
          snapshot.expectedBaseline?.context.ecosystemCategory,
      ),
    [snapshot.ecologicalContext, snapshot.expectedBaseline],
  );

  const isHidden = opacity <= 0.002;
  const isMobile = viewportWidth < 1024;
  const exitingIntoTunnel = scrollProgress > 0.885;
  const exitProgress = exitingIntoTunnel
    ? Math.max(0, Math.min(1, (scrollProgress - 0.885) / 0.052))
    : 0;
  const entranceRest = Math.max(0, 1 - opacity);

  const scale = reducedMotion
    ? 1
    : exitingIntoTunnel
      ? 1 - exitProgress * 0.13 - globePullback * 0.02
      : 0.91 + opacity * 0.09;

  const translateX = reducedMotion
    ? 0
    : exitingIntoTunnel
      ? -exitProgress * (isMobile ? 12 : 34)
      : -entranceRest * (isMobile ? 8 : 22);

  const translateY = reducedMotion
    ? 0
    : exitingIntoTunnel
      ? -exitProgress * (isMobile ? 16 : 14)
      : entranceRest * 16;

  const blurPx =
    !reducedMotion && opacity < 0.82 ? (1 - opacity) * 3.2 : 0;

  return (
    <div
      data-testid="act10-photo-card-globe"
      aria-hidden={!interactive}
      className="fixed left-0 top-[82px] z-[5] h-[31dvh] w-full overflow-hidden lg:top-0 lg:bottom-0 lg:h-full lg:w-[54vw] lg:max-w-[780px]"
      style={{
        opacity: exitingIntoTunnel && !reducedMotion ? Math.pow(opacity, 1.35) : opacity,
        visibility: opacity > 0.002 ? "visible" : "hidden",
        pointerEvents: interactive && opacity > 0.14 ? "auto" : "none",
        transform: `translate3d(${translateX.toFixed(2)}px, ${translateY.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`,
        filter: blurPx > 0.08 ? `blur(${blurPx.toFixed(2)}px)` : undefined,
        willChange: reducedMotion ? undefined : "transform, opacity",
      }}
    >
      {/* Restrained nocturnal atmospheric halo behind the specimen globe */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, rgba(134, 166, 142, 0.075) 0%, rgba(18, 26, 22, 0.04) 44%, rgba(6, 7, 8, 0) 74%)",
        }}
      />

      <PhotoCardGlobe
        images={globeImages}
        paused={isHidden}
        background="transparent"
        count={viewportWidth < 768 ? 44 : 62}
        scale={isMobile ? 76 : 92}
        speed={reducedMotion ? 0 : 42}
        showText={true}
        text={centerWord}
        textColor="#E8E4DC"
        font={{
          fontFamily: '"Instrument Serif", Georgia, serif',
          fontWeight: 400,
          fontSize: isMobile ? 42 : 54,
          letterSpacing: "0.06em",
        }}
        advanced={{
          spinRate: reducedMotion ? 0 : 14,
          startAngle: 0,
          tilt: 7,
          distance: 32,
          offsetX: isMobile ? 0 : -2,
          offsetY: 0,
          cardSize: isMobile ? 90 : 96,
          cardMin: 26,
          cardMax: 40,
          jitter: 15,
          roll: 4,
          seed: 7,
          cardBrightness: 94,
          groundColor: "#141816",
          imagePad: 6,
          sideColor: "#3D4F44",
          extrude: 3,
          condense: 84,
          textOffset: 0,
          textOpacity: 82,
          dragStrength: 48,
          damping: 54,
          hoverTilt: reducedMotion ? 0 : 10,
          hoverEase: 40,
          hover: reducedMotion ? 0 : 42,
          grain: 0,
          vignette: 0,
        }}
        style={{
          minWidth: 0,
          minHeight: 0,
          width: "100%",
          height: "100%",
          touchAction: isMobile ? "pan-y" : "none",
        }}
      />
    </div>
  );
};
