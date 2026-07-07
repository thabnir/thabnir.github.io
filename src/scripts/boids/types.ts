// Shared types for the Boids engine.
//
// The engine is split across a few focused modules:
//   - sim.ts              SoA simulation + allocation-free spatial grid (CPU)
//   - webgl-renderer.ts   WebGL2 instanced renderer (default backend)
//   - canvas2d-renderer.ts Canvas2D fallback renderer
//   - debug-overlay.ts    Vision cone / neighbour lines / stats (2D overlay)
//   - instance.ts         Orchestrator + control panel + global registry
//
// The public surface consumed by the pages (component props via
// `data-boids-config`, the `window.boidsInstances` registry, and
// `instance.setParams(...)`) is preserved exactly.

export interface BoidsConfig {
  nBoids: number;
  nBoidsMobile?: number;
  visualRange: number;
  minDistance: number;
  maxSpeed: number;
  minSpeed: number;
  maxTurnRate: number;
  fieldOfView: number;
  alignmentFactor: number;
  cohesionFactor: number;
  separationFactor: number;
  wallMargin: number;
  wallTurnFactor: number;
  cursorMagnetism: number;
  cursorMagnetismRange: number;
  boidSize: number;
  trailLength: number;
  drawTrail: boolean;
  showVision: boolean;
  showVisionCone: boolean;
  visionBoidIndex: number;
  followBoid: boolean;
  zoomLevel: number;
  cameraSmoothing: number;
  zoomSmoothing: number;
  colorMode: "uniform" | "random" | "velocity" | "flock";
  uniformHue: number;
  colorBlendSpeed: number;
  fpsLimit: number;
  enableFpsLimit: boolean;
  showStats: boolean;
  showControls: boolean;
  enableScrollControl: boolean;
}

/** Camera state in world units (matches the old ctx.scale/translate math). */
export interface Camera {
  zoom: number;
  x: number;
  y: number;
}

/** Per-frame inputs the simulation needs beyond its own params. */
export interface SimStepContext {
  width: number;
  height: number;
  mouseX: number;
  mouseY: number;
  isCursorActive: boolean;
  camZoom: number;
  camX: number;
  camY: number;
}

/** Anything that can draw the current simulation state. */
export interface BoidRenderer {
  /** Called when the canvas backing store changes size. */
  resize(width: number, height: number): void;
  /** Draw one frame for the given camera. */
  render(camera: Camera): void;
  /** Re-read capacity/trail-length from the sim after a structural change. */
  syncBuffers(): void;
  /** Release GPU / DOM resources. */
  destroy(): void;
}
