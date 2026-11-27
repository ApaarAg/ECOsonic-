import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const executablePath = fs.existsSync(CHROME_PATH) ? CHROME_PATH : EDGE_PATH;

const OUT_DIR = path.resolve("src/assets/stylized");
fs.mkdirSync(OUT_DIR, { recursive: true });

const HTML_RENDERER = /* html */ `<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;background:#000;">
<script>
function makePrng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hash2(ix, iy) {
  const n = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function vnoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return (
    (hash2(ix, iy) * (1 - ux) + hash2(ix + 1, iy) * ux) * (1 - uy) +
    (hash2(ix, iy + 1) * (1 - ux) + hash2(ix + 1, iy + 1) * ux) * uy
  );
}

function fbm(x, y, oct = 4) {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < oct; i++) {
    v += amp * vnoise(x * freq, y * freq);
    freq *= 2.04;
    amp *= 0.5;
  }
  return v;
}

function gray(v, a = 1) {
  const c = Math.max(0, Math.min(255, Math.round(v)));
  return a >= 1 ? \`rgb(\${c},\${c},\${c})\` : \`rgba(\${c},\${c},\${c},\${a})\`;
}

function drawSmoothClosedCurve(ctx, pts) {
  if (pts.length < 3) return;
  ctx.beginPath();
  const n = pts.length;
  const mid0x = (pts[n - 1][0] + pts[0][0]) * 0.5;
  const mid0y = (pts[n - 1][1] + pts[0][1]) * 0.5;
  ctx.moveTo(mid0x, mid0y);
  for (let i = 0; i < n; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    ctx.quadraticCurveTo(p1[0], p1[1], (p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5);
  }
  ctx.closePath();
}

function applyMonoGrain(ctx, w, h, amount = 6, alphaPreserve = true) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (alphaPreserve && d[idx + 3] < 6) continue;
      const g =
        (hash2(x * 0.71, y * 0.71) - 0.5) * amount +
        (vnoise(x * 0.045, y * 0.045) - 0.5) * amount * 0.7;
      const avg = Math.round(d[idx] * 0.299 + d[idx + 1] * 0.587 + d[idx + 2] * 0.114);
      const val = Math.max(0, Math.min(255, Math.round(avg + g)));
      d[idx] = val;
      d[idx + 1] = val;
      d[idx + 2] = val;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function drawTaperedRibbon(ctx, points, startWidth, endWidth, color, alpha = 1) {
  if (points.length < 2) return;
  const left = [];
  const right = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const halfW = (startWidth * (1 - t) + endWidth * t) * 0.5;
    const pPrev = points[Math.max(0, i - 1)];
    const pNext = points[Math.min(n - 1, i + 1)];
    let dx = pNext[0] - pPrev[0];
    let dy = pNext[1] - pPrev[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const nx = -dy;
    const ny = dx;
    left.push([points[i][0] + nx * halfW, points[i][1] + ny * halfW]);
    right.push([points[i][0] - nx * halfW, points[i][1] - ny * halfW]);
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawMonoLeaf(ctx, opts) {
  const {
    cx,
    cy,
    length,
    width,
    angleRad,
    toneDark = "#0d0d0d",
    toneMid = "#1b1b1b",
    toneLight = "#2d2d2d",
    veinMid = "#484848",
    veinBright = "#636363",
    edgeStroke = "#080808",
    stemTone = "#0b0b0b",
    seed = 1,
    hasNotch = false,
    petioleCurve = 0.06,
    alpha = 1,
    detailVeins = true,
  } = opts;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.rotate(angleRad);

  const petPts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const px =
      Math.sin(t * Math.PI) * width * petioleCurve +
      (fbm(t * 2.5, seed * 0.7, 2) - 0.5) * width * 0.014;
    const py = t * length * 0.21;
    petPts.push([px, py]);
  }
  drawTaperedRibbon(ctx, petPts, Math.max(2.2, length * 0.021), Math.max(1.1, length * 0.011), stemTone, alpha);

  const pts = [];
  const halfSteps = 44;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i <= halfSteps; i++) {
      const u = pass === 0 ? i / halfSteps : 1 - i / halfSteps;
      const side = pass === 0 ? 1 : -1;
      if (u < 0.01 && pass === 1) continue;
      const baseEnv =
        Math.sin(Math.pow(u, 0.72) * Math.PI) *
        (0.78 + 0.24 * Math.sin(u * Math.PI * 0.82)) *
        (1.0 - 0.16 * Math.pow(u, 2.8));
      const crinkle =
        (Math.sin(u * Math.PI * 14.0 + side * 0.5) * 0.018 +
          (fbm(u * 5.6 + seed * 0.3, side * 1.7 + seed * 0.19, 3) - 0.5) * 0.044) *
        Math.sin(u * Math.PI);
      const asym = side > 0 ? 1.04 : 0.96;
      let r = Math.max(0.01, (baseEnv + crinkle) * asym * width * 0.5);

      if (hasNotch && side > 0 && u > 0.61 && u < 0.70) {
        const nt = 1 - Math.abs((u - 0.655) / 0.045);
        r *= 1 - 0.24 * nt * nt;
      }

      const py = length * 0.18 + u * length * 0.82;
      const midX =
        Math.sin(u * Math.PI) * width * 0.028 +
        Math.sin(u * 2.1 + seed) * width * 0.007;
      pts.push([midX + side * r, py]);
    }
  }

  ctx.save();
  drawSmoothClosedCurve(ctx, pts);
  ctx.clip();

  const grad = ctx.createLinearGradient(-width * 0.36, length * 0.16, width * 0.42, length * 0.98);
  grad.addColorStop(0, toneDark);
  grad.addColorStop(0.50, toneMid);
  grad.addColorStop(0.90, toneLight);
  grad.addColorStop(1, toneMid);
  ctx.fillStyle = grad;
  ctx.fillRect(-width, 0, width * 2, length * 1.1);

  const fold = ctx.createLinearGradient(-width * 0.48, length * 0.35, width * 0.46, length * 0.62);
  fold.addColorStop(0, "rgba(215, 215, 215, 0.12)");
  fold.addColorStop(0.45, "rgba(180, 180, 180, 0.02)");
  fold.addColorStop(0.51, "rgba(0, 0, 0, 0.24)");
  fold.addColorStop(1, "rgba(0, 0, 0, 0.34)");
  ctx.fillStyle = fold;
  ctx.fillRect(-width, 0, width * 2, length * 1.1);

  if (detailVeins) {
    const rand = makePrng(seed * 733 + 19);
    for (let i = 0; i < 12; i++) {
      const px = (rand() - 0.5) * width * 0.74;
      const py = length * (0.22 + rand() * 0.70);
      const rad = length * (0.045 + rand() * 0.085);
      const rg = ctx.createRadialGradient(px, py, 0, px, py, rad);
      rg.addColorStop(0, rand() > 0.5 ? "rgba(120, 120, 120, 0.09)" : "rgba(6, 6, 6, 0.14)");
      rg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fill();
    }

    const pairs = 7;
    for (const side of [-1, 1]) {
      for (let v = 0; v < pairs; v++) {
        const frac = 0.09 + (v / pairs) * 0.74;
        const veinPts = [];
        const stepsV = 12;
        for (let s = 0; s <= stepsV; s++) {
          const t = s / stepsV;
          const uAlong = frac + t * 0.15 * (1 - frac * 0.35);
          const mX =
            Math.sin(uAlong * Math.PI) * width * 0.028 +
            Math.sin(uAlong * 2.1 + seed) * width * 0.007;
          const span = Math.sin(Math.pow(frac, 0.72) * Math.PI) * width * 0.41;
          const px = mX + side * span * Math.pow(t, 0.88);
          const py =
            length * 0.21 +
            (frac * 0.76 + Math.pow(t, 1.35) * 0.15 * (1 - frac * 0.3)) * length;
          veinPts.push([px, py]);
        }

        drawTaperedRibbon(
          ctx,
          veinPts.map(([vx, vy]) => [vx, vy + length * 0.004]),
          Math.max(1.5, length * 0.011),
          0.4,
          "rgba(5, 5, 5, 0.30)",
          alpha
        );
        drawTaperedRibbon(
          ctx,
          veinPts,
          Math.max(1.0, length * (0.0065 - frac * 0.002)),
          0.35,
          veinMid,
          alpha * (0.48 - frac * 0.15)
        );
      }
    }

    const midPts = [];
    for (let s = 0; s <= 16; s++) {
      const u = s / 16;
      const mx =
        Math.sin(u * Math.PI) * width * 0.028 +
        Math.sin(u * 2.1 + seed) * width * 0.007;
      const my = length * (0.19 + u * 0.77);
      midPts.push([mx, my]);
    }
    drawTaperedRibbon(ctx, midPts, Math.max(1.8, length * 0.013), Math.max(0.6, length * 0.003), veinBright, alpha * 0.72);
  }

  ctx.globalAlpha = alpha * 0.55;
  ctx.strokeStyle = edgeStroke;
  ctx.lineWidth = Math.max(1.2, length * 0.006);
  drawSmoothClosedCurve(ctx, pts);
  ctx.stroke();

  ctx.restore();
  ctx.restore();
}

// Fast pointed leaf silhouette for dense foliage canopy layering (organic leaf spray, zero cartoon clouds!)
function drawSilhouetteLeaf(ctx, cx, cy, len, wid, ang, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(wid * 0.58, len * 0.28, wid * 0.48, len * 0.72, 0, len);
  ctx.bezierCurveTo(-wid * 0.48, len * 0.72, -wid * 0.58, len * 0.28, 0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawCurvedBranch(ctx, pts, w0, w1, fillStyle, alpha = 1) {
  const dense = [];
  const segs = 28;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const f = t * (pts.length - 1);
    const idx = Math.min(pts.length - 2, Math.floor(f));
    const u = f - idx;
    const p0 = pts[Math.max(0, idx - 1)];
    const p1 = pts[idx];
    const p2 = pts[idx + 1];
    const p3 = pts[Math.min(pts.length - 1, idx + 2)];
    const u2 = u * u;
    const u3 = u2 * u;
    const x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * u + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * u2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * u3);
    const y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * u + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3);
    const gnarl = (fbm(t * 6.5, w0 * 0.17, 2) - 0.5) * Math.max(2, w0 * 0.12);
    dense.push([x + gnarl * 0.4, y + gnarl]);
  }
  drawTaperedRibbon(ctx, dense, w0, w1, fillStyle, alpha);
  return dense;
}

// Organic distant woodland tree with forked branches and real leaf-spray crowns (drawn solid offscreen, then blurred/faded)
function drawDistantTree(targetCtx, w, h, baseX, baseY, height, baseW, lean, tone, seed, blurPx = 0, opacity = 1) {
  const buf = document.createElement("canvas");
  buf.width = w; buf.height = h;
  const ctx = buf.getContext("2d");

  const segs = 26;
  const left = [];
  const right = [];
  const center = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = baseY - height * t;
    const sway = Math.sin(t * Math.PI * 0.9 + seed) * lean + (fbm(t * 2.5, seed * 0.3, 2) - 0.5) * baseW * 0.45;
    const flare = Math.pow(Math.max(0, 1 - t * 4.5), 2.2) * baseW * 0.65;
    const tw = baseW * (1 - t * 0.72) + flare;
    center.push([baseX + sway, y]);
    left.push([baseX + sway - tw * 0.5, y]);
    right.push([baseX + sway + tw * 0.5, y]);
  }
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fillStyle = tone;
  ctx.fill();

  const rand = makePrng(seed * 91);
  const growBough = (sx, sy, ang, len, wid, depth) => {
    const midX = sx + Math.cos(ang + (rand() - 0.5) * 0.25) * len * 0.5;
    const midY = sy + Math.sin(ang + (rand() - 0.5) * 0.25) * len * 0.5 - len * 0.06;
    const ex = sx + Math.cos(ang) * len;
    const ey = sy + Math.sin(ang) * len;
    drawCurvedBranch(ctx, [[sx, sy], [midX, midY], [ex, ey]], wid, Math.max(1.5, wid * 0.32), tone, 1.0);
    if (depth <= 1) {
      const sprays = 14 + Math.floor(rand() * 10);
      for (let k = 0; k < sprays; k++) {
        const t = 0.35 + rand() * 0.72;
        const lx = sx + (ex - sx) * t + (rand() - 0.5) * len * 0.65;
        const ly = sy + (ey - sy) * t + (rand() - 0.5) * len * 0.48;
        drawSilhouetteLeaf(ctx, lx, ly, 36 + rand() * 44, 20 + rand() * 22, ang + (rand() - 0.5) * 2.2, tone);
      }
    }
    if (depth > 0) {
      for (let s = 0; s < 2; s++) {
        const subAng = ang + (s === 0 ? -1 : 1) * (0.36 + rand() * 0.28);
        growBough(
          s === 0 ? midX : ex,
          s === 0 ? midY : ey,
          subAng,
          len * (0.58 + rand() * 0.16),
          wid * 0.48,
          depth - 1
        );
      }
    }
  };

  for (let b = 0; b < 5; b++) {
    const frac = 0.48 + b * 0.11;
    const idx = Math.floor(segs * frac);
    const [sx, sy] = center[idx];
    const dir = b % 2 === 0 ? -1 : 1;
    growBough(sx, sy, -Math.PI * 0.5 + dir * (0.55 + rand() * 0.35), height * (0.20 + rand() * 0.10), baseW * 0.28, 2);
  }
  const [tx, ty] = center[segs];
  growBough(tx, ty, -Math.PI * 0.5 + (rand() - 0.5) * 0.3, height * 0.18, baseW * 0.20, 2);

  targetCtx.save();
  targetCtx.globalAlpha = opacity;
  if (blurPx > 0) targetCtx.filter = \`blur(\${blurPx}px)\`;
  targetCtx.drawImage(buf, 0, 0);
  targetCtx.restore();
}

function drawFoliageCluster(ctx, cx, cy, radiusX, radiusY, count, baseTone, lightTone, seed) {
  const rand = makePrng(seed);
  // Dense inner silhouette leaf layer
  for (let i = 0; i < Math.floor(count * 0.65); i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.pow(rand(), 0.72);
    const lx = cx + Math.cos(a) * radiusX * r * 0.85;
    const ly = cy + Math.sin(a) * radiusY * r * 0.85;
    const len = 58 + rand() * 58;
    drawSilhouetteLeaf(ctx, lx, ly, len, len * 0.58, a + (rand() - 0.5) * 1.8, baseTone);
  }
  // Detailed outer broadleaves matching hero leaf craft
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.pow(rand(), 0.55);
    const lx = cx + Math.cos(a) * radiusX * r;
    const ly = cy + Math.sin(a) * radiusY * r;
    const len = 66 + rand() * 72;
    const wid = len * (0.56 + rand() * 0.14);
    const ang = a + Math.PI * 0.5 + (rand() - 0.5) * 1.25;
    const toneMid = rand() > 0.5 ? lightTone : baseTone;
    drawMonoLeaf(ctx, {
      cx: lx,
      cy: ly,
      length: len,
      width: wid,
      angleRad: ang,
      toneDark: baseTone,
      toneMid,
      toneLight: lightTone,
      veinMid: gray(74),
      veinBright: gray(90),
      edgeStroke: baseTone,
      stemTone: baseTone,
      seed: seed + i * 7,
      alpha: 0.94 + rand() * 0.06,
      detailVeins: len > 92,
    });
  }
}

function drawMonoFern(ctx, baseX, baseY, len, angle, bend, tone, scalePinnae = 1, seed = 1, alpha = 0.95) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(baseX, baseY);
  ctx.rotate(angle);
  const stemPts = [];
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    const it = 1 - t;
    stemPts.push([
      2 * it * t * (bend * len * 0.45) + t * t * (bend * len),
      2 * it * t * (-len * 0.55) + t * t * (-len),
    ]);
  }
  drawTaperedRibbon(ctx, stemPts, Math.max(2.6, len * 0.011), 0.8, tone, alpha);

  const rand = makePrng(seed * 61 + 5);
  const count = 24;
  for (let i = 2; i < count; i++) {
    const t = i / count;
    const it = 1 - t;
    const rx = 2 * it * t * (bend * len * 0.45) + t * t * (bend * len);
    const ry = 2 * it * t * (-len * 0.55) + t * t * (-len);
    const tx = 2 * it * (bend * len * 0.45) + 2 * t * (bend * len - bend * len * 0.45);
    const ty = 2 * it * (-len * 0.55) + 2 * t * (-len + len * 0.55);
    const normAng = Math.atan2(ty, tx);

    const irreg = 0.84 + rand() * 0.32;
    const pinnaLen = len * 0.17 * Math.sin(Math.pow(t, 0.72) * Math.PI) * scalePinnae * irreg;
    const pinnaW = pinnaLen * 0.25;

    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(normAng + side * (Math.PI * 0.42 - t * 0.18 + (rand() - 0.5) * 0.12));
      ctx.fillStyle = tone;
      ctx.beginPath();
      ctx.moveTo(0, -pinnaW * 0.4);
      ctx.quadraticCurveTo(pinnaLen * 0.52, -pinnaW * 0.86, pinnaLen, 0);
      ctx.quadraticCurveTo(pinnaLen * 0.46, pinnaW * 0.6, 0, pinnaW * 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}

window.renderPlates = () => {
  const outputs = {};

  // =========================================================================
  // 1. BG CANOPY PLATE (z = -4.6, 20.0 x 13.0 world)
  // =========================================================================
  {
    const w = 1920, h = 1280;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");

    const sky = ctx.createRadialGradient(w * 0.54, h * 0.36, 40, w * 0.50, h * 0.46, w * 0.74);
    sky.addColorStop(0, "#E2E2E2");
    sky.addColorStop(0.38, "#C8C8C8");
    sky.addColorStop(0.72, "#989898");
    sky.addColorStop(1, "#5E5E5E");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    const mistPuffs = [
      { x: 0.54, y: 0.32, rx: 500, ry: 280, a: 0.30 },
      { x: 0.36, y: 0.46, rx: 420, ry: 230, a: 0.22 },
      { x: 0.68, y: 0.42, rx: 440, ry: 250, a: 0.22 },
      { x: 0.50, y: 0.62, rx: 660, ry: 200, a: 0.24 },
    ];
    for (const puff of mistPuffs) {
      ctx.save();
      ctx.translate(w * puff.x, h * puff.y);
      ctx.scale(1, puff.ry / puff.rx);
      const pg = ctx.createRadialGradient(0, 0, 10, 0, 0, puff.rx);
      pg.addColorStop(0, \`rgba(234,234,234,\${puff.a})\`);
      pg.addColorStop(0.55, \`rgba(214,214,214,\${puff.a * 0.45})\`);
      pg.addColorStop(1, "rgba(190,190,190,0)");
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(0, 0, puff.rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const farTrees = [
      { x: w * 0.08, y: h * 0.98, h: h * 1.02, w: 66, lean: 18, tone: "#787878", seed: 11, blur: 4, op: 0.84 },
      { x: w * 0.18, y: h * 0.98, h: h * 0.96, w: 48, lean: -16, tone: "#8C8C8C", seed: 22, blur: 5, op: 0.72 },
      { x: w * 0.27, y: h * 0.96, h: h * 0.88, w: 36, lean: 12, tone: "#9E9E9E", seed: 33, blur: 6, op: 0.58 },
      { x: w * 0.75, y: h * 0.96, h: h * 0.88, w: 38, lean: -12, tone: "#989898", seed: 44, blur: 6, op: 0.60 },
      { x: w * 0.84, y: h * 0.98, h: h * 0.96, w: 56, lean: 16, tone: "#848484", seed: 55, blur: 5, op: 0.74 },
      { x: w * 0.93, y: h * 0.98, h: h * 1.02, w: 74, lean: -20, tone: "#727272", seed: 66, blur: 4, op: 0.86 },
    ];
    for (const tr of farTrees) {
      drawDistantTree(ctx, w, h, tr.x, tr.y, tr.h, tr.w, tr.lean, tr.tone, tr.seed, tr.blur, tr.op);
    }

    const lowMist = ctx.createLinearGradient(0, h * 0.46, 0, h);
    lowMist.addColorStop(0, "rgba(216,216,216,0)");
    lowMist.addColorStop(0.38, "rgba(182,182,182,0.34)");
    lowMist.addColorStop(0.68, "rgba(86,86,86,0.52)");
    lowMist.addColorStop(0.86, "rgba(24,24,24,0.88)");
    lowMist.addColorStop(1, "#0E0E0E");
    ctx.fillStyle = lowMist;
    ctx.fillRect(0, 0, w, h);

    applyMonoGrain(ctx, w, h, 7, false);
    outputs.bgCanopy = c.toDataURL("image/webp", 0.90);
  }

  // =========================================================================
  // 2. MID UNDERSTORY PLATE (z = -1.8, 14.0 x 9.0 world)
  // =========================================================================
  {
    const w = 1920, h = 1240;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");

    drawDistantTree(ctx, w, h, w * 0.09, h * 0.86, h * 0.92, 126, 24, "#343434", 101, 2.0, 0.94);
    drawDistantTree(ctx, w, h, w * 0.21, h * 0.84, h * 0.88, 82, -16, "#4A4A4A", 102, 2.5, 0.86);
    drawDistantTree(ctx, w, h, w * 0.79, h * 0.84, h * 0.88, 86, 18, "#464646", 103, 2.5, 0.86);
    drawDistantTree(ctx, w, h, w * 0.91, h * 0.86, h * 0.92, 136, -24, "#303030", 104, 2.0, 0.94);

    // Continuous sloped dark earth banks anchored solidly down past the waterline
    const drawGentleShore = (pts, topTone, midTone) => {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const xc = (pts[i][0] + pts[i + 1][0]) * 0.5;
        const yc = (pts[i][1] + pts[i + 1][1]) * 0.5;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], xc, yc);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last[0], last[1]);
      ctx.lineTo(last[0], h * 1.04);
      ctx.lineTo(pts[0][0], h * 1.04);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, h * 0.68, 0, h * 1.01);
      g.addColorStop(0, topTone);
      g.addColorStop(0.55, midTone);
      g.addColorStop(0.86, "#101010");
      g.addColorStop(1, "#0B0B0B");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
    };

    drawGentleShore([
      [-60, h * 0.68],
      [w * 0.14, h * 0.71],
      [w * 0.25, h * 0.76],
      [w * 0.35, h * 0.84],
      [w * 0.44, h * 0.94],
      [w * 0.52, h * 1.03],
    ], "#262626", "#161616");

    drawGentleShore([
      [w * 0.52, h * 1.03],
      [w * 0.60, h * 0.92],
      [w * 0.72, h * 0.82],
      [w * 0.83, h * 0.75],
      [w * 0.92, h * 0.70],
      [w + 60, h * 0.68],
    ], "#242424", "#151515");

    drawMonoFern(ctx, w * 0.15, h * 0.75, 240, 0.40, 0.16, "#242424", 0.92, 31, 0.92);
    drawMonoFern(ctx, w * 0.21, h * 0.78, 185, 0.68, 0.22, "#2C2C2C", 0.86, 32, 0.86);
    drawMonoFern(ctx, w * 0.84, h * 0.76, 250, -0.44, -0.18, "#222222", 0.94, 33, 0.92);
    drawMonoFern(ctx, w * 0.77, h * 0.79, 180, -0.72, -0.22, "#2B2B2B", 0.85, 34, 0.86);

    applyMonoGrain(ctx, w, h, 6, true);
    outputs.midUnderstory = c.toDataURL("image/webp", 0.90);
  }

  // =========================================================================
  // 3. PROTAGONIST HERO TREE + HERO BRANCH PLATE (z = -0.05, 8.8 x 6.6 world, 2400x1800 RGBA)
  //    Hero socket at px = 1264 (u = 0.5267, worldX = +0.235), py = 716 (worldY = +0.925).
  // =========================================================================
  {
    const w = 2400, h = 1800;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");

    const trunkBaseX = w * 0.415; // 996
    const trunkBaseY = h * 0.91;  // 1638
    const trunkTopY = h * 0.20;

    // 3a. Back canopy depth layer
    drawFoliageCluster(ctx, w * 0.26, h * 0.25, 340, 175, 48, "#1F1F1F", "#2F2F2F", 701);
    drawFoliageCluster(ctx, w * 0.44, h * 0.14, 390, 170, 56, "#212121", "#313131", 702);
    drawFoliageCluster(ctx, w * 0.63, h * 0.18, 310, 150, 42, "#232323", "#333333", 703);
    drawFoliageCluster(ctx, w * 0.17, h * 0.36, 240, 145, 34, "#212121", "#313131", 704);

    // 3b. Main mature broad trunk with natural organic curve & root flare
    const trunkSegs = 40;
    const leftPts = [];
    const rightPts = [];
    const centerPts = [];
    for (let i = 0; i <= trunkSegs; i++) {
      const t = i / trunkSegs;
      const y = trunkBaseY - (trunkBaseY - trunkTopY) * t;
      const sway =
        Math.sin(t * Math.PI * 1.12 + 0.3) * 38 +
        (fbm(t * 2.2, 1.4, 3) - 0.5) * 36;
      const rootFlare = Math.pow(Math.max(0, 1 - t * 3.4), 2.1) * 195;
      const baseW = 205 * (1 - t * 0.60) + rootFlare;
      const barkL = (fbm(t * 10.5, 2.3, 3) - 0.5) * 18;
      const barkR = (fbm(t * 10.5, 7.9, 3) - 0.5) * 18;
      const cx = trunkBaseX + sway;
      centerPts.push([cx, y]);
      leftPts.push([cx - baseW * 0.5 + barkL, y]);
      rightPts.push([cx + baseW * 0.5 + barkR, y]);
    }

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(leftPts[0][0], leftPts[0][1]);
    for (let i = 1; i < leftPts.length; i++) ctx.lineTo(leftPts[i][0], leftPts[i][1]);
    for (let i = rightPts.length - 1; i >= 0; i--) ctx.lineTo(rightPts[i][0], rightPts[i][1]);
    ctx.closePath();

    const trunkGrad = ctx.createLinearGradient(trunkBaseX - 150, 0, trunkBaseX + 150, 0);
    trunkGrad.addColorStop(0, "#090909");
    trunkGrad.addColorStop(0.55, "#151515");
    trunkGrad.addColorStop(0.88, "#222222");
    trunkGrad.addColorStop(1, "#2B2B2B");
    ctx.fillStyle = trunkGrad;

    ctx.save();
    ctx.clip();
    ctx.fillRect(0, 0, w, h);
    const barkRand = makePrng(404);
    for (let b = 0; b < 40; b++) {
      const xOff = (barkRand() - 0.45) * 185;
      const tStart = barkRand() * 0.65;
      const tEnd = Math.min(1, tStart + 0.22 + barkRand() * 0.35);
      const pts = [];
      for (let k = 0; k <= 10; k++) {
        const u = tStart + (tEnd - tStart) * (k / 10);
        const idx = Math.min(trunkSegs, Math.floor(u * trunkSegs));
        const cx = centerPts[idx][0] + xOff * (1 - u * 0.55) + (fbm(u * 9, b * 0.7, 2) - 0.5) * 14;
        pts.push([cx, centerPts[idx][1]]);
      }
      drawTaperedRibbon(ctx, pts, 3 + barkRand() * 5, 1, b % 3 === 0 ? "#2B2B2B" : "#070707", 0.36);
    }
    ctx.restore();
    ctx.restore();

    // Organic root buttresses emerging smoothly from inside the lower trunk into the mossy forest floor
    const rootCurves = [
      [[trunkBaseX - 18, h * 0.74], [trunkBaseX - 115, h * 0.81], [trunkBaseX - 270, h * 0.86], [trunkBaseX - 480, h * 0.89]],
      [[trunkBaseX - 8, h * 0.76], [trunkBaseX - 68, h * 0.83], [trunkBaseX - 175, h * 0.88], [trunkBaseX - 310, h * 0.91]],
      [[trunkBaseX + 12, h * 0.75], [trunkBaseX + 90, h * 0.82], [trunkBaseX + 185, h * 0.86], [trunkBaseX + 275, h * 0.89]],
    ];
    for (let r = 0; r < rootCurves.length; r++) {
      drawCurvedBranch(ctx, rootCurves[r], 58, 8, "#111111", 1.0);
    }

    // Continuous forest floor ground mound extending cleanly from left edge past trunk roots
    // and sloping smoothly down into the pool basin (POOL_SURFACE_Y ~ h*0.788)
    {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-40, h * 0.76);
      ctx.quadraticCurveTo(w * 0.16, h * 0.75, w * 0.34, h * 0.78);
      ctx.quadraticCurveTo(w * 0.45, h * 0.80, w * 0.53, h * 0.87);
      ctx.quadraticCurveTo(w * 0.57, h * 0.93, w * 0.61, h * 1.04);
      ctx.lineTo(-40, h * 1.04);
      ctx.closePath();
      const fgGrad = ctx.createLinearGradient(0, h * 0.74, 0, h * 1.02);
      fgGrad.addColorStop(0, "#151515");
      fgGrad.addColorStop(0.45, "#101010");
      fgGrad.addColorStop(1, "#0B0B0B");
      ctx.fillStyle = fgGrad;
      ctx.fill();
      ctx.restore();
    }

    // 3c. Structural limbs & continuous layered canopy
    const sampleTrunk = (tFrac) => centerPts[Math.min(trunkSegs, Math.max(0, Math.round(tFrac * trunkSegs)))];

    {
      const pA = sampleTrunk(0.60);
      drawCurvedBranch(ctx, [pA, [pA[0] - 180, pA[1] - 90], [pA[0] - 410, pA[1] - 180], [pA[0] - 580, pA[1] - 195]], 66, 11, "#121212");
      drawCurvedBranch(ctx, [[pA[0] - 210, pA[1] - 105], [pA[0] - 320, pA[1] - 240], [pA[0] - 430, pA[1] - 340]], 34, 7, "#141414");

      const pB = sampleTrunk(0.78);
      drawCurvedBranch(ctx, [pB, [pB[0] - 160, pB[1] - 130], [pB[0] - 330, pB[1] - 270], [pB[0] - 490, pB[1] - 360]], 52, 9, "#141414");

      // Mid-left bough sweeping upward into the main left canopy with mid-limb foliage
      const pC = sampleTrunk(0.51);
      drawCurvedBranch(ctx, [pC, [pC[0] - 150, pC[1] - 55], [pC[0] - 320, pC[1] - 130], [pC[0] - 490, pC[1] - 210]], 38, 8, "#111111");
      drawFoliageCluster(ctx, pC[0] - 280, pC[1] - 125, 165, 105, 24, "#101010", "#222222", 789);

      const pTop = sampleTrunk(0.92);
      drawCurvedBranch(ctx, [pTop, [pTop[0] + 60, pTop[1] - 110], [pTop[0] + 190, pTop[1] - 220], [pTop[0] + 350, pTop[1] - 290]], 56, 9, "#151515");
      drawCurvedBranch(ctx, [pTop, [pTop[0] - 70, pTop[1] - 130], [pTop[0] - 180, pTop[1] - 250], [pTop[0] - 270, pTop[1] - 340]], 52, 8, "#141414");

      const pRightUpper = sampleTrunk(0.76);
      drawCurvedBranch(ctx, [pRightUpper, [pRightUpper[0] + 180, pRightUpper[1] - 110], [pRightUpper[0] + 410, pRightUpper[1] - 185], [pRightUpper[0] + 660, pRightUpper[1] - 205]], 54, 9, "#131313");
      drawCurvedBranch(ctx, [[pRightUpper[0] + 220, pRightUpper[1] - 125], [pRightUpper[0] + 370, pRightUpper[1] - 245], [pRightUpper[0] + 510, pRightUpper[1] - 320]], 30, 6, "#161616");
    }

    // 3d. Lush continuous foreground canopy layers
    drawFoliageCluster(ctx, w * 0.23, h * 0.26, 330, 180, 58, "#0E0E0E", "#212121", 801);
    drawFoliageCluster(ctx, w * 0.42, h * 0.13, 370, 160, 62, "#0D0D0D", "#1F1F1F", 802);
    drawFoliageCluster(ctx, w * 0.62, h * 0.16, 330, 145, 52, "#111111", "#252525", 803);
    drawFoliageCluster(ctx, w * 0.16, h * 0.37, 220, 130, 34, "#101010", "#222222", 804);
    drawFoliageCluster(ctx, w * 0.75, h * 0.27, 240, 135, 36, "#131313", "#272727", 805);

    // 3e. THE HERO BRANCH growing cleanly out of trunk at t = 0.58
    const heroOrigin = sampleTrunk(0.58);
    const heroLimbPts = [
      [heroOrigin[0] - 12, heroOrigin[1] + 8],
      [heroOrigin[0] + 145, heroOrigin[1] - 115],
      [1300, 695],
      [1520, 668],
      [1720, 688],
    ];
    drawCurvedBranch(ctx, heroLimbPts, 38, 6.5, "#101010", 1.0);

    drawCurvedBranch(ctx, [[1185, 765], [1150, 710], [1115, 672]], 11, 3.2, "#101010", 1.0);
    drawCurvedBranch(ctx, [[1375, 682], [1425, 628], [1490, 595]], 10, 2.8, "#101010", 1.0);
    drawCurvedBranch(ctx, [[1545, 668], [1605, 718], [1665, 762]], 9, 2.5, "#101010", 1.0);

    // EXACT HERO LEAF TWIG SOCKET: px = 1264 (u = 0.5267, worldX = +0.235), py = 716 (worldY = +0.925)
    drawCurvedBranch(ctx, [[1222, 738], [1246, 714], [1264, 716]], 8.5, 3.0, "#0E0E0E", 1.0);
    ctx.fillStyle = "#1E1E1E";
    ctx.beginPath();
    ctx.arc(1264, 716, 4.2, 0, Math.PI * 2);
    ctx.fill();

    const heroBranchLeaves = [
      { cx: 1115, cy: 672, len: 136, wid: 86, ang: 2.38, seed: 911, toneMid: "#191919" },
      { cx: 1152, cy: 710, len: 144, wid: 92, ang: 2.82, seed: 912, toneMid: "#1E1E1E" },
      { cx: 1335, cy: 688, len: 132, wid: 84, ang: -2.45, seed: 913, toneMid: "#222222" },
      { cx: 1435, cy: 625, len: 146, wid: 92, ang: -2.20, seed: 914, toneMid: "#1B1B1B" },
      { cx: 1492, cy: 595, len: 130, wid: 82, ang: -1.95, seed: 915, toneMid: "#242424" },
      { cx: 1580, cy: 672, len: 148, wid: 94, ang: 2.45, seed: 916, toneMid: "#191919" },
      { cx: 1665, cy: 760, len: 134, wid: 84, ang: 2.15, seed: 917, toneMid: "#202020" },
      { cx: 1718, cy: 688, len: 126, wid: 80, ang: 1.68, seed: 918, toneMid: "#1D1D1D" },
    ];
    for (const lf of heroBranchLeaves) {
      drawMonoLeaf(ctx, {
        cx: lf.cx,
        cy: lf.cy,
        length: lf.len,
        width: lf.wid,
        angleRad: lf.ang,
        toneDark: "#0B0B0B",
        toneMid: lf.toneMid,
        toneLight: "#2E2E2E",
        veinMid: "#474747",
        veinBright: "#606060",
        edgeStroke: "#070707",
        stemTone: "#0B0B0B",
        seed: lf.seed,
        alpha: 0.99,
        detailVeins: true,
      });
    }

    drawMonoFern(ctx, trunkBaseX - 285, h * 0.81, 300, 0.36, 0.16, "#101010", 1.0, 91, 0.96);
    drawMonoFern(ctx, trunkBaseX - 180, h * 0.83, 230, 0.62, 0.20, "#151515", 0.9, 92, 0.94);
    drawMonoFern(ctx, trunkBaseX + 170, h * 0.84, 210, -0.58, -0.18, "#141414", 0.88, 93, 0.92);

    applyMonoGrain(ctx, w, h, 6, true);
    outputs.heroTree = c.toDataURL("image/webp", 0.92);
  }

  // =========================================================================
  // 4. FOREGROUND BLURRED FOLIAGE SILHOUETTES
  // =========================================================================
  {
    const w = 1920, h = 1280;
    const raw = document.createElement("canvas");
    raw.width = w; raw.height = h;
    const rctx = raw.getContext("2d");

    drawCurvedBranch(rctx, [[-40, h * 0.18], [w * 0.08, h * 0.22], [w * 0.16, h * 0.27]], 22, 6, "#060606", 0.92);
    drawMonoLeaf(rctx, { cx: w * 0.11, cy: h * 0.23, length: 240, width: 152, angleRad: 2.45, toneDark: "#040404", toneMid: "#090909", toneLight: "#121212", edgeStroke: "#030303", stemTone: "#040404", seed: 301, detailVeins: false, alpha: 0.95 });
    drawMonoLeaf(rctx, { cx: w * 0.16, cy: h * 0.27, length: 210, width: 132, angleRad: 1.95, toneDark: "#040404", toneMid: "#090909", toneLight: "#121212", edgeStroke: "#030303", stemTone: "#040404", seed: 302, detailVeins: false, alpha: 0.92 });

    drawCurvedBranch(rctx, [[w + 40, h * 0.34], [w * 0.90, h * 0.38], [w * 0.82, h * 0.43]], 20, 6, "#060606", 0.92);
    drawMonoLeaf(rctx, { cx: w * 0.88, cy: h * 0.39, length: 235, width: 148, angleRad: -2.42, toneDark: "#040404", toneMid: "#090909", toneLight: "#121212", edgeStroke: "#030303", stemTone: "#040404", seed: 303, detailVeins: false, alpha: 0.95 });
    drawMonoLeaf(rctx, { cx: w * 0.82, cy: h * 0.43, length: 195, width: 124, angleRad: -1.92, toneDark: "#040404", toneMid: "#090909", toneLight: "#121212", edgeStroke: "#030303", stemTone: "#040404", seed: 304, detailVeins: false, alpha: 0.90 });

    drawMonoFern(rctx, w * 0.04, h * 1.04, 580, 0.56, 0.22, "#050505", 1.12, 401, 0.95);
    drawMonoFern(rctx, w * 0.14, h * 1.06, 440, 0.34, 0.14, "#080808", 1.02, 402, 0.92);
    drawMonoFern(rctx, w * 0.96, h * 1.04, 590, -0.54, -0.22, "#050505", 1.12, 403, 0.95);
    drawMonoFern(rctx, w * 0.85, h * 1.06, 430, -0.32, -0.14, "#080808", 0.98, 404, 0.92);

    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.filter = "blur(8px)";
    ctx.drawImage(raw, 0, 0);
    outputs.fgFerns = c.toDataURL("image/webp", 0.90);
  }

  // =========================================================================
  // 5. HERO LEAF ALBEDO + DETAIL (1024x1400 RGBA)
  // =========================================================================
  {
    const w = 1024, h = 1400;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");

    drawMonoLeaf(ctx, {
      cx: w * 0.50,
      cy: h * 0.96,
      length: h * 0.90,
      width: w * 0.84,
      angleRad: Math.PI,
      toneDark: "#0E0E0E",
      toneMid: "#1E1E1E",
      toneLight: "#303030",
      veinMid: "#4E4E4E",
      veinBright: "#696969",
      edgeStroke: "#080808",
      stemTone: "#0B0B0B",
      seed: 103,
      hasNotch: true,
      petioleCurve: -0.05,
      alpha: 1.0,
      detailVeins: true,
    });
    applyMonoGrain(ctx, w, h, 6, true);
    outputs.leafAlbedo = c.toDataURL("image/webp", 0.94);

    const src = ctx.getImageData(0, 0, w, h);
    const det = ctx.createImageData(w, h);
    const sd = src.data;
    const dd = det.data;
    const lumAt = (px, py) => {
      const cx = Math.max(0, Math.min(w - 1, px));
      const cy = Math.max(0, Math.min(h - 1, py));
      const idx = (cy * w + cx) * 4;
      if (sd[idx + 3] < 8) return 0;
      return sd[idx] / 255;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const dx = (lumAt(x + 2, y) - lumAt(x - 2, y)) * 2.2;
        const dy = (lumAt(x, y + 2) - lumAt(x, y - 2)) * 2.2;
        const nx = Math.max(-1, Math.min(1, -dx));
        const ny = Math.max(-1, Math.min(1, dy));
        const len = Math.sqrt(nx * nx + ny * ny + 1);
        dd[idx] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
        dd[idx + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
        dd[idx + 2] = Math.round(lumAt(x, y) * 255);
        dd[idx + 3] = sd[idx + 3];
      }
    }
    ctx.putImageData(det, 0, 0);
    outputs.leafDetail = c.toDataURL("image/webp", 0.92);
  }

  return outputs;
};
</script>
</body>
</html>`;

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox"],
});

try {
  const page = await browser.newPage();
  await page.setContent(HTML_RENDERER);
  const res = await page.evaluate(() => window.renderPlates());

  const mapping = [
    ["bgCanopy", "plate-bg-canopy.webp"],
    ["midUnderstory", "plate-mid-understory.webp"],
    ["heroTree", "plate-hero-tree.webp"],
    ["fgFerns", "plate-fg-ferns.webp"],
    ["leafAlbedo", "hero-leaf-albedo.webp"],
    ["leafDetail", "hero-leaf-detail.webp"],
  ];

  for (const [key, filename] of mapping) {
    const b64 = res[key].split(",")[1];
    const buf = Buffer.from(b64, "base64");
    fs.writeFileSync(path.join(OUT_DIR, filename), buf);
    console.log(`Generated ${filename}: ${buf.length} bytes`);
  }
} finally {
  await browser.close();
}
