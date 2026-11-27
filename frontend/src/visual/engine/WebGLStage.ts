import { PerspectiveCamera, Scene, WebGLRenderer } from "three";

export interface StageDiagnostics {
  fps: number;
  frameTimeMs: number;
  drawCalls: number;
  triangles: number;
  points: number;
  lines: number;
  contextLost: boolean;
  dpr: number;
}

export type StageFrameCallback = (dt: number, elapsed: number) => void;

export class WebGLStage {
  public readonly renderer: WebGLRenderer;
  public readonly scene: Scene;
  public readonly camera: PerspectiveCamera;
  public readonly canvas: HTMLCanvasElement;

  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private rafId: number | null = null;
  private lastTimestamp = 0;
  private elapsed = 0;
  private maxDpr = 2;
  private contextLost = false;
  private onFrame: StageFrameCallback | null = null;
  private onAfterRender: StageFrameCallback | null = null;
  private onResizeCallback: ((width: number, height: number) => void) | null =
    null;

  private fpsAccumTime = 0;
  private fpsFrames = 0;
  private currentFps = 60;
  private lastFrameMs = 16.6;

  constructor(container: HTMLElement, maxDpr = 2) {
    this.container = container;
    this.maxDpr = maxDpr;

    this.scene = new Scene();
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);

    this.camera = new PerspectiveCamera(42, width / height, 0.1, 100);
    this.camera.position.set(0, 0, 5.6);

    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
      stencil: false,
      depth: true,
    });
    this.renderer.setClearColor(0x060708, 0);
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, this.maxDpr),
    );
    this.renderer.setSize(width, height, false);

    this.canvas = this.renderer.domElement;
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";
    this.canvas.setAttribute("aria-hidden", "true");
    this.container.appendChild(this.canvas);

    this.canvas.addEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.addEventListener(
      "webglcontextrestored",
      this.handleContextRestored,
    );

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(1, Math.floor(entry.contentRect.width));
        const h = Math.max(1, Math.floor(entry.contentRect.height));
        this.resize(w, h);
      }
    });
    this.resizeObserver.observe(this.container);
  }

  public setMaxDpr(maxDpr: number): void {
    this.maxDpr = maxDpr;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.resize(width, height);
  }

  public resize(width: number, height: number): void {
    const safeW = Math.max(1, width);
    const safeH = Math.max(1, height);
    this.camera.aspect = safeW / safeH;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, this.maxDpr),
    );
    this.renderer.setSize(safeW, safeH, false);
    this.onResizeCallback?.(safeW, safeH);
  }

  public setFrameCallback(cb: StageFrameCallback): void {
    this.onFrame = cb;
  }

  public setAfterRenderCallback(cb: StageFrameCallback | null): void {
    this.onAfterRender = cb;
  }

  public setResizeCallback(cb: (width: number, height: number) => void): void {
    this.onResizeCallback = cb;
  }

  public start(): void {
    if (this.rafId !== null) return;
    this.lastTimestamp = performance.now();
    this.rafId = window.requestAnimationFrame(this.tick);
  }

  public stop(): void {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  public renderOnce(): void {
    if (this.contextLost) return;
    this.onFrame?.(0, this.elapsed);
    this.renderer.render(this.scene, this.camera);
    this.onAfterRender?.(0, this.elapsed);
  }

  public getDiagnostics(): StageDiagnostics {
    const info = this.renderer.info.render;
    return {
      fps: this.currentFps,
      frameTimeMs: this.lastFrameMs,
      drawCalls: info.calls,
      triangles: info.triangles,
      points: info.points,
      lines: info.lines,
      contextLost: this.contextLost,
      dpr: this.renderer.getPixelRatio(),
    };
  }

  public dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.removeEventListener(
      "webglcontextrestored",
      this.handleContextRestored,
    );
    this.renderer.dispose();
    if (this.canvas.parentElement === this.container) {
      this.container.removeChild(this.canvas);
    }
  }

  private tick = (now: number): void => {
    this.rafId = window.requestAnimationFrame(this.tick);
    if (this.contextLost) return;

    const rawDt = (now - this.lastTimestamp) / 1000;
    this.lastTimestamp = now;
    const dt = Math.min(0.05, Math.max(0.001, rawDt));
    this.elapsed += dt;

    this.fpsAccumTime += rawDt;
    this.fpsFrames += 1;
    if (this.fpsAccumTime >= 0.5) {
      this.currentFps = Math.round(this.fpsFrames / this.fpsAccumTime);
      this.lastFrameMs = Number(
        ((this.fpsAccumTime / this.fpsFrames) * 1000).toFixed(2),
      );
      this.fpsAccumTime = 0;
      this.fpsFrames = 0;
    }

    this.onFrame?.(dt, this.elapsed);
    this.renderer.render(this.scene, this.camera);
    this.onAfterRender?.(dt, this.elapsed);
  };

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
  };

  private handleContextRestored = (): void => {
    this.contextLost = false;
  };
}
