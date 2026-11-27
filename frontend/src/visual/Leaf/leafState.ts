/**
 * Pure aerodynamic hero-leaf physics engine for ACT 03 — LEAF (and handoff into ACT 04 WATER).
 *
 * Stages:
 *   1. Attached / Detaching (petiole tip pinned to twig socket, subtle flex/twist around stem,
 *      visible stem separation, brief hesitation before gravity takes over)
 *   2. Drop (initial gravity acceleration & light pitch slip)
 *   3. Float (damped sinusoidal / bezier-like S-glides, air-cushion stalls, asymmetric non-constant
 *      angular velocity with periodic edge-on orientation)
 *   4. Approach (3D perspective travel forward through forest layers toward pool clearing)
 *   5. Water Approach (final deceleration above POOL_SURFACE_Y = -1.65)
 *   6. Moored (physical contact at waterP = 0.14, meniscus dip, gentle floating stillness)
 */

export type LeafPhaseKind =
  | 'detachment'
  | 'drop'
  | 'float'
  | 'approach'
  | 'water_approach'
  | 'moored';

export interface LeafVec3 {
  x: number;
  y: number;
  z: number;
}

export interface LeafVelocityVec {
  vx: number;
  vy: number;
  vz: number;
}

export interface LeafEulerVec {
  rotX: number;
  rotY: number;
  rotZ: number;
}

export interface LeafAngularVelocityVec {
  angVelX: number;
  angVelY: number;
  angVelZ: number;
}

export interface LeafAnchorSpec {
  startX: number;
  startY: number;
  startZ: number;
}

export interface LeafRuntimeState {
  phase: LeafPhaseKind;
  progress: number;
  position: LeafVec3;
  velocity: LeafVelocityVec;
  rotation: LeafEulerVec;
  angularVelocity: LeafAngularVelocityVec;
  lateralDrift: number;
  airResistance: number;
  x: number;
  y: number;
  z: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  vx: number;
  vy: number;
  vz: number;
  flutterFlex: number;
  wetSheen: number;
  camouflageMix: number;
}

export const POOL_SURFACE_Y = -1.65;
export const WATER_CONTACT_PROGRESS = 0.14;

/** Exact twig petiole socket on plate-hero-tree (px=1264, py=716 on 8.8x6.6 plane at y=0.25, z=-0.05) */
const DEFAULT_ANCHOR: LeafAnchorSpec = {
  startX: 0.235,
  startY: 0.925,
  startZ: -0.015,
};

/** Petiole tip offset in local leaf geometry space (PlaneGeometry 0.35 x 0.52, stem tip at uv.y = 0.04) */
const PETIOLE_LOCAL_Y = -0.238;

const ATTACHED_ROT_X = 0.06;
const ATTACHED_ROT_Y = -0.14;
const ATTACHED_ROT_Z = 2.74;

const MOORED_X = 0.04;
const MOORED_Z = 0.94;
const MOORED_REST_Y = POOL_SURFACE_Y + 0.011;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Rotate local (0, py, 0) by Three.js intrinsic XYZ Euler angles (rotX, rotY, rotZ). */
function rotatedPetioleOffset(
  py: number,
  rotX: number,
  rotY: number,
  rotZ: number,
): LeafVec3 {
  const x1 = -py * Math.sin(rotZ);
  const y1 = py * Math.cos(rotZ);

  const x2 = x1 * Math.cos(rotY);
  const y2 = y1;
  const z2 = -x1 * Math.sin(rotY);

  const cosX = Math.cos(rotX);
  const sinX = Math.sin(rotX);
  return {
    x: x2,
    y: y2 * cosX - z2 * sinX,
    z: y2 * sinX + z2 * cosX,
  };
}

function deterministicAirField(t: number): {
  gustX: number;
  updraftY: number;
  flutterTorqueX: number;
  flutterTorqueY: number;
  flutterTorqueZ: number;
} {
  return {
    gustX:
      0.38 * Math.sin(t * 0.88 + 0.25) -
      0.24 * Math.sin(t * 1.46 + 1.65) +
      0.10 * Math.sin(t * 2.38 - 0.45),
    updraftY:
      0.22 * Math.sin(t * 1.24 - 0.35) +
      0.12 * Math.cos(t * 2.04 + 1.10),
    flutterTorqueX:
      0.56 * Math.sin(t * 1.32 + 0.65) +
      0.32 * Math.cos(t * 2.18 + 1.4),
    flutterTorqueY:
      0.88 * Math.sin(t * 1.18 + 1.6) -
      0.48 * Math.sin(t * 1.92 - 0.5),
    flutterTorqueZ:
      0.62 * Math.cos(t * 1.26 + 0.2) +
      0.28 * Math.sin(t * 2.11 + 1.1),
  };
}

function syncAliases(state: LeafRuntimeState): void {
  state.x = state.position.x;
  state.y = state.position.y;
  state.z = state.position.z;
  state.vx = state.velocity.vx;
  state.vy = state.velocity.vy;
  state.vz = state.velocity.vz;
  state.rotX = state.rotation.rotX;
  state.rotY = state.rotation.rotY;
  state.rotZ = state.rotation.rotZ;
}

export function createLeafRuntimeState(_reducedMotion = false): LeafRuntimeState {
  const pet = rotatedPetioleOffset(
    PETIOLE_LOCAL_Y,
    ATTACHED_ROT_X,
    ATTACHED_ROT_Y,
    ATTACHED_ROT_Z,
  );
  const x = DEFAULT_ANCHOR.startX - pet.x;
  const y = DEFAULT_ANCHOR.startY - pet.y;
  const z = DEFAULT_ANCHOR.startZ - pet.z;

  return {
    phase: 'detachment',
    progress: 0,
    position: { x, y, z },
    velocity: { vx: 0, vy: 0, vz: 0 },
    rotation: { rotX: ATTACHED_ROT_X, rotY: ATTACHED_ROT_Y, rotZ: ATTACHED_ROT_Z },
    angularVelocity: { angVelX: 0, angVelY: 0, angVelZ: 0 },
    lateralDrift: 0,
    airResistance: 0.25,
    x,
    y,
    z,
    rotX: ATTACHED_ROT_X,
    rotY: ATTACHED_ROT_Y,
    rotZ: ATTACHED_ROT_Z,
    vx: 0,
    vy: 0,
    vz: 0,
    flutterFlex: 0.014,
    wetSheen: 0.65,
    camouflageMix: 1,
  };
}

export function evaluateLeafCinematics(
  state: LeafRuntimeState,
  leafProgress: number,
  waterProgress: number,
  clock: number,
  reducedMotion: boolean,
  anchor: LeafAnchorSpec = DEFAULT_ANCHOR,
  audioBreezeBoost = 0,
): void {
  const p = clamp(leafProgress, 0, 1);
  const w = clamp(waterProgress, 0, 1);
  state.progress = p;

  if (reducedMotion) {
    state.velocity.vx = 0;
    state.velocity.vy = 0;
    state.velocity.vz = 0;
    state.angularVelocity.angVelX = 0;
    state.angularVelocity.angVelY = 0;
    state.angularVelocity.angVelZ = 0;
    state.lateralDrift = 0;
    state.airResistance = 0.55;
    state.camouflageMix = 0;

    if (w > 0.05) {
      state.phase = 'moored';
      state.position.x = MOORED_X;
      state.position.y = MOORED_REST_Y;
      state.position.z = MOORED_Z;
      state.rotation.rotX = -1.36;
      state.rotation.rotY = 0.22;
      state.rotation.rotZ = 0.24;
      state.flutterFlex = 0.005;
      state.wetSheen = 0.90;
      syncAliases(state);
      return;
    }

    if (p < 0.04) {
      state.phase = 'detachment';
      const pet = rotatedPetioleOffset(
        PETIOLE_LOCAL_Y,
        ATTACHED_ROT_X,
        ATTACHED_ROT_Y,
        ATTACHED_ROT_Z,
      );
      state.position.x = anchor.startX - pet.x;
      state.position.y = anchor.startY - pet.y;
      state.position.z = anchor.startZ - pet.z;
      state.rotation.rotX = ATTACHED_ROT_X;
      state.rotation.rotY = ATTACHED_ROT_Y;
      state.rotation.rotZ = ATTACHED_ROT_Z;
      state.camouflageMix = 1;
      state.flutterFlex = 0.01;
      state.wetSheen = 0.65;
      syncAliases(state);
      return;
    }

    state.phase = p < 0.20 ? 'detachment' : p > 0.85 ? 'water_approach' : 'approach';
    state.position.x = 0.05;
    state.position.y = p > 0.85 ? POOL_SURFACE_Y + 0.26 : -0.15;
    state.position.z = p > 0.85 ? MOORED_Z : 1.15;
    state.rotation.rotX = p > 0.85 ? -1.12 : 0.22;
    state.rotation.rotY = -0.22;
    state.rotation.rotZ = p > 0.85 ? 0.14 : -0.18;
    state.flutterFlex = 0.012;
    state.wetSheen = 0.78;
    syncAliases(state);
    return;
  }

  const breezeAmp = 1.0 + clamp(audioBreezeBoost, 0, 0.65);

  // STAGE A & B — ATTACHED -> DETACHMENT [0.00 -> 0.20]:
  // 1) Flexes gently around petiole tip pinned to twig socket
  // 2) Twists/rolls under breeze pulse
  // 3) Stem visibly separates from twig socket (0.10 -> 0.17)
  // 4) Brief aerodynamic hesitation (0.17 -> 0.20) before gravity wins
  const attachFlex = smoothstep(0.02, 0.12, p);
  const stemSep = smoothstep(0.10, 0.17, p);
  const hesitationDrop = smoothstep(0.16, 0.20, p);

  const breezeOsc =
    (Math.sin(clock * 1.95) * 0.024 + Math.sin(clock * 3.22 + 0.7) * 0.011) *
    breezeAmp;

  const detachRotX = ATTACHED_ROT_X + breezeOsc * 0.55 + attachFlex * 0.16 + hesitationDrop * 0.09;
  const detachRotY = ATTACHED_ROT_Y + breezeOsc * 0.65 - attachFlex * 0.28 + hesitationDrop * 0.12;
  const detachRotZ = ATTACHED_ROT_Z + breezeOsc * 1.15 - attachFlex * 0.22 - hesitationDrop * 0.14;

  const detachPet = rotatedPetioleOffset(
    PETIOLE_LOCAL_Y,
    detachRotX,
    detachRotY,
    detachRotZ,
  );
  const releaseX = anchor.startX - detachPet.x - stemSep * 0.018 - hesitationDrop * 0.012;
  const releaseY = anchor.startY - detachPet.y - stemSep * 0.036 - hesitationDrop * 0.022;
  const releaseZ = anchor.startZ - detachPet.z + stemSep * 0.022 + hesitationDrop * 0.016;

  if (p < 0.20) {
    state.phase = 'detachment';
    state.position.x = releaseX;
    state.position.y = releaseY;
    state.position.z = releaseZ;
    state.velocity.vx = -hesitationDrop * 0.035;
    state.velocity.vy = -hesitationDrop * 0.055;
    state.velocity.vz = hesitationDrop * 0.030;
    state.rotation.rotX = detachRotX;
    state.rotation.rotY = detachRotY;
    state.rotation.rotZ = detachRotZ;
    state.angularVelocity.angVelX = 0.08 * attachFlex;
    state.angularVelocity.angVelY = -0.18 * attachFlex;
    state.angularVelocity.angVelZ = -0.16 * attachFlex;
    state.lateralDrift = state.velocity.vx;
    state.airResistance = 0.34;
    state.flutterFlex = 0.015 + Math.abs(breezeOsc) * 0.45 + attachFlex * 0.018;
    state.wetSheen = 0.66;
    state.camouflageMix = 1.0 - stemSep * 0.35;
    syncAliases(state);
    return;
  }

  // Exact initial conditions evaluated at p = 0.20 so transition from detachment into free-fall is C0-continuous
  const initPet = rotatedPetioleOffset(
    PETIOLE_LOCAL_Y,
    ATTACHED_ROT_X + 0.25,
    ATTACHED_ROT_Y - 0.16,
    ATTACHED_ROT_Z - 0.36,
  );
  let x = anchor.startX - initPet.x - 0.030;
  let y = anchor.startY - initPet.y - 0.058;
  let z = anchor.startZ - initPet.z + 0.038;
  let vx = -0.035;
  let vy = -0.055;
  let vz = 0.030;

  let rotX = ATTACHED_ROT_X + 0.25;
  let rotY = ATTACHED_ROT_Y - 0.16;
  let rotZ = ATTACHED_ROT_Z - 0.36;
  let avX = 0.08;
  let avY = -0.18;
  let avZ = -0.16;
  let airRes = 0.42;

  const flightU = (p - 0.20) / 0.80; // [0..1]
  const totalFlightSec = 6.2;
  const targetSimTime = flightU * totalFlightSec;
  const subStep = 1 / 90;
  const steps = Math.max(1, Math.round(targetSimTime / subStep));
  const h = targetSimTime / steps;

  const preWaterTargetY = POOL_SURFACE_Y + 0.15; // -1.50 at end of ACT 03

  for (let i = 0; i < steps; i++) {
    const t = i * h;
    const u = t / totalFlightSec;
    const air = deterministicAirField(t);

    // Broadside exposure controls drag/lift cushion AND causes edge-on moments when broadside drops
    const broadside = clamp(
      Math.abs(Math.cos(rotX * 0.72) * Math.cos(rotY * 0.85)),
      0.16,
      1.0,
    );
    airRes = 0.36 + 0.62 * broadside;

    const gravity = -0.78;
    const cushionWeight = smoothstep(0.08, 0.28, u) * (1 - smoothstep(0.80, 1.0, u) * 0.60);
    const aeroCushion = cushionWeight * (0.34 + broadside * 0.28);
    const updraft =
      smoothstep(0.12, 0.32, u) *
      (1 - smoothstep(0.76, 1.0, u)) *
      air.updraftY *
      1.28;

    const floatWeight = smoothstep(0.08, 0.26, u) * (1 - smoothstep(0.80, 1.0, u));
    const bankGlide = -Math.sin(rotZ) * 0.26 * broadside;
    const clearingCenterX = 0.28 * Math.sin(u * Math.PI * 0.9) + MOORED_X;
    const centerPullX = (clearingCenterX - x) * (0.65 + smoothstep(0.66, 1.0, u) * 2.2);
    const ax =
      (air.gustX * floatWeight * 0.85 + bankGlide * floatWeight + centerPullX) *
        breezeAmp -
      vx * (1.45 + airRes * 1.1);

    // Nonlinear damped trajectory: gravity accelerates early, air cushion & updrafts stall mid-flight,
    // and air cushion slows final descent toward water approach (-1.50)
    const waterApproachWeight = smoothstep(0.76, 1.0, u);
    const glideCurveY =
      (anchor.startY - initPet.y - 0.058) * (1 - smoothstep(0.04, 0.88, u)) +
      preWaterTargetY * smoothstep(0.04, 0.88, u);
    const airColumnRestore = (1 - waterApproachWeight) * (glideCurveY - y) * 1.32;
    const yWaterPull = waterApproachWeight * ((preWaterTargetY - y) * 3.1);
    const ay =
      gravity +
      aeroCushion +
      updraft +
      airColumnRestore +
      yWaterPull -
      vy * (1.75 + airRes * 2.1);

    // 3D approach forward through forest planes (z > 1.0 during approach, settling toward MOORED_Z = 0.94)
    const approachBell = Math.sin(smoothstep(0.08, 0.88, u) * Math.PI * 0.85);
    const targetZ =
      (anchor.startZ - initPet.z + 0.038) +
      approachBell * 1.34 * (1 - waterApproachWeight * 0.36) +
      waterApproachWeight * 0.94;
    const az = (targetZ - z) * 2.8 - vz * 2.4;

    vx += ax * h;
    vy += ay * h;
    vz += az * h;
    vy = clamp(vy, -0.58, 0.18);

    x += vx * h;
    y += vy * h;
    z += vz * h;

    // Asymmetric non-constant angular motion with two natural edge-on yaw turns & pauses
    const settleAttitude = smoothstep(0.76, 1.0, u);
    const edgeOnPulseA = Math.exp(-Math.pow((u - 0.34) / 0.10, 2)) * 1.48;
    const edgeOnPulseB = Math.exp(-Math.pow((u - 0.64) / 0.11, 2)) * -1.42;

    const restRotX =
      (0.18 + Math.sin(u * 6.5) * 0.22) * (1 - settleAttitude) +
      -1.18 * settleAttitude;
    const restRotY =
      (-0.18 + edgeOnPulseA + edgeOnPulseB) * (1 - settleAttitude) +
      0.22 * settleAttitude;
    const restRotZ =
      (ATTACHED_ROT_Z - 0.36) * (1 - smoothstep(0.04, 0.48, u)) +
      (-0.26 * Math.sin(u * 5.2)) * smoothstep(0.04, 0.48, u) * (1 - settleAttitude) +
      0.16 * settleAttitude;

    const floatTorqueScale = 0.22 + 0.78 * floatWeight;
    const angDamp = 2.35 + 1.45 * airRes;

    const torqueX =
      (restRotX - rotX) * 2.4 +
      air.flutterTorqueX * floatTorqueScale * 0.55 -
      avX * angDamp;
    const torqueY =
      (restRotY - rotY) * 2.5 +
      air.flutterTorqueY * floatTorqueScale * 0.75 +
      vx * 0.45 -
      avY * angDamp;
    const torqueZ =
      (restRotZ - rotZ) * 2.0 +
      air.flutterTorqueZ * floatTorqueScale * 0.55 -
      vx * 0.35 -
      avZ * angDamp;

    avX = clamp(avX + torqueX * h, -1.6, 1.6);
    avY = clamp(avY + torqueY * h, -1.8, 1.8);
    avZ = clamp(avZ + torqueZ * h, -1.8, 1.8);

    rotX += avX * h;
    rotY += avY * h;
    rotZ += avZ * h;
  }

  state.position.x = x;
  state.position.y = y;
  state.position.z = z;
  state.velocity.vx = vx;
  state.velocity.vy = vy;
  state.velocity.vz = vz;
  state.rotation.rotX = rotX;
  state.rotation.rotY = rotY;
  state.rotation.rotZ = rotZ;
  state.angularVelocity.angVelX = avX;
  state.angularVelocity.angVelY = avY;
  state.angularVelocity.angVelZ = avZ;
  state.lateralDrift = vx;
  state.airResistance = airRes;
  state.camouflageMix = 1.0 - smoothstep(0.18, 0.44, p);

  // Synchronized ACT 04 water approach -> contact at w = 0.14 -> meniscus dip -> calm float
  if (w > 0.001) {
    if (w < WATER_CONTACT_PROGRESS) {
      // WATER_APPROACH: final gentle deceleration down onto surface contact
      state.phase = 'water_approach';
      const uApp = clamp(w / WATER_CONTACT_PROGRESS, 0, 1);
      const ease = uApp * uApp * (3 - 2 * uApp);
      state.position.x = x * (1 - ease * 0.72) + MOORED_X * (ease * 0.72);
      state.position.y = y * (1 - ease) + (POOL_SURFACE_Y + 0.006) * ease;
      state.position.z = z * (1 - ease * 0.72) + MOORED_Z * (ease * 0.72);
      state.rotation.rotX = rotX * (1 - ease * 0.75) + -1.34 * (ease * 0.75);
      state.rotation.rotY = rotY * (1 - ease * 0.65) + 0.22 * (ease * 0.65);
      state.rotation.rotZ = rotZ * (1 - ease * 0.65) + 0.24 * (ease * 0.65);
      state.flutterFlex = 0.025 * (1 - ease * 0.75);
      state.wetSheen = 0.76 + ease * 0.12;
      state.camouflageMix = 0;
      syncAliases(state);
      return;
    }

    // WATER_CONTACT (0.14..0.24) -> RIPPLE (0.24..0.68) -> WATER_SETTLING (0.68..1.00)
    state.phase = 'moored';
    const postW = (w - WATER_CONTACT_PROGRESS) / (1 - WATER_CONTACT_PROGRESS);
    const settle = smoothstep(0.0, 0.28, postW);
    const impactDip = Math.sin(clamp(postW / 0.16, 0, 1) * Math.PI) * 0.011;
    const floatBob = Math.sin(clock * 1.45) * 0.003 * (1 - smoothstep(0.35, 0.95, postW));

    state.position.x = x * (1 - 0.72) * (1 - settle) + MOORED_X * (1 - (1 - 0.72) * (1 - settle));
    state.position.y =
      (POOL_SURFACE_Y + 0.006) * (1 - settle) +
      (MOORED_REST_Y - impactDip + floatBob) * settle;
    state.position.z = z * (1 - 0.72) * (1 - settle) + MOORED_Z * (1 - (1 - 0.72) * (1 - settle));

    state.rotation.rotX =
      (rotX * 0.25 + -1.34 * 0.75) * (1 - settle) +
      (-1.36 + floatBob * 1.8) * settle;
    state.rotation.rotY =
      (rotY * 0.35 + 0.22 * 0.65) * (1 - settle) + 0.22 * settle;
    state.rotation.rotZ =
      (rotZ * 0.35 + 0.24 * 0.65) * (1 - settle) +
      (0.24 + Math.sin(clock * 0.80) * 0.014) * settle;

    state.flutterFlex = 0.006 * (1 - settle) + 0.002;
    state.wetSheen = 0.88 + settle * 0.08;
    state.camouflageMix = 0;
    syncAliases(state);
    return;
  }

  if (p < 0.30) {
    state.phase = 'drop';
  } else if (p < 0.64) {
    state.phase = 'float';
  } else if (p < 0.84) {
    state.phase = 'approach';
  } else {
    state.phase = 'water_approach';
  }

  state.flutterFlex =
    0.024 + clamp(Math.abs(vx) * 0.12 + Math.abs(avY) * 0.035, 0.008, 0.09);
  state.wetSheen = 0.72 + smoothstep(0.28, 0.86, p) * 0.14;
  syncAliases(state);
}
