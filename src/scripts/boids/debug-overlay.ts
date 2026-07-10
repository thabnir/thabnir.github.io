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
      if (p.fieldOfView >= 360) {
        // A full circle is not a sector: drawing it as one avoids a false radial seam.
        ctx.arc(x, y, visualRange, 0, TWO_PI);
      } else {
        ctx.moveTo(x, y);
        ctx.arc(x, y, visualRange, heading - halfFov, heading + halfFov);
        ctx.closePath();
      }
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
    const eligibleNeighbors: number[] = [];
    const closeNeighbors: number[] = [];
    // The simulation grid is built at the start of a step, while this overlay
    // renders the post-step positions. Scan this one boid directly so the
    // displayed centroid and headings always match the frame on screen.
    for (let j = 0; j < sim.count; j++) {
      if (j === vi) continue;
      const dx = sim.posX[j] - x;
      const dy = sim.posY[j] - y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 === 0 || dist2 > visualRange2) continue;
      const fovOk = inFieldOfView(vx, vy, dx, dy, fov);
      if (dist2 <= minDistance2) {
        ctx.strokeStyle = fovOk ? "rgba(244, 85, 85, 0.8)" : "rgba(244, 85, 85, 0.4)";
        closeNeighbors.push(j);
      } else if (fovOk) {
        // Keep the positional links quiet in the alignment explainer, so the
        // green velocity arrows and the larger average arrow remain legible.
        ctx.strokeStyle =
          p.explanationMode === "alignment" || p.explanationMode === "combined"
            ? "rgba(85, 140, 244, 0.32)"
            : "rgba(85, 244, 140, 0.5)";
      } else {
        ctx.strokeStyle = "rgba(100, 100, 100, 0.3)";
      }
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(sim.posX[j], sim.posY[j]);
      ctx.stroke();

      if (fovOk) eligibleNeighbors.push(j);
    }

    if (p.explanationMode === "separation" && closeNeighbors.length > 0) {
      this.drawSeparationGuide(x, y, closeNeighbors, visualRange);
    } else if (p.explanationMode === "alignment" && eligibleNeighbors.length > 0) {
      this.drawAlignmentGuide(x, y, eligibleNeighbors, visualRange);
    } else if (p.explanationMode === "cohesion" && eligibleNeighbors.length > 0) {
      this.drawCohesionGuide(x, y, eligibleNeighbors);
    } else if (p.explanationMode === "combined") {
      if (closeNeighbors.length > 0) this.drawSeparationGuide(x, y, closeNeighbors, visualRange);
      if (eligibleNeighbors.length > 0) {
        this.drawAlignmentGuide(x, y, eligibleNeighbors, visualRange);
        this.drawCohesionGuide(x, y, eligibleNeighbors);
      }
    }
  }

  /** Draw the aggregate push away from neighbors inside the minimum distance. */
  private drawSeparationGuide(x: number, y: number, neighbors: number[], visualRange: number): void {
    const sim = this.sim;
    let awayX = 0;
    let awayY = 0;

    for (const j of neighbors) {
      awayX += x - sim.posX[j];
      awayY += y - sim.posY[j];
    }

    const magnitude = Math.hypot(awayX, awayY);
    if (magnitude === 0) return;

    const length = Math.max(24, Math.min(38, visualRange * 0.55));
    this.drawArrow(
      x,
      y,
      x + (awayX / magnitude) * length,
      y + (awayY / magnitude) * length,
      "rgba(244, 85, 85, 0.98)",
      1.35,
    );
  }

  /** Draw the local mean velocity that the alignment rule steers toward. */
  private drawAlignmentGuide(x: number, y: number, neighbors: number[], visualRange: number): void {
    const sim = this.sim;
    const neighborArrowLength = Math.max(10, Math.min(18, visualRange * 0.2));
    let avgX = 0;
    let avgY = 0;

    for (const j of neighbors) {
      const vx = sim.velX[j];
      const vy = sim.velY[j];
      const magnitude = Math.hypot(vx, vy);
      if (magnitude === 0) continue;
      const nx = vx / magnitude;
      const ny = vy / magnitude;
      avgX += vx;
      avgY += vy;
      this.drawArrow(
        sim.posX[j],
        sim.posY[j],
        sim.posX[j] + nx * neighborArrowLength,
        sim.posY[j] + ny * neighborArrowLength,
        "rgba(85, 244, 140, 0.8)",
        0.55,
      );
    }

    const averageMagnitude = Math.hypot(avgX, avgY);
    if (averageMagnitude === 0) return;

    const averageLength = Math.max(24, Math.min(36, visualRange * 0.42));
    this.drawArrow(
      x,
      y,
      x + (avgX / averageMagnitude) * averageLength,
      y + (avgY / averageMagnitude) * averageLength,
      "rgba(85, 244, 140, 0.96)",
      1.35,
    );
  }

  /** Mark the local centroid and the cohesion steering direction. */
  private drawCohesionGuide(x: number, y: number, neighbors: number[]): void {
    const ctx = this.ctx;
    const sim = this.sim;
    let centerX = 0;
    let centerY = 0;

    for (const j of neighbors) {
      centerX += sim.posX[j];
      centerY += sim.posY[j];
    }
    centerX /= neighbors.length;
    centerY /= neighbors.length;

    ctx.save();
    ctx.setLineDash([3, 3]);
    this.drawArrow(x, y, centerX, centerY, "rgba(85, 140, 244, 0.96)", 1.1);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(85, 140, 244, 0.98)";
    ctx.fillStyle = "rgba(85, 140, 244, 0.22)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 7, 0, TWO_PI);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX - 11, centerY);
    ctx.lineTo(centerX + 11, centerY);
    ctx.moveTo(centerX, centerY - 11);
    ctx.lineTo(centerX, centerY + 11);
    ctx.stroke();
    ctx.restore();
  }

  private drawArrow(x1: number, y1: number, x2: number, y2: number, color: string, lineWidth: number): void {
    const ctx = this.ctx;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    if (length < 0.001) return;

    const angle = Math.atan2(dy, dx);
    const headLength = Math.max(3.5, lineWidth * 5);
    const headAngle = Math.PI / 7;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - Math.cos(angle - headAngle) * headLength, y2 - Math.sin(angle - headAngle) * headLength);
    ctx.lineTo(x2 - Math.cos(angle + headAngle) * headLength, y2 - Math.sin(angle + headAngle) * headLength);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
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
