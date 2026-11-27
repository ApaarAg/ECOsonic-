import type { ExpectedSpeciesBaseline } from "../../domain/acousticFieldTypes";
import { resolveSpeciesAsset } from "./speciesAssetRegistry";

export interface BirdTunnelSlide {
  image: string;
  /** Vertical focal anchor [0 = top .. 100 = bottom] for square slab cropping */
  y: number;
  commonName?: string;
  scientificName?: string;
}

/**
 * Curated high-resolution (>=1000px wide where available) local wildlife bird photographs
 * stored under frontend/public/assets/specimens/. Zero human portraits or stock filler.
 */
export const DEFAULT_BIRD_TUNNEL_SLIDES: readonly BirdTunnelSlide[] = [
  {
    image: "/assets/specimens/varied_thrush.jpg",
    y: 42,
    commonName: "Varied Thrush",
    scientificName: "Ixoreus naevius",
  },
  {
    image: "/assets/specimens/stellers_jay.jpg",
    y: 32,
    commonName: "Steller's Jay",
    scientificName: "Cyanocitta stelleri",
  },
  {
    image: "/assets/specimens/chestnut_backed_chickadee.jpg",
    y: 38,
    commonName: "Chestnut-backed Chickadee",
    scientificName: "Poecile rufescens",
  },
  {
    image: "/assets/specimens/pileated_woodpecker.jpg",
    y: 32,
    commonName: "Pileated Woodpecker",
    scientificName: "Dryocopus pileatus",
  },
  {
    image: "/assets/specimens/northern_flicker.jpg",
    y: 38,
    commonName: "Northern Flicker",
    scientificName: "Colaptes auratus",
  },
  {
    image: "/assets/specimens/red_breasted_sapsucker.jpg",
    y: 34,
    commonName: "Red-breasted Sapsucker",
    scientificName: "Sphyrapicus ruber",
  },
  {
    image: "/assets/specimens/northern_pygmy_owl.jpg",
    y: 38,
    commonName: "Northern Pygmy-Owl",
    scientificName: "Glaucidium gnoma",
  },
  {
    image: "/assets/specimens/golden_crowned_kinglet.jpg",
    y: 40,
    commonName: "Golden-crowned Kinglet",
    scientificName: "Regulus satrapa",
  },
  {
    image: "/assets/specimens/belted_kingfisher.jpg",
    y: 36,
    commonName: "Belted Kingfisher",
    scientificName: "Megaceryle alcyon",
  },
  {
    image: "/assets/specimens/bald_eagle.jpg",
    y: 42,
    commonName: "Bald Eagle",
    scientificName: "Haliaeetus leucocephalus",
  },
  {
    image: "/assets/specimens/american_robin.jpg",
    y: 38,
    commonName: "American Robin",
    scientificName: "Turdus migratorius",
  },
  {
    image: "/assets/specimens/great_blue_heron.jpg",
    y: 34,
    commonName: "Great Blue Heron",
    scientificName: "Ardea herodias",
  },
  {
    image: "/assets/specimens/swainsons_thrush.jpg",
    y: 40,
    commonName: "Swainson's Thrush",
    scientificName: "Catharus ustulatus",
  },
  {
    image: "/assets/specimens/song_sparrow.jpg",
    y: 40,
    commonName: "Song Sparrow",
    scientificName: "Melospiza melodia",
  },
  {
    image: "/assets/specimens/dark_eyed_junco.jpg",
    y: 38,
    commonName: "Dark-eyed Junco",
    scientificName: "Junco hyemalis",
  },
  {
    image: "/assets/specimens/american_crow.jpg",
    y: 35,
    commonName: "American Crow",
    scientificName: "Corvus brachyrhynchos",
  },
  {
    image: "/assets/specimens/european_robin_canopy.jpg",
    y: 42,
    commonName: "European Robin",
    scientificName: "Erithacus rubecula",
  },
];

function parseFocalYPercent(focalPosition: string): number {
  const parts = focalPosition.trim().split(/\s+/);
  const raw = parts[1] ?? "40%";
  const parsed = Number.parseFloat(raw.replace("%", ""));
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 40;
}

/**
 * Resolves moving-photo tunnel slides anchored to Scene 11's ecological species when available,
 * then fills remaining corridor diversity from curated high-resolution local bird photography.
 */
export function resolveBirdTunnelSlides(
  baseline: ExpectedSpeciesBaseline | null | undefined,
): BirdTunnelSlide[] {
  const seenUrls = new Set<string>();
  const slides: BirdTunnelSlide[] = [];

  if (baseline?.expectedSpecies?.length) {
    for (const sp of baseline.expectedSpecies) {
      const asset = resolveSpeciesAsset(sp.scientificName, sp.commonName);
      if (asset.plateKind !== "species_photograph") continue;
      if (seenUrls.has(asset.imageUrl)) continue;
      seenUrls.add(asset.imageUrl);
      slides.push({
        image: asset.imageUrl,
        y: parseFocalYPercent(asset.focalPosition),
        commonName: asset.commonName,
        scientificName: asset.scientificName,
      });
    }
  }

  for (const fallback of DEFAULT_BIRD_TUNNEL_SLIDES) {
    if (seenUrls.has(fallback.image)) continue;
    seenUrls.add(fallback.image);
    slides.push(fallback);
  }

  return slides;
}
