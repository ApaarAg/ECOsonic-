import * as THREE from 'three';

export const BOTANICAL_PHOTO_PATHS = [
  '/src/assets/images/flower_marigold_orange_1795691167621.jpg',
  '/src/assets/images/flower_buttercup_gold_1795691168266.jpg',
  '/src/assets/images/flower_violet_meadow_1795691168381.jpg',
  '/src/assets/images/flower_magenta_rose_1795691168930.jpg',
  '/src/assets/images/foliage_fern_night_1795691169109.jpg',
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
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
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

/**
 * Draws a macro photograph on pure black into a 512x512 offscreen tile and extracts
 * a clean, halo-free alpha channel from its dark background + soft edge vignette.
 */
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
  scratchCtx.fillStyle = '#000000';
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
    // Soft fade near all 4 tile edges + generous fade near bottom stem boundary so stems never clip flat
    const edgeY =
      smoothstep(0.0, 0.08, ny) * (1 - smoothstep(opts.bottomFadeStart, 0.96, ny));

    for (let x = 0; x < cell; x++) {
      const nx = x / cell;
      const edgeX = smoothstep(0.0, 0.08, nx) * (1 - smoothstep(0.92, 1.0, nx));
      const idx = (y * cell + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      // Peak channel preserves deep saturated petals & dark forest-green fern fronds
      const maxC = r > g ? (r > b ? r : b) : g > b ? g : b;
      const keyAlpha = smoothstep(opts.lowThreshold, opts.highThreshold, maxC);
      const mask = keyAlpha * edgeX * edgeY;

      if (mask <= 0.01) {
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 0;
      } else {
        // Gentle edge un-premultiplication so semi-transparent fringes never darken petals
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

/**
 * Draws luminous dew-glow bokeh florets into tile (3, 1) for subtle nocturnal sparkle.
 */
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
    glow.addColorStop(0, 'rgba(255, 252, 240, 0.96)');
    glow.addColorStop(0.35, 'rgba(255, 244, 214, 0.55)');
    glow.addColorStop(1, 'rgba(255, 240, 210, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx + ox, cy + oy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Loads the 5 high-resolution macro flower & fern photographs and builds a 2048x1024 (4x2)
 * alpha-keyed photographic botanical atlas texture.
 */
export async function loadPhotographicBotanicalAtlas(): Promise<THREE.CanvasTexture> {
  const images = await Promise.all(BOTANICAL_PHOTO_PATHS.map((src) => loadImage(src)));
  const [orangeImg, goldImg, violetImg, magentaImg, fernImg] = images;

  const cell = 512;
  const cols = 4;
  const rows = 2;
  const canvas = document.createElement('canvas');
  canvas.width = cell * cols;
  canvas.height = cell * rows;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const scratch = document.createElement('canvas');
  scratch.width = cell;
  scratch.height = cell;
  const scratchCtx = scratch.getContext('2d', { willReadFrequently: true })!;

  // Row 0: 4 distinct high-resolution flower species clusters
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
    bottomFadeStart: 0.80,
  });
  renderPhotoTile(ctx, scratch, scratchCtx, magentaImg, 3, 0, cell, {
    zoom: 1.04,
    lowThreshold: 10,
    highThreshold: 32,
    bottomFadeStart: 0.82,
  });

  // Row 1: 3 varied woodland fern foliage clusters + 1 luminous bokeh floret spray
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

/**
 * Lightweight synchronous placeholder atlas used briefly before photographic images finish decoding.
 */
export function createFallbackBotanicalAtlasTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Soft glowing circular mote texture for nocturnal dust & pollen particles.
 */
export function createDustTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255, 248, 232, 1)');
  grad.addColorStop(0.25, 'rgba(245, 239, 226, 0.65)');
  grad.addColorStop(0.65, 'rgba(196, 212, 230, 0.16)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Volumetric moonlit mist shaft / light-ray sprite texture.
 */
export function createLightRayTexture(): THREE.CanvasTexture {
  const width = 256;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const vGrad = ctx.createLinearGradient(0, 0, 0, height);
  vGrad.addColorStop(0, 'rgba(186, 206, 234, 0)');
  vGrad.addColorStop(0.25, 'rgba(196, 214, 240, 0.15)');
  vGrad.addColorStop(0.65, 'rgba(226, 232, 238, 0.06)');
  vGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = vGrad;
  ctx.fillRect(0, 0, width, height);

  ctx.globalCompositeOperation = 'destination-in';
  const hGrad = ctx.createRadialGradient(width / 2, height * 0.45, 4, width / 2, height * 0.45, width * 0.5);
  hGrad.addColorStop(0, 'rgba(255,255,255,1)');
  hGrad.addColorStop(0.55, 'rgba(255,255,255,0.45)');
  hGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hGrad;
  ctx.fillRect(0, 0, width, height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
