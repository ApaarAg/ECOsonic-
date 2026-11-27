export type ViewportTier = "mobile" | "tablet" | "desktop";

export interface AcousticFieldBudget {
  tier: ViewportTier;
  maxDpr: number;
  particleCount: number;
  strataCount: number;
  strataSegments: number;
  cameraDistance: number;
  fieldScale: number;
  parallaxStrength: number;
  pointSizeScale: number;
}

export function getViewportTier(width: number): ViewportTier {
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

export function getAcousticFieldBudget(width: number): AcousticFieldBudget {
  const tier = getViewportTier(width);

  if (tier === "mobile") {
    return {
      tier: "mobile",
      maxDpr: 1.5,
      particleCount: 3000,
      strataCount: 4,
      strataSegments: 72,
      cameraDistance: 7.2,
      fieldScale: 0.9,
      parallaxStrength: 0.16,
      pointSizeScale: 1.45,
    };
  }

  if (tier === "tablet") {
    return {
      tier: "tablet",
      maxDpr: 1.75,
      particleCount: 5400,
      strataCount: 5,
      strataSegments: 96,
      cameraDistance: 6.2,
      fieldScale: 0.98,
      parallaxStrength: 0.24,
      pointSizeScale: 1.12,
    };
  }

  return {
    tier: "desktop",
    maxDpr: 2.0,
    particleCount: 9000,
    strataCount: 7,
    strataSegments: 128,
    cameraDistance: 5.6,
    fieldScale: 1.0,
    parallaxStrength: 0.32,
    pointSizeScale: 1.0,
  };
}

export interface ForestBudget {
  tier: ViewportTier;
  maxDpr: number;
  mistParticleCount: number;
  backgroundTreeCount: number;
  midgroundTrunkCount: number;
  fernFrondCount: number;
  mossCurtainCount: number;
  parallaxStrength: number;
  cameraDistance: number;
}

export function getForestBudget(width: number): ForestBudget {
  const tier = getViewportTier(width);

  if (tier === "mobile") {
    return {
      tier: "mobile",
      maxDpr: 1.5,
      mistParticleCount: 140,
      backgroundTreeCount: 10,
      midgroundTrunkCount: 4,
      fernFrondCount: 5,
      mossCurtainCount: 4,
      parallaxStrength: 0.06,
      cameraDistance: 5.4,
    };
  }

  if (tier === "tablet") {
    return {
      tier: "tablet",
      maxDpr: 1.75,
      mistParticleCount: 260,
      backgroundTreeCount: 14,
      midgroundTrunkCount: 6,
      fernFrondCount: 8,
      mossCurtainCount: 6,
      parallaxStrength: 0.1,
      cameraDistance: 4.9,
    };
  }

  return {
    tier: "desktop",
    maxDpr: 2.0,
    mistParticleCount: 420,
    backgroundTreeCount: 18,
    midgroundTrunkCount: 8,
    fernFrondCount: 12,
    mossCurtainCount: 9,
    parallaxStrength: 0.14,
    cameraDistance: 4.6,
  };
}

export interface EcologicalFieldBudget {
  tier: ViewportTier;
  maxDpr: number;
  nodeCount: number;
  maxFilaments: number;
  pointScale: number;
  distanceThreshold: number;
}

export function getEcologicalFieldBudget(width: number): EcologicalFieldBudget {
  const tier = getViewportTier(width);
  if (tier === "mobile") {
    return {
      tier: "mobile",
      maxDpr: 1.5,
      nodeCount: 380,
      maxFilaments: 160,
      pointScale: 1.25,
      distanceThreshold: 1.15,
    };
  }
  if (tier === "tablet") {
    return {
      tier: "tablet",
      maxDpr: 1.75,
      nodeCount: 720,
      maxFilaments: 340,
      pointScale: 1.1,
      distanceThreshold: 1.25,
    };
  }
  return {
    tier: "desktop",
    maxDpr: 2.0,
    nodeCount: 1280,
    maxFilaments: 620,
    pointScale: 1.0,
    distanceThreshold: 1.35,
  };
}

