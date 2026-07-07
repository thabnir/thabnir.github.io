// Canvas2D fallback renderer — used when WebGL2 is unavailable (or forced via
// `?boids=canvas2d`). Reads the same SoA simulation state and reproduces the
// original look: an oriented triangle per boid plus a translucent polyline
// trail. Vision-cone / stats debug is handled separately by debug-overlay.ts.

import type { BoidRenderer, BoidsConfig, Camera } from "./types";
import type { BoidSim } from "./sim";

const VISION_COLOR = "#f4a855";
const VISION_TRAIL = "rgba(244, 168, 85, 0.4)";
const MAX_TRAIL_GAP_SQ = 20 * 20;

export class Canvas2DBoidRenderer implements BoidRenderer {
  private ctx: CanvasRenderingContext2D;
  private sim: BoidSim;
  private params: BoidsConfig;
  private width = 1;
  private height = 1;

  constructor(ctx: CanvasRenderingContext2D, sim: BoidSim, params: BoidsConfig) {
    this.ctx = ctx;
    this.sim = sim;
    this.params = params;
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  syncBuffers(): void {
    // No GPU buffers to sync.
  }

  render(camera: Camera): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.save();
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    const n = this.sim.count;
    for (let i = 0; i < n; i++) this.drawBoid(i);

    ctx.restore();
  }

  private drawBoid(i: number): void {
    const ctx = this.ctx;
    const sim = this.sim;
    const p = this.params;
    const size = p.boidSize;
    const isVision = p.showVision && i === p.visionBoidIndex;

    const x = sim.posX[i];
    const y = sim.posY[i];
    const dx = sim.velX[i];
    const dy = sim.velY[i];

    ctx.fillStyle = isVision ? VISION_COLOR : `hsl(${sim.colH[i]}, ${sim.colS[i]}%, ${sim.colL[i]}%)`;

    // Oriented triangle without save/translate/rotate.
    const speed2 = dx * dx + dy * dy;
    let ux = 1;
    let uy = 0;
    if (speed2 > 1e-8) {
      const inv = 1 / Math.sqrt(speed2);
      ux = dx * inv;
      uy = dy * inv;
    }
    const px = -uy;
    const py = ux;
    const tailX = x - ux * size;
    const tailY = y - uy * size;
    const halfW = size / 3;
    const leftX = tailX + px * halfW;
    const leftY = tailY + py * halfW;
    const rightX = tailX - px * halfW;
    const rightY = tailY - py * halfW;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fill();

    if (p.drawTrail && sim.trailLen > 1) {
      const tl = sim.trailLen;
      const base = i * tl;
      const head = sim.trailHead[i];
      ctx.strokeStyle = isVision ? VISION_TRAIL : `hsla(${sim.colH[i]}, ${sim.colS[i]}%, 50%, 0.4)`;
      ctx.beginPath();
      let prevX = sim.trailX[base + head];
      let prevY = sim.trailY[base + head];
      ctx.moveTo(prevX, prevY);
      for (let k = 1; k < tl; k++) {
        const slot = (head + k) % tl;
        const tx = sim.trailX[base + slot];
        const ty = sim.trailY[base + slot];
        const gx = tx - prevX;
        const gy = ty - prevY;
        if (gx * gx + gy * gy < MAX_TRAIL_GAP_SQ) {
          ctx.lineTo(tx, ty);
        } else {
          ctx.moveTo(tx, ty);
        }
        prevX = tx;
        prevY = ty;
      }
      ctx.stroke();
    }
  }

  destroy(): void {
    // Nothing to release.
  }
}
