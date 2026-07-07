// Debug overlay (vision cone + neighbour lines + min-distance circle + FPS
// stats), drawn on a transparent 2D canvas stacked over the main renderer.
// Shared by both backends; only active when showVision / showStats is on, so
// it costs nothing in the common case. Ported verbatim from the original
// drawBoid() vision block and drawStats().

import type { BoidsConfig, Camera } from "./types";
import type { BoidSim } from "./sim";

const TWO_PI = Math.PI * 2;

function inFieldOfView(vx: number, vy: number, dx: number, dy: number, fov: number): boolean {
  if (fov >= 360) return true;
  const vMag2 = vx * vx + vy * vy;
  if (vMag2 === 0) return true;
  const dist2 = dx * dx + dy * dy;
  if (dist2 === 0) return true;
  const dot = vx * dx + vy * dy;
  const cosHalf = Math.cos((fov * Math.PI) / 360);
  const cosHalfFovSq = cosHalf * cosHalf;
  if (fov > 180) {
    if (dot >= 0) return true;
    return dot * dot <= vMag2 * dist2 * cosHalfFovSq;
  }
  if (dot <= 0) return false;
  return dot * dot >= vMag2 * dist2 * cosHalfFovSq;
}

export class DebugOverlay {
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

  /** Returns true if anything was drawn (so the instance can skip clearing). */
  draw(camera: Camera, fps: number, frameTime: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    if (this.params.showVision) {
      ctx.save();
      ctx.scale(camera.zoom, camera.zoom);
      ctx.translate(-camera.x, -camera.y);
      this.drawVision();
      ctx.restore();
    }

    if (this.params.showStats) this.drawStats(fps, frameTime);
  }

  private drawVision(): void {
    const ctx = this.ctx;
    const sim = this.sim;
    const p = this.params;
    const vi = p.visionBoidIndex;
    if (vi < 0 || vi >= sim.count) return;

    const x = sim.posX[vi];
    const y = sim.posY[vi];
    const vx = sim.velX[vi];
    const vy = sim.velY[vi];
    const heading = Math.atan2(vy, vx);
    const halfFov = (p.fieldOfView * Math.PI) / 360;
    const visualRange = p.visualRange;
    const minDistance = p.minDistance;

    if (p.showVisionCone) {
      ctx.strokeStyle = "rgba(85, 140, 244, 0.3)";
      ctx.fillStyle = "rgba(85, 140, 244, 0.1)";
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, visualRange, heading - halfFov, heading + halfFov);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      if (p.fieldOfView < 360) {
        ctx.strokeStyle = "rgba(100, 100, 100, 0.2)";
        ctx.fillStyle = "rgba(50, 50, 50, 0.05)";
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, visualRange, heading + halfFov, heading - halfFov);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.strokeStyle = "rgba(244, 85, 85, 0.5)";
    ctx.fillStyle = "rgba(244, 85, 85, 0.1)";
    ctx.beginPath();
    ctx.arc(x, y, minDistance, 0, TWO_PI);
    ctx.fill();
    ctx.stroke();

    const visualRange2 = visualRange * visualRange;
    const minDistance2 = minDistance * minDistance;
    const fov = p.fieldOfView;
    sim.queryNeighbors(x, y, visualRange, (j) => {
      if (j === vi) return;
      const dx = sim.posX[j] - x;
      const dy = sim.posY[j] - y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 > visualRange2) return;
      const fovOk = inFieldOfView(vx, vy, dx, dy, fov);
      if (dist2 <= minDistance2) {
        ctx.strokeStyle = fovOk ? "rgba(244, 85, 85, 0.8)" : "rgba(244, 85, 85, 0.4)";
      } else if (fovOk) {
        ctx.strokeStyle = "rgba(85, 244, 140, 0.5)";
      } else {
        ctx.strokeStyle = "rgba(100, 100, 100, 0.3)";
      }
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(sim.posX[j], sim.posY[j]);
      ctx.stroke();
    });
  }

  private drawStats(fps: number, frameTime: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(10, 10, 160, 50);
    ctx.fillStyle = "#fff";
    ctx.font = "14px monospace";
    ctx.fillText(`FPS: ${fps.toFixed(1)}`, 20, 30);
    ctx.fillText(`Frame: ${frameTime.toFixed(2)}ms`, 20, 50);
  }
}
