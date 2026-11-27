import type { SpeciesImageProvenance } from "../../domain/acousticFieldTypes";

export interface SpeciesAssetRecord {
  scientificName: string;
  commonName: string;
  imageUrl: string;
  /** CSS object-position focal anchor keeping head and eye centered in narrow spine & wide plate */
  focalPosition: string;
  /** Natural image aspect ratio (width / height) */
  naturalAspect: number;
  plateKind: "species_photograph" | "habitat_context_fallback";
  imageStatus?: "available" | "unavailable";
  artist: string;
  license: string;
  sourceUrl: string;
  sourceLabel?: string;
  retrievedAt?: string;
  captionNote?: string;
}

const CANONICAL_HABITAT_FALLBACK_URL = "/assets/canonical/rainforest_branch_overcast.jpg";

/**
 * Explicit Natural-History Specimen Asset Registry.
 * Every species photograph is locally hosted from verified open-licensed Wikimedia Commons
 * ornithology photography or existing ECOsonic project photography, with inspected focal anchors.
 */
const REGISTRY_ENTRIES: SpeciesAssetRecord[] = [
  {
    scientificName: "Troglodytes pacificus",
    commonName: "Pacific Wren",
    imageUrl: "/assets/specimens/pacific_wren.jpg",
    focalPosition: "60% 44%",
    naturalAspect: 600 / 461,
    plateKind: "species_photograph",
    artist: "Eleanor Briccetti",
    license: "CC BY-SA 2.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Pacific_Wren_-_Vancouver_Is._(6842161146).jpg",
  },
  {
    scientificName: "Ixoreus naevius",
    commonName: "Varied Thrush",
    imageUrl: "/assets/specimens/varied_thrush.jpg",
    focalPosition: "46% 42%",
    naturalAspect: 1000 / 726,
    plateKind: "species_photograph",
    artist: "Rhododendrites",
    license: "CC BY-SA 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Varied_thrush_(73976).jpg",
  },
  {
    scientificName: "Cyanocitta stelleri",
    commonName: "Steller's Jay",
    imageUrl: "/assets/specimens/stellers_jay.jpg",
    focalPosition: "56% 32%",
    naturalAspect: 1226 / 1854,
    plateKind: "species_photograph",
    artist: "Noel Reynolds",
    license: "CC BY 2.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Steller%27s_Jay_flagstaff_arizona.jpg",
  },
  {
    scientificName: "Poecile rufescens",
    commonName: "Chestnut-backed Chickadee",
    imageUrl: "/assets/specimens/chestnut_backed_chickadee.jpg",
    focalPosition: "42% 38%",
    naturalAspect: 1000 / 758,
    plateKind: "species_photograph",
    artist: "VJAnderson",
    license: "CC BY-SA 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Chestnut-backed_Chickadee_2154ab_(cropped).jpg",
  },
  {
    scientificName: "Colaptes auratus",
    commonName: "Northern Flicker",
    imageUrl: "/assets/specimens/northern_flicker.jpg",
    focalPosition: "54% 38%",
    naturalAspect: 1.0,
    plateKind: "species_photograph",
    artist: "Rhododendrites",
    license: "CC BY-SA 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Northern_yellow-shafted_flicker_male_(33737)_(cropped).jpg",
  },
  {
    scientificName: "Dryocopus pileatus",
    commonName: "Pileated Woodpecker",
    imageUrl: "/assets/specimens/pileated_woodpecker.jpg",
    focalPosition: "42% 32%",
    naturalAspect: 1000 / 1108,
    plateKind: "species_photograph",
    artist: "Joshlaymon",
    license: "CC BY-SA 3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:PileatedWoodpeckerFeedingonTree,_crop.jpg",
  },
  {
    scientificName: "Sphyrapicus ruber",
    commonName: "Red-breasted Sapsucker",
    imageUrl: "/assets/specimens/red_breasted_sapsucker.jpg",
    focalPosition: "36% 34%",
    naturalAspect: 1000 / 1295,
    plateKind: "species_photograph",
    artist: "Kevin Cole",
    license: "CC BY 2.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Sphyrapicus_ruber_2.jpg",
  },
  {
    scientificName: "Glaucidium gnoma",
    commonName: "Northern Pygmy-Owl",
    imageUrl: "/assets/specimens/northern_pygmy_owl.jpg",
    focalPosition: "64% 38%",
    naturalAspect: 1000 / 624,
    plateKind: "species_photograph",
    artist: "Greg Schechter",
    license: "CC BY 2.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Northern_Pygmy_Owl_-_Flickr_-_GregTheBusker_(2).jpg",
  },
  {
    scientificName: "Regulus satrapa",
    commonName: "Golden-crowned Kinglet",
    imageUrl: "/assets/specimens/golden_crowned_kinglet.jpg",
    focalPosition: "54% 40%",
    naturalAspect: 1.0,
    plateKind: "species_photograph",
    artist: "Chuck Homler, Focus On Wildlife",
    license: "CC BY-SA 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Golden-Crowned_Kinglet_EBFNWR.jpg",
  },
  {
    scientificName: "Corvus brachyrhynchos",
    commonName: "American Crow",
    imageUrl: "/assets/specimens/american_crow.jpg",
    focalPosition: "44% 35%",
    naturalAspect: 1.0,
    plateKind: "species_photograph",
    artist: "Wikimedia Commons Contributor",
    license: "CC BY-SA 3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Corvus-brachyrhynchos-001.jpg",
  },
  {
    scientificName: "Melospiza melodia",
    commonName: "Song Sparrow",
    imageUrl: "/assets/specimens/song_sparrow.jpg",
    focalPosition: "54% 40%",
    naturalAspect: 1000 / 701,
    plateKind: "species_photograph",
    artist: "Rhododendrites",
    license: "CC BY-SA 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Song_sparrow_in_Prospect_Park_(93031).jpg",
  },
  {
    scientificName: "Junco hyemalis",
    commonName: "Dark-eyed Junco",
    imageUrl: "/assets/specimens/dark_eyed_junco.jpg",
    focalPosition: "44% 38%",
    naturalAspect: 1000 / 667,
    plateKind: "species_photograph",
    artist: "Cephas",
    license: "CC BY-SA 3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Junco_hyemalis_hyemalis_CT1_(cropped).jpg",
  },
  {
    scientificName: "Megaceryle alcyon",
    commonName: "Belted Kingfisher",
    imageUrl: "/assets/specimens/belted_kingfisher.jpg",
    focalPosition: "48% 36%",
    naturalAspect: 1000 / 750,
    plateKind: "species_photograph",
    artist: "JeffreyGammon",
    license: "CC BY-SA 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:BeltedKingfisherJG_Male.jpg",
  },
  {
    scientificName: "Haliaeetus leucocephalus",
    commonName: "Bald Eagle",
    imageUrl: "/assets/specimens/bald_eagle.jpg",
    focalPosition: "56% 42%",
    naturalAspect: 1000 / 800,
    plateKind: "species_photograph",
    artist: "Andy Morffew",
    license: "CC BY 2.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Bald_eagle_about_to_fly_in_Alaska_(2016).jpg",
  },
  {
    scientificName: "Turdus migratorius",
    commonName: "American Robin",
    imageUrl: "/assets/specimens/american_robin.jpg",
    focalPosition: "54% 38%",
    naturalAspect: 1000 / 750,
    plateKind: "species_photograph",
    artist: "Rhododendrites",
    license: "CC BY-SA 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:American_robin_(71307).jpg",
  },
  {
    scientificName: "Ardea herodias",
    commonName: "Great Blue Heron",
    imageUrl: "/assets/specimens/great_blue_heron.jpg",
    focalPosition: "50% 34%",
    naturalAspect: 1000 / 667,
    plateKind: "species_photograph",
    artist: "DallasPenner",
    license: "CC BY-SA 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:GreatBlueHeronInARiver.jpg",
  },
  {
    scientificName: "Catharus ustulatus",
    commonName: "Swainson's Thrush",
    imageUrl: "/assets/specimens/swainsons_thrush.jpg",
    focalPosition: "52% 40%",
    naturalAspect: 1000 / 800,
    plateKind: "species_photograph",
    artist: "Cephas",
    license: "CC BY-SA 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Catharus_ustulatus_Clbrg_01.jpg",
  },
  {
    scientificName: "Erithacus rubecula",
    commonName: "European Robin",
    imageUrl: "/assets/specimens/european_robin_canopy.jpg",
    focalPosition: "56% 42%",
    naturalAspect: 4 / 3,
    plateKind: "species_photograph",
    artist: "ECOsonic Project Asset",
    license: "Project Canonical Asset",
    sourceUrl: "/assets/specimens/european_robin_canopy.jpg",
  },
];

const BY_SCI_NAME = new Map<string, SpeciesAssetRecord>(
  REGISTRY_ENTRIES.map((entry) => [entry.scientificName.trim().toLowerCase(), entry]),
);

const BY_COMMON_NAME = new Map<string, SpeciesAssetRecord>(
  REGISTRY_ENTRIES.map((entry) => [entry.commonName.trim().toLowerCase(), entry]),
);

export function resolveSpeciesAsset(
  scientificName: string,
  commonName?: string | null,
  backendImage?: SpeciesImageProvenance | null,
): SpeciesAssetRecord {
  const sciKey = scientificName.trim().toLowerCase();
  const exactSci = BY_SCI_NAME.get(sciKey);
  if (exactSci) return { ...exactSci, imageStatus: "available" };

  if (commonName) {
    const exactCom = BY_COMMON_NAME.get(commonName.trim().toLowerCase());
    if (exactCom) return { ...exactCom, imageStatus: "available" };
  }

  if (backendImage && backendImage.image_status === "available" && backendImage.url) {
    return {
      scientificName,
      commonName: commonName || scientificName,
      imageUrl: backendImage.url,
      focalPosition: "50% 40%",
      naturalAspect: 4 / 3,
      plateKind: "species_photograph",
      imageStatus: "available",
      artist: backendImage.attribution || "Wikimedia Commons Contributor",
      license: backendImage.license || "Open License",
      sourceUrl: backendImage.source_url || backendImage.url,
      sourceLabel: backendImage.source || "Wikimedia Commons",
      retrievedAt: backendImage.retrieved_at ?? undefined,
    };
  }

  return {
    scientificName,
    commonName: commonName || scientificName,
    imageUrl: CANONICAL_HABITAT_FALLBACK_URL,
    focalPosition: "50% 45%",
    naturalAspect: 1376 / 768,
    plateKind: "habitat_context_fallback",
    imageStatus: "unavailable",
    artist: "ECOsonic Canonical Environment",
    license: "Project Asset",
    sourceUrl: CANONICAL_HABITAT_FALLBACK_URL,
    retrievedAt: backendImage?.retrieved_at ?? undefined,
    captionNote: "Species image unavailable · habitat plate",
  };
}

export function getRegisteredSpeciesAssetCount(): number {
  return REGISTRY_ENTRIES.length;
}
