import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import {
  applyTouchDelta,
  applyWheelDelta,
  createInitialScrollerState,
  createSeededRandom,
  damp,
  fbm2D,
  generateValleyPathPoints,
  getTerrainHeight,
  getValleyCenterX,
  stepScroller,
} from './valleyMath';
import {
  createDustTexture,
  createFallbackBotanicalAtlasTexture,
  createLightRayTexture,
  loadPhotographicBotanicalAtlas,
} from './textures';
import {
  BOTANICAL_FRAGMENT_SHADER,
  BOTANICAL_VERTEX_SHADER,
  DUST_FRAGMENT_SHADER,
  DUST_VERTEX_SHADER,
  VALLEY_COMPOSITE_SHADER,
} from './shaders';
import { ValleyAudioStore } from './audio';

export interface ValleyTelemetry {
  progress: number;
  hoverAmount: number;
  speed: number;
}

export class ValleyEngine {
  private container: HTMLElement;
  private mountTarget: HTMLElement;
  private onLoaded: () => void;
  private onIntroDone: () => void;
  private onTelemetry?: (telemetry: ValleyTelemetry) => void;
  private audioStore: ValleyAudioStore;

  private isSoftwareGl: boolean;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private compositePass: ShaderPass | null = null;

  private botanicalMaterial!: THREE.ShaderMaterial;
  private dustMaterial!: THREE.ShaderMaterial;
  private raySprites: Array<{ sprite: THREE.Sprite; baseX: number; baseY: number; phase: number }> = [];
  private pathCurve!: THREE.CatmullRomCurve3;

  private scroller = createInitialScrollerState();
  private mouseTarget = new THREE.Vector2(0.56, -0.44);
  private mouseCurrent = new THREE.Vector2(0.56, -0.44);
  private introProgress = 0;
  private introReported = false;
  private isDisposed = false;
  private frameId = 0;
  private introTimerId = 0;
  private startTime = performance.now();
  private lastTime = performance.now();
  private elapsed = 0;
  private lastTouchY: number | null = null;
  private reducedMotion = false;
  private autostart = false;

  // Reusable scratch vectors (zero GC in animation loop)
  private readonly _camPos = new THREE.Vector3();
  private readonly _lookTarget = new THREE.Vector3();
  private readonly _tangent = new THREE.Vector3();
  private readonly _up = new THREE.Vector3(0, 1, 0);
  private readonly _right = new THREE.Vector3();

  private disposables: Array<{ dispose: () => void }> = [];

  private fallbackAtlas: THREE.CanvasTexture | null = null;
  private loadedSignaled = false;
  private loadSafetyTimerId = 0;

  constructor(
    container: HTMLElement,
    onLoaded: () => void,
    onIntroDone: () => void,
    audioStore: ValleyAudioStore,
    onTelemetry?: (telemetry: ValleyTelemetry) => void,
  ) {
    this.container = container;
    this.mountTarget = (container.querySelector('.js-canvas-container') as HTMLElement) || container;
    this.onLoaded = onLoaded;
    this.onIntroDone = onIntroDone;
    this.audioStore = audioStore;
    this.onTelemetry = onTelemetry;

    const params = new URLSearchParams(window.location.search);
    this.autostart = params.get('autostart') === '1';
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.isSoftwareGl = this.detectSoftwareGl();

    this.initScene();
    this.bindEvents();

    const finishLoading = () => {
      if (this.isDisposed || this.loadedSignaled) return;
      this.loadedSignaled = true;
      clearTimeout(this.loadSafetyTimerId);
      this.startTime = performance.now();
      this.renderFrame(0.016);
      this.onLoaded();

      if (this.autostart || this.reducedMotion) {
        this.introProgress = 1;
        this.introReported = true;
        this.onIntroDone();
      } else {
        this.introTimerId = window.setTimeout(() => {
          if (!this.isDisposed && !this.introReported) {
            this.introReported = true;
            this.onIntroDone();
          }
        }, 400);
      }
    };

    this.loadSafetyTimerId = window.setTimeout(finishLoading, 2500);

    loadPhotographicBotanicalAtlas()
      .then((photoAtlas) => {
        if (this.isDisposed) {
          photoAtlas.dispose();
          return;
        }
        this.botanicalMaterial.uniforms.uAtlas.value = photoAtlas;
        this.disposables.push(photoAtlas);
        if (this.fallbackAtlas) {
          this.fallbackAtlas.dispose();
          this.fallbackAtlas = null;
        }
        finishLoading();
      })
      .catch(() => {
        finishLoading();
      });

    this.lastTime = performance.now();
    this.scheduleNextFrame();
  }

  private detectSoftwareGl(): boolean {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param) || '');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    } catch {
      return false;
    }
  }

  private initScene(): void {
    const width = Math.max(this.mountTarget.clientWidth || window.innerWidth, 1);
    const height = Math.max(this.mountTarget.clientHeight || window.innerHeight, 1);
    const pixelRatio = this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      alpha: false,
      preserveDrawingBuffer: this.isSoftwareGl,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(0x020307, 1);

    this.mountTarget.innerHTML = '';
    this.mountTarget.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const fogColor = new THREE.Color(0x020307);
    this.scene.background = fogColor;
    this.scene.fog = new THREE.FogExp2(fogColor.getHex(), 0.0165);

    this.camera = new THREE.PerspectiveCamera(52, width / height, 0.25, 220);

    // Studio environment map for dark terrain sheen
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmrem.fromScene(roomEnv, 0.04);
    this.scene.environment = envTarget.texture;
    this.disposables.push(envTarget);
    roomEnv.dispose();
    pmrem.dispose();

    // Subtle nocturnal lighting rig so valley terrain stays deep obsidian-night
    const hemiLight = new THREE.HemisphereLight(0x283552, 0x020307, 0.22);
    this.scene.add(hemiLight);

    const moonLight = new THREE.DirectionalLight(0x7c93c4, 0.28);
    moonLight.position.set(18, 36, -24);
    this.scene.add(moonLight);

    const warmRimLight = new THREE.DirectionalLight(0xd9b88a, 0.12);
    warmRimLight.position.set(-22, 12, 28);
    this.scene.add(warmRimLight);

    // Camera flight spline
    const waypoints = generateValleyPathPoints(40, 220).map(
      (p) => new THREE.Vector3(p.x, p.y, p.z),
    );
    this.pathCurve = new THREE.CatmullRomCurve3(waypoints, true, 'catmullrom', 0.5);

    this.buildTerrain();
    this.buildBotanicalField(pixelRatio, width / height, fogColor);
    this.buildDustField(pixelRatio, width / height);
    this.buildLightRays();

    if (!this.isSoftwareGl) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.setPixelRatio(pixelRatio);
      this.composer.setSize(width, height);

      const renderPass = new RenderPass(this.scene, this.camera);
      this.composer.addPass(renderPass);

      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        0.58,
        0.48,
        0.62,
      );
      this.composer.addPass(this.bloomPass);

      this.compositePass = new ShaderPass(VALLEY_COMPOSITE_SHADER);
      this.composer.addPass(this.compositePass);
    }

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }
  }

  private buildTerrain(): void {
    const geom = new THREE.PlaneGeometry(280, 280, 96, 96);
    geom.rotateX(-Math.PI / 2);

    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, getTerrainHeight(x, z));
    }
    geom.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({
      color: 0x010204,
    });

    const terrain = new THREE.Mesh(geom, mat);
    this.scene.add(terrain);
    this.disposables.push(geom, mat);
  }

  private buildBotanicalField(pixelRatio: number, aspect: number, fogColor: THREE.Color): void {
    const rand = createSeededRandom(198742);
    const atlas = createFallbackBotanicalAtlasTexture();
    this.fallbackAtlas = atlas;
    this.disposables.push(atlas);

    const count = 34000;
    const positions = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const species = new Float32Array(count);
    const kinds = new Float32Array(count);
    const seeds = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const disperseDirs = new Float32Array(count * 3);

    // Subtle natural multipliers so true photographic flower & fern colors shine without flat tinting
    const glowTintOrange = new THREE.Color('#ff7a24');
    const glowTintGold = new THREE.Color('#ffe138');
    const glowTintViolet = new THREE.Color('#b69cff');
    const glowTintMagenta = new THREE.Color('#f24a98');

    for (let i = 0; i < count; i++) {
      // Dense coverage across valley floor and steep amphitheater flanks
      const z = (rand() - 0.5) * 220;
      const centerX = getValleyCenterX(z);
      const lateralSpread = (rand() - 0.5) * 124;
      const biasedX =
        centerX + Math.sign(lateralSpread) * Math.pow(Math.abs(lateralSpread) / 62, 1.15) * 62;

      const groundY = getTerrainHeight(biasedX, z);

      // FBM patch clustering with contrast stretch so all 4 floral drifts appear across every vista
      const patch = fbm2D(biasedX * 0.085, z * 0.085);
      const rawSpecies = fbm2D(biasedX * 0.095 + 21.4, z * 0.095 - 14.2);
      const speciesPatch = Math.min(1, Math.max(0, (rawSpecies - 0.30) / 0.40));

      // ~62% dense dark forest fern canopy, ~38% clustered wildflowers
      const isFlowerZone = patch > 0.425;
      const isLeaf = !isFlowerZone || rand() > 0.54;
      const stemLift = isLeaf ? 0.25 + rand() * 1.05 : 0.75 + rand() * 1.65;

      positions[i * 3] = biasedX;
      positions[i * 3 + 1] = groundY + stemLift;
      positions[i * 3 + 2] = z;

      kinds[i] = isLeaf ? 1.0 : 0.0;

      if (isLeaf) {
        species[i] = 4 + Math.floor(rand() * 3); // tiles 4, 5, 6 (photographic fern clusters)
        scales[i] = 1.55 + rand() * 1.35;
        const brightness = 0.72 + rand() * 0.48;
        colors[i * 3] = 0.88 * brightness;
        colors[i * 3 + 1] = 1.04 * brightness;
        colors[i * 3 + 2] = 0.88 * brightness;
      } else {
        // Map each floral drift directly to its dedicated high-resolution flower photograph tile:
        // Tile 0: Orange wild poppies & cosmos
        // Tile 1: Golden buttercups & daisies
        // Tile 2: Violet cosmos & meadow anemones
        // Tile 3: Magenta wild roses
        let tile = 0;
        let glowTint = glowTintOrange;
        if (speciesPatch < 0.27) {
          tile = 0;
          glowTint = glowTintOrange;
        } else if (speciesPatch < 0.54) {
          tile = 1;
          glowTint = glowTintGold;
        } else if (speciesPatch < 0.78) {
          tile = 2;
          glowTint = glowTintViolet;
        } else {
          tile = 3;
          glowTint = glowTintMagenta;
        }

        // Occasional pinpoint glowing dew florets (8%) to add delicate nocturnal bokeh sparkle
        const isGlowFloret = rand() > 0.92;
        if (isGlowFloret) {
          tile = 7;
          const brightness = 0.95 + rand() * 0.35;
          colors[i * 3] = glowTint.r * brightness;
          colors[i * 3 + 1] = glowTint.g * brightness;
          colors[i * 3 + 2] = glowTint.b * brightness;
        } else {
          const brightness = 0.88 + rand() * 0.30;
          colors[i * 3] = (0.96 + rand() * 0.08) * brightness;
          colors[i * 3 + 1] = (0.95 + rand() * 0.08) * brightness;
          colors[i * 3 + 2] = (0.94 + rand() * 0.08) * brightness;
        }

        species[i] = tile;
        scales[i] = isGlowFloret ? 0.75 + rand() * 0.7 : 1.05 + rand() * 1.15;
      }

      seeds[i] = rand();

      // Outward/upward radial dispersion direction on hover
      const theta = rand() * Math.PI * 2;
      const phi = rand() * Math.PI * 0.6;
      disperseDirs[i * 3] = Math.cos(theta) * Math.sin(phi);
      disperseDirs[i * 3 + 1] = Math.cos(phi) * 0.85 + 0.35;
      disperseDirs[i * 3 + 2] = Math.sin(theta) * Math.sin(phi);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
    geometry.setAttribute('aSpecies', new THREE.BufferAttribute(species, 1));
    geometry.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aDisperseDir', new THREE.BufferAttribute(disperseDirs, 3));

    this.botanicalMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: pixelRatio },
        uBaseSize: { value: 780 },
        uMouseNdc: { value: new THREE.Vector2(0.44, -0.42) },
        uAspect: { value: aspect },
        uHoverDisperse: { value: 0 },
        uAtlas: { value: atlas },
        uFogColor: { value: fogColor },
        uFogDensity: { value: 0.0155 },
      },
      vertexShader: BOTANICAL_VERTEX_SHADER,
      fragmentShader: BOTANICAL_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    const points = new THREE.Points(geometry, this.botanicalMaterial);
    points.frustumCulled = false;
    this.scene.add(points);
    this.disposables.push(geometry, this.botanicalMaterial);
  }

  private buildDustField(pixelRatio: number, aspect: number): void {
    const rand = createSeededRandom(77312);
    const dustMap = createDustTexture();
    this.disposables.push(dustMap);

    const count = 1100;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const seeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const z = (rand() - 0.5) * 230;
      const x = getValleyCenterX(z) + (rand() - 0.5) * 90;
      const groundY = getTerrainHeight(x, z);
      positions[i * 3] = x;
      positions[i * 3 + 1] = groundY + 0.8 + rand() * 14;
      positions[i * 3 + 2] = z;
      sizes[i] = 42 + rand() * 75;
      seeds[i] = rand();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    this.dustMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: pixelRatio },
        uMouseNdc: { value: new THREE.Vector2(0, 0) },
        uAspect: { value: aspect },
        uHoverDisperse: { value: 0 },
        uDustMap: { value: dustMap },
      },
      vertexShader: DUST_VERTEX_SHADER,
      fragmentShader: DUST_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const dust = new THREE.Points(geometry, this.dustMaterial);
    dust.frustumCulled = false;
    this.scene.add(dust);
    this.disposables.push(geometry, this.dustMaterial);
  }

  private buildLightRays(): void {
    const rayTex = createLightRayTexture();
    this.disposables.push(rayTex);
    const rand = createSeededRandom(31199);

    for (let i = 0; i < 14; i++) {
      const mat = new THREE.SpriteMaterial({
        map: rayTex,
        color: i % 2 === 0 ? 0xaec4ea : 0xe9dec8,
        transparent: true,
        opacity: 0.12 + rand() * 0.08,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(mat);
      const t = i / 14;
      const pt = this.pathCurve.getPointAt(t);
      const offsetX = (rand() - 0.5) * 32;
      const baseY = pt.y + 8 + rand() * 6;
      sprite.position.set(pt.x + offsetX, baseY, pt.z);
      sprite.scale.set(16 + rand() * 14, 34 + rand() * 16, 1);
      this.scene.add(sprite);
      this.raySprites.push({ sprite, baseX: pt.x + offsetX, baseY, phase: rand() * Math.PI * 2 });
      this.disposables.push(mat);
    }
  }

  private handleWheel = (e: WheelEvent): void => {
    applyWheelDelta(this.scroller, e.deltaY);
  };

  private handleTouchStart = (e: TouchEvent): void => {
    if (e.touches.length > 0) {
      this.lastTouchY = e.touches[0].clientY;
    }
  };

  private handleTouchMove = (e: TouchEvent): void => {
    if (e.touches.length > 0 && this.lastTouchY !== null) {
      const currentY = e.touches[0].clientY;
      const deltaY = this.lastTouchY - currentY;
      this.lastTouchY = currentY;
      applyTouchDelta(this.scroller, deltaY);
    }
  };

  private handleTouchEnd = (): void => {
    this.lastTouchY = null;
  };

  private handlePointerMove = (e: PointerEvent): void => {
    const nx = (e.clientX / Math.max(window.innerWidth, 1)) * 2 - 1;
    const ny = -(e.clientY / Math.max(window.innerHeight, 1)) * 2 + 1;
    this.mouseTarget.set(nx, ny);
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'w' || e.key === 'W') {
      applyWheelDelta(this.scroller, 120);
    } else if (e.key === 'ArrowUp' || e.key === 's' || e.key === 'S') {
      applyWheelDelta(this.scroller, -120);
    }
  };

  private handleResize = (): void => {
    if (this.isDisposed) return;
    const width = Math.max(this.mountTarget.clientWidth || window.innerWidth, 1);
    const height = Math.max(this.mountTarget.clientHeight || window.innerHeight, 1);
    const pixelRatio = this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    const aspect = width / height;

    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);

    if (this.composer) {
      this.composer.setPixelRatio(pixelRatio);
      this.composer.setSize(width, height);
    }
    if (this.bloomPass) {
      this.bloomPass.resolution.set(width, height);
    }

    this.botanicalMaterial.uniforms.uPixelRatio.value = pixelRatio;
    this.botanicalMaterial.uniforms.uAspect.value = aspect;
    this.dustMaterial.uniforms.uPixelRatio.value = pixelRatio;
    this.dustMaterial.uniforms.uAspect.value = aspect;

    this.renderFrame(0.001);
  };

  private handleContextLost = (e: Event): void => {
    e.preventDefault();
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
  };

  private handleContextRestored = (): void => {
    this.lastTime = performance.now();
    this.scheduleNextFrame();
  };

  private bindEvents(): void {
    window.addEventListener('wheel', this.handleWheel, { passive: true });
    window.addEventListener('touchstart', this.handleTouchStart, { passive: true });
    window.addEventListener('touchmove', this.handleTouchMove, { passive: true });
    window.addEventListener('touchend', this.handleTouchEnd, { passive: true });
    window.addEventListener('pointermove', this.handlePointerMove, { passive: true });
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('resize', this.handleResize);
    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.handleContextRestored);
  }

  public startHoverTransition(): void {
    this.scroller.hoverTarget = 1;
    this.audioStore.setHoverMuffle(true);
  }

  public stopHoverTransition(): void {
    this.scroller.hoverTarget = 0;
    this.audioStore.setHoverMuffle(false);
  }

  private renderFrame(dt: number): void {
    if (this.isDisposed) return;

    this.elapsed += this.reducedMotion ? dt * 0.15 : dt;

    // Intro emergence driven by real wall-clock time so Software WebGL reveals promptly
    const wallElapsed = (performance.now() - this.startTime) / 1000;
    this.introProgress = Math.min(1, wallElapsed / 0.85);
    if (!this.introReported && wallElapsed >= 0.35) {
      this.introReported = true;
      this.onIntroDone();
    }

    const step = stepScroller(this.scroller, this.reducedMotion ? dt * 0.2 : dt);
    this.mouseCurrent.x = damp(this.mouseCurrent.x, this.mouseTarget.x, 5.5, dt);
    this.mouseCurrent.y = damp(this.mouseCurrent.y, this.mouseTarget.y, 5.5, dt);

    // Sample camera path spline & pitch downward into the crescent valley bowl
    this.pathCurve.getPointAt(step.progress, this._camPos);
    const lookT = (step.progress + 0.036) % 1;
    this.pathCurve.getPointAt(lookT, this._lookTarget);
    this._lookTarget.y -= 2.9;
    this.pathCurve.getTangentAt(step.progress, this._tangent);

    // Intro vertical descent
    const introLift = (1 - Math.pow(this.introProgress, 2)) * 3.8;
    this._camPos.y += introLift;

    // Subtle camera tilt toward cursor position
    this._right.crossVectors(this._tangent, this._up).normalize();
    this._camPos.addScaledVector(this._right, this.mouseCurrent.x * 1.35);
    this._camPos.y += this.mouseCurrent.y * 0.72;

    this._lookTarget.addScaledVector(this._right, this.mouseCurrent.x * 3.4);
    this._lookTarget.y += this.mouseCurrent.y * 1.85;

    this.camera.position.copy(this._camPos);
    this.camera.lookAt(this._lookTarget);
    // Subtle Dutch roll tilt toward cursor X
    this.camera.rotateZ(-this.mouseCurrent.x * 0.032);

    // Update shaders
    this.botanicalMaterial.uniforms.uTime.value = this.elapsed;
    this.botanicalMaterial.uniforms.uMouseNdc.value.copy(this.mouseCurrent);
    this.botanicalMaterial.uniforms.uHoverDisperse.value = step.hoverAmount;

    this.dustMaterial.uniforms.uTime.value = this.elapsed;
    this.dustMaterial.uniforms.uMouseNdc.value.copy(this.mouseCurrent);
    this.dustMaterial.uniforms.uHoverDisperse.value = step.hoverAmount;

    // Gently breathe light ray sprites
    for (const ray of this.raySprites) {
      ray.sprite.position.x = ray.baseX + Math.sin(this.elapsed * 0.22 + ray.phase) * 1.4;
      ray.sprite.position.y = ray.baseY + Math.cos(this.elapsed * 0.18 + ray.phase) * 0.6;
    }

    if (this.compositePass) {
      this.compositePass.uniforms.uTime.value = this.elapsed;
      this.compositePass.uniforms.uVignetteTightness.value = step.vignetteTightness;
    }

    if (this.isSoftwareGl || !this.composer) {
      this.renderer.render(this.scene, this.camera);
    } else {
      this.composer.render();
    }

    if (this.onTelemetry) {
      this.onTelemetry({
        progress: step.progress,
        hoverAmount: step.hoverAmount,
        speed: step.speed,
      });
    }
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.isDisposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } else {
      this.frameId = window.setTimeout(cb, 80);
    }
  }

  private tick = (): void => {
    if (this.isDisposed) return;
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.08);
    this.lastTime = now;

    this.renderFrame(dt);
    this.scheduleNextFrame();
  };

  private scheduleNextFrame(): void {
    if (this.isDisposed) return;
    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  }

  public destroy(): void {
    this.isDisposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    clearTimeout(this.introTimerId);
    clearTimeout(this.loadSafetyTimerId);

    window.removeEventListener('wheel', this.handleWheel);
    window.removeEventListener('touchstart', this.handleTouchStart);
    window.removeEventListener('touchmove', this.handleTouchMove);
    window.removeEventListener('touchend', this.handleTouchEnd);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('resize', this.handleResize);

    if (this.renderer?.domElement) {
      this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
      this.renderer.domElement.removeEventListener('webglcontextrestored', this.handleContextRestored);
    }

    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];

    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.mountTarget) {
      this.mountTarget.removeChild(this.renderer.domElement);
    }
  }
}
