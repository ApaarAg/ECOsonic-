export type SpecimenPlateVariant = "active" | "left" | "right";

export interface CornerCutSpec {
  cutX: number;
  cutY: number;
  r: number;
}

export interface SpecimenPlateCorners {
  tl: CornerCutSpec;
  tr: CornerCutSpec;
  br: CornerCutSpec;
  bl: CornerCutSpec;
}

export interface SpecimenPlateGeometry {
  variant: SpecimenPlateVariant;
  width: number;
  height: number;
  /** SVG path in pixel coordinates [0..width, 0..height] for clip/fill */
  fillPath: string;
  /** SVG path inset by 0.65px for continuous crisp perimeter border */
  strokePath: string;
  /** SVG path normalized to [0..1, 0..1] for objectBoundingBox <clipPath> */
  normalizedClipPath: string;
  corners: SpecimenPlateCorners;
}

export function resolveSpecimenCorners(
  variant: SpecimenPlateVariant,
  width: number,
  height: number,
  isAperture = false,
): SpecimenPlateCorners {
  const w = Math.max(24, width);
  const h = Math.max(24, height);

  if (variant === "active") {
    if (isAperture) {
      return {
        tl: {
          cutX: Math.round(Math.min(12, w * 0.045)),
          cutY: Math.round(Math.min(14, h * 0.048)),
          r: 2.5,
        },
        tr: { cutX: 0, cutY: 0, r: 2 },
        br: {
          cutX: Math.round(Math.min(9, w * 0.034)),
          cutY: Math.round(Math.min(10, h * 0.034)),
          r: 2,
        },
        bl: { cutX: 0, cutY: 0, r: 2 },
      };
    }

    return {
      tl: {
        cutX: Math.round(Math.min(18, w * 0.062)),
        cutY: Math.round(Math.min(22, h * 0.056)),
        r: 3,
      },
      tr: { cutX: 0, cutY: 0, r: 3 },
      br: {
        cutX: Math.round(Math.min(12, w * 0.042)),
        cutY: Math.round(Math.min(14, h * 0.036)),
        r: 2.5,
      },
      bl: { cutX: 0, cutY: 0, r: 3 },
    };
  }

  const topCutX = Math.round(Math.min(12, w * 0.21));
  const topCutY = Math.round(Math.min(16, h * 0.045));
  const botCutX = Math.round(Math.min(8, w * 0.14));
  const botCutY = Math.round(Math.min(11, h * 0.031));

  if (variant === "left") {
    return {
      tl: { cutX: topCutX, cutY: topCutY, r: 2.5 },
      tr: { cutX: 0, cutY: 0, r: 2 },
      br: { cutX: 0, cutY: 0, r: 2 },
      bl: { cutX: botCutX, cutY: botCutY, r: 2 },
    };
  }

  return {
    tl: { cutX: 0, cutY: 0, r: 2 },
    tr: { cutX: topCutX, cutY: topCutY, r: 2.5 },
    br: { cutX: botCutX, cutY: botCutY, r: 2 },
    bl: { cutX: 0, cutY: 0, r: 2 },
  };
}

function buildRoundedAsymmetricPath(
  width: number,
  height: number,
  corners: SpecimenPlateCorners,
  inset: number,
  scaleX: number,
  scaleY: number,
  precision: number,
): string {
  const left = inset;
  const top = inset;
  const right = Math.max(left + 4, width - inset);
  const bottom = Math.max(top + 4, height - inset);

  const fmt = (x: number, y: number) =>
    `${(x * scaleX).toFixed(precision)} ${(y * scaleY).toFixed(precision)}`;

  const bevelDelta = (cx: number, cy: number, r: number) => {
    const len = Math.hypot(cx, cy);
    if (len <= 0.001) return { dx: 0, dy: 0 };
    const step = Math.min(r, len * 0.34);
    return { dx: (cx / len) * step, dy: (cy / len) * step };
  };

  const parts: string[] = [];
  const { tl, tr, br, bl } = corners;

  // Start just below Top-Left corner
  if (tl.cutX > 0 && tl.cutY > 0) {
    const { dx, dy } = bevelDelta(tl.cutX, tl.cutY, tl.r);
    parts.push(`M ${fmt(left, top + tl.cutY + tl.r)}`);
    parts.push(
      `Q ${fmt(left, top + tl.cutY)} ${fmt(left + dx, top + tl.cutY - dy)}`,
    );
    parts.push(`L ${fmt(left + tl.cutX - dx, top + dy)}`);
    parts.push(
      `Q ${fmt(left + tl.cutX, top)} ${fmt(left + tl.cutX + tl.r, top)}`,
    );
  } else {
    parts.push(`M ${fmt(left, top + tl.r)}`);
    parts.push(`Q ${fmt(left, top)} ${fmt(left + tl.r, top)}`);
  }

  // Top-Right corner
  if (tr.cutX > 0 && tr.cutY > 0) {
    const { dx, dy } = bevelDelta(tr.cutX, tr.cutY, tr.r);
    parts.push(`L ${fmt(right - tr.cutX - tr.r, top)}`);
    parts.push(
      `Q ${fmt(right - tr.cutX, top)} ${fmt(right - tr.cutX + dx, top + dy)}`,
    );
    parts.push(`L ${fmt(right - dx, top + tr.cutY - dy)}`);
    parts.push(
      `Q ${fmt(right, top + tr.cutY)} ${fmt(right, top + tr.cutY + tr.r)}`,
    );
  } else {
    parts.push(`L ${fmt(right - tr.r, top)}`);
    parts.push(`Q ${fmt(right, top)} ${fmt(right, top + tr.r)}`);
  }

  // Bottom-Right corner
  if (br.cutX > 0 && br.cutY > 0) {
    const { dx, dy } = bevelDelta(br.cutX, br.cutY, br.r);
    parts.push(`L ${fmt(right, bottom - br.cutY - br.r)}`);
    parts.push(
      `Q ${fmt(right, bottom - br.cutY)} ${fmt(right - dx, bottom - br.cutY + dy)}`,
    );
    parts.push(`L ${fmt(right - br.cutX + dx, bottom - dy)}`);
    parts.push(
      `Q ${fmt(right - br.cutX, bottom)} ${fmt(right - br.cutX - br.r, bottom)}`,
    );
  } else {
    parts.push(`L ${fmt(right, bottom - br.r)}`);
    parts.push(`Q ${fmt(right, bottom)} ${fmt(right - br.r, bottom)}`);
  }

  // Bottom-Left corner
  if (bl.cutX > 0 && bl.cutY > 0) {
    const { dx, dy } = bevelDelta(bl.cutX, bl.cutY, bl.r);
    parts.push(`L ${fmt(left + bl.cutX + bl.r, bottom)}`);
    parts.push(
      `Q ${fmt(left + bl.cutX, bottom)} ${fmt(left + bl.cutX - dx, bottom - dy)}`,
    );
    parts.push(`L ${fmt(left + dx, bottom - bl.cutY + dy)}`);
    parts.push(
      `Q ${fmt(left, bottom - bl.cutY)} ${fmt(left, bottom - bl.cutY - bl.r)}`,
    );
  } else {
    parts.push(`L ${fmt(left + bl.r, bottom)}`);
    parts.push(`Q ${fmt(left, bottom)} ${fmt(left, bottom - bl.r)}`);
  }

  parts.push("Z");
  return parts.join(" ");
}

/**
 * Generates deterministic SVG clip and border paths for a physical archival specimen plate.
 * Ensures the outer plate, continuous perimeter border, and inner image aperture share
 * one unified asymmetric specimen silhouette.
 */
export function buildSpecimenPlateGeometry(
  variant: SpecimenPlateVariant,
  width: number,
  height: number,
  isAperture = false,
): SpecimenPlateGeometry {
  const safeW = Math.max(24, Math.round(width));
  const safeH = Math.max(24, Math.round(height));
  const corners = resolveSpecimenCorners(variant, safeW, safeH, isAperture);

  return {
    variant,
    width: safeW,
    height: safeH,
    fillPath: buildRoundedAsymmetricPath(safeW, safeH, corners, 0, 1, 1, 2),
    strokePath: buildRoundedAsymmetricPath(safeW, safeH, corners, 0.65, 1, 1, 2),
    normalizedClipPath: buildRoundedAsymmetricPath(
      safeW,
      safeH,
      corners,
      0,
      1 / safeW,
      1 / safeH,
      5,
    ),
    corners,
  };
}
