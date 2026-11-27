import * as THREE from "three";
import marigoldOrangeUrl from "../../../ECOsonic-main/src/assets/images/flower_marigold_orange_1795691167621.jpg";
import buttercupGoldUrl from "../../../ECOsonic-main/src/assets/images/flower_buttercup_gold_1795691168266.jpg";
import violetMeadowUrl from "../../../ECOsonic-main/src/assets/images/flower_violet_meadow_1795691168381.jpg";
import magentaRoseUrl from "../../../ECOsonic-main/src/assets/images/flower_magenta_rose_1795691168930.jpg";
import fernNightUrl from "../../../ECOsonic-main/src/assets/images/foliage_fern_night_1795691169109.jpg";

export const VALLEY_BOTANICAL_URLS = [
  marigoldOrangeUrl,
  buttercupGoldUrl,
  violetMeadowUrl,
  magentaRoseUrl,
  fernNightUrl,
] as const;

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load botanical image: ${src}`));
    img.src = src;
  });
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(edge1 - edge0, 0.0001)));
  return t * t * (3 - 2 * t);
}

interface TileTransform {
  flipX?: boolean;
  rotation?: number;
  zoom?: number;
  offsetY?: number;
  lowThreshold: number;
  highThreshold: number;
  bottomFadeStart: number;
}

function renderPhotoTile(
  targetCtx: CanvasRenderingContext2D,
  scratchCanvas: HTMLCanvasElement,
  scratchCtx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  col: number,
  row: number,
  cell: number,
  opts: TileTransform,
): void {
  scratchCtx.clearRect(0, 0, cell, cell);
  scratchCtx.save();
  scratchCtx.fillStyle = "#000000";
  scratchCtx.fillRect(0, 0, cell, cell);

  scratchCtx.translate(cell * 0.5, cell * 0.5 + (opts.offsetY ?? 0) * cell);
  if (opts.rotation) {
    scratchCtx.rotate(opts.rotation);
  }
  const zoom = opts.zoom ?? 1;
  scratchCtx.scale(opts.flipX ? -zoom : zoom, zoom);
  scratchCtx.drawImage(img, -cell * 0.5, -cell * 0.5, cell, cell);
  scratchCtx.restore();

  const imgData = scratchCtx.getImageData(0, 0, cell, cell);
  const data = imgData.data;

  for (let y = 0; y < cell; y++) {
    const ny = y / cell;
    const edgeY =
      smoothstep(0.0, 0.08, ny) * (1 - smoothstep(opts.bottomFadeStart, 0.96, ny));

    for (let x = 0; x < cell; x++) {
      const nx = x / cell;
      const edgeX = smoothstep(0.0, 0.08, nx) * (1 - smoothstep(0.92, 1.0, nx));
      const idx = (y * cell + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      const maxC = r > g ? (r > b ? r : b) : g > b ? g : b;
      const keyAlpha = smoothstep(opts.lowThreshold, opts.highThreshold, maxC);
      const mask = keyAlpha * edgeX * edgeY;

      if (mask <= 0.01) {
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 0;
      } else {
        const boost = mask < 0.85 ? 1 / Math.max(mask, 0.35) : 1;
        data[idx] = Math.min(255, Math.round(r * boost));
        data[idx + 1] = Math.min(255, Math.round(g * boost));
        data[idx + 2] = Math.min(255, Math.round(b * boost));
        data[idx + 3] = Math.round(mask * 255);
      }
    }
  }

  scratchCtx.putImageData(imgData, 0, 0);
  targetCtx.drawImage(scratchCanvas, col * cell, row * cell);
}

function drawGlowFloretTile(ctx: CanvasRenderingContext2D, col: number, row: number, cell: number): void {
  const cx = col * cell + cell * 0.5;
  const cy = row * cell + cell * 0.5;
  const rand = seeded(8821);

  ctx.save();
  ctx.beginPath();
  ctx.rect(col * cell, row * cell, cell, cell);
  ctx.clip();

  for (let i = 0; i < 6; i++) {
    const ox = (rand() - 0.5) * 185;
    const oy = (rand() - 0.5) * 185;
    const r = 34 + rand() * 34;
    const glow = ctx.createRadialGradient(cx + ox, cy + oy, 2, cx + ox, cy + oy, r);
    glow.addColorStop(0, "rgba(255, 252, 240, 0.96)");
    glow.addColorStop(0.35, "rgba(255, 244, 214, 0.55)");
    glow.addColorStop(1, "rgba(255, 240, 210, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx + ox, cy + oy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export async function loadValleyBotanicalAtlas(): Promise<THREE.CanvasTexture> {
  const images = await Promise.all(VALLEY_BOTANICAL_URLS.map((src) => loadImage(src)));
  const [orangeImg, goldImg, violetImg, magentaImg, fernImg] = images;

  const cell = 512;
  const cols = 4;
  const rows = 2;
  const canvas = document.createElement("canvas");
  canvas.width = cell * cols;
  canvas.height = cell * rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return createFallbackValleyAtlasTexture();
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const scratch = document.createElement("canvas");
  scratch.width = cell;
  scratch.height = cell;
  const scratchCtx = scratch.getContext("2d", { willReadFrequently: true });
  if (!scratchCtx) {
    return createFallbackValleyAtlasTexture();
  }

  renderPhotoTile(ctx, scratch, scratchCtx, orangeImg, 0, 0, cell, {
    zoom: 0.98,
    offsetY: -0.02,
    lowThreshold: 12,
    highThreshold: 34,
    bottomFadeStart: 0.64,
  });
  renderPhotoTile(ctx, scratch, scratchCtx, goldImg, 1, 0, cell, {
    zoom: 0.96,
    offsetY: -0.02,
    lowThreshold: 12,
    highThreshold: 34,
    bottomFadeStart: 0.64,
  });
  renderPhotoTile(ctx, scratch, scratchCtx, violetImg, 2, 0, cell, {
    zoom: 1.04,
    lowThreshold: 11,
    highThreshold: 32,
    bottomFadeStart: 0.8,
  });
  renderPhotoTile(ctx, scratch, scratchCtx, magentaImg, 3, 0, cell, {
    zoom: 1.04,
    lowThreshold: 10,
    highThreshold: 32,
    bottomFadeStart: 0.82,
  });

  renderPhotoTile(ctx, scratch, scratchCtx, fernImg, 0, 1, cell, {
    zoom: 1.08,
    lowThreshold: 7,
    highThreshold: 22,
    bottomFadeStart: 0.92,
  });
  renderPhotoTile(ctx, scratch, scratchCtx, fernImg, 1, 1, cell, {
    flipX: true,
    rotation: 0.28,
    zoom: 1.14,
    lowThreshold: 7,
    highThreshold: 22,
    bottomFadeStart: 0.92,
  });
  renderPhotoTile(ctx, scratch, scratchCtx, fernImg, 2, 1, cell, {
    rotation: -0.45,
    zoom: 1.16,
    lowThreshold: 7,
    highThreshold: 22,
    bottomFadeStart: 0.92,
  });
  drawGlowFloretTile(ctx, 3, 1, cell);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function createFallbackValleyAtlasTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx?.clearRect(0, 0, 256, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createValleyDustTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const c = size / 2;
    const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0.0, "rgba(255, 250, 240, 1.0)");
    grad.addColorStop(0.2, "rgba(255, 244, 214, 0.72)");
    grad.addColorStop(0.5, "rgba(220, 230, 255, 0.22)");
    grad.addColorStop(1.0, "rgba(200, 215, 255, 0.0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createValleyLightRayTexture(): THREE.CanvasTexture {
  const w = 128;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0, "rgba(180, 200, 235, 0.0)");
    grad.addColorStop(0.25, "rgba(205, 218, 242, 0.14)");
    grad.addColorStop(0.55, "rgba(232, 224, 202, 0.09)");
    grad.addColorStop(1.0, "rgba(180, 195, 225, 0.0)");
    ctx.fillStyle = grad;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(w * 0.36, 0);
    ctx.lineTo(w * 0.64, 0);
    ctx.lineTo(w * 0.96, h);
    ctx.lineTo(w * 0.04, h);
    ctx.closePath();
    ctx.clip();
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
