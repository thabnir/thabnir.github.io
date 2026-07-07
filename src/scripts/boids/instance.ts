// Orchestrator for a single boids canvas: owns the simulation, the chosen
// render backend, the (lazy) debug overlay, the animation loop, input
// handling and the live control panel.
//
// The public surface that the pages depend on is preserved exactly:
//   * one instance per `.boids-container`, keyed by element id in
//     `window.boidsInstances`;
//   * `instance.setParams(partial)` for the scroll/zoom/param automation.

import type { BoidsConfig, Camera, SimStepContext } from "./types";
import { BoidSim } from "./sim";
import { WebGLBoidRenderer } from "./webgl-renderer";
import { Canvas2DBoidRenderer } from "./canvas2d-renderer";
import { DebugOverlay } from "./debug-overlay";
import type { BoidRenderer } from "./types";

class PerformanceTracker {
  private frameTimes: number[] = [];
  private lastFrameTime = 0;
  private maxSamples = 60;

  update(): void {
    const now = performance.now();
    if (this.lastFrameTime > 0) {
      this.frameTimes.push(now - this.lastFrameTime);
      if (this.frameTimes.length > this.maxSamples) this.frameTimes.shift();
    }
    this.lastFrameTime = now;
  }

  private avg(): number {
    if (this.frameTimes.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.frameTimes.length; i++) sum += this.frameTimes[i];
    return sum / this.frameTimes.length;
  }

  getFPS(): number {
    const a = this.avg();
    return a === 0 ? 0 : 1000 / a;
  }

  getFrameTime(): number {
    return this.avg();
  }
}

function webgl2Supported(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

function forceCanvas2D(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("boids") === "canvas2d";
  } catch {
    return false;
  }
}

function get2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  return ctx;
}

export class BoidsInstance {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  params: BoidsConfig;
  sim!: BoidSim;
  renderer!: BoidRenderer;
  backend: "webgl2" | "canvas2d" = "canvas2d";

  private perfTracker = new PerformanceTracker();
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlay: DebugOverlay | null = null;
  private overlayNeedsClear = false;

  width = 200;
  height = 200;
  lastRenderTime = 0;
  isPaused = false;
  mouseX = 0;
  mouseY = 0;
  cameraX = 0;
  cameraY = 0;
  currentZoom = 1.0;
  targetZoom = 1.0;
  animationId: number | null = null;
  isVisible = true;
  isMobile = false;
  isCursorActive = false;

  constructor(container: HTMLElement) {
    this.container = container;
    const configStr = container.dataset.boidsConfig;
    this.params = configStr ? JSON.parse(configStr) : ({} as BoidsConfig);

    this.canvas = container.querySelector("canvas")!;
    this.currentZoom = this.params.zoomLevel;
    this.targetZoom = this.params.zoomLevel;

    // Mobile detection and config adjustment (ported verbatim).
    this.isMobile = window.innerWidth < 768;
    if (this.isMobile) {
      if (this.params.nBoidsMobile) {
        this.params.nBoids = this.params.nBoidsMobile;
      } else if (this.params.nBoids > 100) {
        const reduced = Math.min(150, Math.floor(this.params.nBoids * 0.35));
        this.params.nBoids = Math.max(50, reduced);
      }
      if (this.params.cursorMagnetismRange > 150) {
        this.params.cursorMagnetismRange = 150;
      }
    }

    this.init();
  }

  private init(): void {
    this.sim = new BoidSim(this.params);
    this.chooseBackend();
    this.sizeCanvas();
    this.sim.init(this.width, this.height);
    this.renderer.syncBuffers();
    this.setupEventListeners();
    if (this.params.showControls) this.setupControls();
    this.startAnimation();
  }

  private chooseBackend(): void {
    if (!forceCanvas2D() && webgl2Supported()) {
      try {
        this.renderer = new WebGLBoidRenderer(this.canvas, this.sim, this.params);
        this.backend = "webgl2";
        return;
      } catch (e) {
        console.warn("[boids] WebGL2 init failed; falling back to Canvas2D", e);
        // A canvas that has handed out a webgl2 context can't also give a 2d
        // one, so swap in a fresh element before falling back.
        this.canvas = this.replaceCanvas(this.canvas);
      }
    }
    this.renderer = new Canvas2DBoidRenderer(get2dContext(this.canvas), this.sim, this.params);
    this.backend = "canvas2d";
  }

  private replaceCanvas(old: HTMLCanvasElement): HTMLCanvasElement {
    const fresh = old.cloneNode(false) as HTMLCanvasElement;
    old.replaceWith(fresh);
    return fresh;
  }

  sizeCanvas(): void {
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.renderer.resize(this.width, this.height);
    if (this.overlayCanvas && this.overlay) {
      this.overlayCanvas.width = this.width;
      this.overlayCanvas.height = this.height;
      this.overlay.resize(this.width, this.height);
    }
  }

  private setupEventListeners(): void {
    window.addEventListener("resize", () => this.sizeCanvas());

    const updatePointer = (clientX: number, clientY: number) => {
      const rect = this.canvas.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        this.mouseX = clientX - rect.left;
        this.mouseY = clientY - rect.top;
        this.isCursorActive = true;
      } else {
        this.isCursorActive = false;
      }
    };

    window.addEventListener("mousemove", (e) => updatePointer(e.clientX, e.clientY));
    window.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length > 0) updatePointer(e.touches[0].clientX, e.touches[0].clientY);
      },
      { passive: true },
    );
    window.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length > 0) updatePointer(e.touches[0].clientX, e.touches[0].clientY);
      },
      { passive: true },
    );

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          this.isVisible = entry.isIntersecting;
        });
      },
      { threshold: 0.1 },
    );
    observer.observe(this.container);
  }

  /** Public API used by the page scroll/param automation. */
  setParams(newParams: Partial<BoidsConfig>): void {
    Object.assign(this.params, newParams);
    if (newParams.zoomLevel !== undefined) this.targetZoom = newParams.zoomLevel;
    if (newParams.trailLength !== undefined && (newParams.trailLength | 0) !== this.sim.trailLen) {
      this.sim.setTrailLength(newParams.trailLength);
      this.renderer.syncBuffers();
    }
  }

  private buildStepContext(): SimStepContext {
    return {
      width: this.width,
      height: this.height,
      mouseX: this.mouseX,
      mouseY: this.mouseY,
      isCursorActive: this.isCursorActive,
      camZoom: this.currentZoom,
      camX: this.cameraX,
      camY: this.cameraY,
    };
  }

  private updateCamera(): Camera {
    const p = this.params;
    const zoomSmoothing = p.zoomSmoothing || 0.05;
    this.currentZoom += (this.targetZoom - this.currentZoom) * zoomSmoothing;

    const vi = p.visionBoidIndex;
    if (p.followBoid && vi >= 0 && vi < this.sim.count) {
      const targetCameraX = this.sim.posX[vi] - this.width / (2 * this.currentZoom);
      const targetCameraY = this.sim.posY[vi] - this.height / (2 * this.currentZoom);
      this.cameraX += (targetCameraX - this.cameraX) * p.cameraSmoothing;
      this.cameraY += (targetCameraY - this.cameraY) * p.cameraSmoothing;
    } else {
      const targetCameraX = (this.width * (this.currentZoom - 1)) / (2 * this.currentZoom);
      const targetCameraY = (this.height * (this.currentZoom - 1)) / (2 * this.currentZoom);
      this.cameraX += (targetCameraX - this.cameraX) * p.cameraSmoothing;
      this.cameraY += (targetCameraY - this.cameraY) * p.cameraSmoothing;
    }
    return { zoom: this.currentZoom, x: this.cameraX, y: this.cameraY };
  }

  private render(): void {
    const camera = this.updateCamera();
    this.renderer.render(camera);

    if (this.params.showVision || this.params.showStats) {
      this.ensureOverlay();
      this.overlay?.draw(camera, this.perfTracker.getFPS(), this.perfTracker.getFrameTime());
      this.overlayNeedsClear = true;
    } else if (this.overlay && this.overlayNeedsClear) {
      // Toggled off: clear the overlay once.
      this.overlay.draw(camera, 0, 0);
      this.overlayNeedsClear = false;
    }
  }

  private ensureOverlay(): void {
    if (this.overlay) return;
    const c = document.createElement("canvas");
    c.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;";
    c.width = this.width;
    c.height = this.height;
    this.canvas.insertAdjacentElement("afterend", c);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    this.overlayCanvas = c;
    this.overlay = new DebugOverlay(ctx, this.sim, this.params);
    this.overlay.resize(this.width, this.height);
  }

  private animationLoop = (timestamp: number): void => {
    this.perfTracker.update();

    if (this.params.enableFpsLimit) {
      const minFrameTime = 1000 / this.params.fpsLimit;
      if (timestamp - this.lastRenderTime < minFrameTime) {
        this.animationId = requestAnimationFrame(this.animationLoop);
        return;
      }
    }
    this.lastRenderTime = timestamp;

    if (!this.isVisible) {
      this.animationId = requestAnimationFrame(this.animationLoop);
      return;
    }

    if (!this.isPaused) this.sim.step(this.buildStepContext());
    this.render();
    this.animationId = requestAnimationFrame(this.animationLoop);
  };

  startAnimation(): void {
    this.animationId = requestAnimationFrame(this.animationLoop);
  }

  stopAnimation(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  private setupControls(): void {
    const panel = this.container.querySelector(".boids-controls") as HTMLElement;
    const toggleBtn = this.container.querySelector(".boids-toggle-btn") as HTMLElement;
    if (!panel || !toggleBtn) return;

    toggleBtn.addEventListener("click", () => {
      panel.classList.toggle("collapsed");
      const isCollapsed = panel.classList.contains("collapsed");
      const menuIcon = toggleBtn.querySelector(".icon-menu") as HTMLElement;
      const closeIcon = toggleBtn.querySelector(".icon-close") as HTMLElement;
      if (menuIcon) menuIcon.style.display = isCollapsed ? "block" : "none";
      if (closeIcon) closeIcon.style.display = isCollapsed ? "none" : "block";
    });

    const bindSlider = (className: string, key: keyof BoidsConfig, transform?: (v: number) => number): void => {
      const slider = this.container.querySelector(`.${className}`) as HTMLInputElement;
      const valueSpan = this.container.querySelector(`.${className}-value`) as HTMLElement;
      if (!slider || !valueSpan) return;
      slider.addEventListener("input", () => {
        const value = transform ? transform(parseFloat(slider.value)) : parseFloat(slider.value);
        (this.params as any)[key] = value;
        valueSpan.textContent = String(value);
        if (key === "zoomLevel") this.targetZoom = value;
      });
    };

    const bindCheckbox = (className: string, key: keyof BoidsConfig): void => {
      const checkbox = this.container.querySelector(`.${className}`) as HTMLInputElement;
      if (!checkbox) return;
      checkbox.addEventListener("change", () => {
        (this.params as any)[key] = checkbox.checked;
      });
    };

    bindSlider("visual-range", "visualRange");
    bindSlider("min-distance", "minDistance");
    bindSlider("max-speed", "maxSpeed", (v) => parseFloat(v.toFixed(4)));
    bindSlider("alignment", "alignmentFactor", (v) => parseFloat(v.toFixed(4)));
    bindSlider("cohesion", "cohesionFactor", (v) => parseFloat(v.toFixed(4)));
    bindSlider("separation", "separationFactor", (v) => parseFloat(v.toFixed(4)));
    bindSlider("wall-margin", "wallMargin");
    bindSlider("wall-turn", "wallTurnFactor", (v) => parseFloat(v.toFixed(4)));
    bindSlider("min-speed", "minSpeed", (v) => parseFloat(v.toFixed(4)));
    bindSlider("max-turn-rate", "maxTurnRate", (v) => parseFloat(v.toFixed(4)));
    bindSlider("fov", "fieldOfView");
    bindSlider("boid-size", "boidSize");
    bindSlider("trail-length", "trailLength", (v) => {
      const newLength = Math.floor(v);
      this.sim.setTrailLength(newLength);
      this.renderer.syncBuffers();
      return newLength;
    });
    bindSlider("fps-limit", "fpsLimit");
    bindSlider("vision-boid", "visionBoidIndex");
    bindSlider("zoom-level", "zoomLevel", (v) => parseFloat(v.toFixed(1)));
    bindSlider("camera-smoothing", "cameraSmoothing", (v) => parseFloat(v.toFixed(2)));
    bindSlider("cursor-magnetism", "cursorMagnetism", (v) => parseFloat(v.toFixed(2)));
    bindSlider("magnetism-range", "cursorMagnetismRange");
    bindSlider("uniform-hue", "uniformHue");
    bindSlider("color-blend-speed", "colorBlendSpeed", (v) => parseFloat(v.toFixed(3)));

    bindCheckbox("draw-trail", "drawTrail");
    bindCheckbox("show-vision", "showVision");
    bindCheckbox("enable-fps-limit", "enableFpsLimit");
    bindCheckbox("show-stats", "showStats");
    bindCheckbox("follow-boid", "followBoid");

    const colorModeSelect = this.container.querySelector(".color-mode") as HTMLSelectElement;
    if (colorModeSelect) {
      colorModeSelect.addEventListener("change", () => {
        this.params.colorMode = colorModeSelect.value as BoidsConfig["colorMode"];
        const uniformHueControl = this.container.querySelector(".uniform-hue-control") as HTMLElement;
        const blendSpeedControl = this.container.querySelector(".blend-speed-control") as HTMLElement;
        if (uniformHueControl) uniformHueControl.style.display = this.params.colorMode === "uniform" ? "block" : "none";
        if (blendSpeedControl) blendSpeedControl.style.display = this.params.colorMode === "flock" ? "block" : "none";
      });
    }

    const pauseBtn = this.container.querySelector(".pause-btn") as HTMLElement;
    if (pauseBtn) {
      pauseBtn.addEventListener("click", () => {
        this.isPaused = !this.isPaused;
        const pauseIcon = pauseBtn.querySelector(".icon-pause") as HTMLElement;
        const playIcon = pauseBtn.querySelector(".icon-play") as HTMLElement;
        const btnText = pauseBtn.querySelector(".btn-text") as HTMLElement;
        if (pauseIcon) pauseIcon.style.display = this.isPaused ? "none" : "block";
        if (playIcon) playIcon.style.display = this.isPaused ? "block" : "none";
        if (btnText) btnText.textContent = this.isPaused ? "Resume" : "Pause";
      });
    }

    const resetBtn = this.container.querySelector(".reset-btn") as HTMLElement;
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        this.sim.init(this.width, this.height);
        this.renderer.syncBuffers();
      });
    }

    const boidCountInput = this.container.querySelector(".boid-count") as HTMLInputElement;
    const boidCountValue = this.container.querySelector(".boid-count-value") as HTMLElement;
    if (boidCountInput && boidCountValue) {
      boidCountInput.addEventListener("input", () => {
        this.params.nBoids = parseInt(boidCountInput.value);
        boidCountValue.textContent = String(this.params.nBoids);
      });
    }
  }
}

declare global {
  interface Window {
    boidsInstances: Map<string, BoidsInstance>;
  }
}

window.boidsInstances = window.boidsInstances || new Map();

export function initAllBoids(): void {
  const containers = document.querySelectorAll(".boids-container");
  containers.forEach((container) => {
    const el = container as HTMLElement;
    const id = el.id;
    if (!window.boidsInstances.has(id)) {
      window.boidsInstances.set(id, new BoidsInstance(el));
    }
  });
}
