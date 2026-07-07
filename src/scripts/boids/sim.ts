// Structure-of-Arrays Boids simulation with an allocation-free flat spatial
// grid. This is a faithful, behaviour-preserving port of the original
// object-oriented `updateBoids()` from BoidsCanvas.astro:
//
//   * the update is in-place (Gauss-Seidel): the grid is built from
//     frame-start positions, then each boid is mutated in turn, so later
//     boids read the already-updated state of earlier ones — exactly as the
//     original `Boid[]` mutation did;
//   * the neighbour set, FOV test, separation/alignment/cohesion, wall
//     avoidance, cursor magnetism, speed clamp, turn-rate limit and the four
//     colour modes (incl. the flock circular-hue mean) are ported verbatim;
//   * trails are flat ring buffers (one window of `trailLen` per boid),
//     seeded to the spawn position so unfilled slots draw as zero-length
//     segments (replacing the old per-segment max-gap guard).

import type { BoidsConfig, SimStepContext } from "./types";

const TWO_PI = Math.PI * 2;
// Pad the grid by a couple of cells so boids that briefly leave the viewport
// still bucket correctly; anything beyond is clamped to the edge cell.
const GRID_PADDING_CELLS = 2;

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class BoidSim {
  private p: BoidsConfig;

  capacity = 0;
  count = 0;

  // Per-boid SoA state.
  posX = new Float32Array(0);
  posY = new Float32Array(0);
  velX = new Float32Array(0);
  velY = new Float32Array(0);
  baseHue = new Float32Array(0);
  colH = new Float32Array(0);
  colS = new Float32Array(0);
  colL = new Float32Array(0);

  // Trails: boid i occupies trailX/Y[i*trailLen .. (i+1)*trailLen).
  // The ring is always treated as full (seeded), `trailHead` is the next write
  // slot, so oldest->newest = head, head+1, ... wrapping.
  trailLen = 0;
  trailX = new Float32Array(0);
  trailY = new Float32Array(0);
  trailHead = new Int32Array(0);

  // Bumped whenever capacity or trail length changes so renderers know to
  // (re)allocate their GPU buffers.
  structureVersion = 0;

  // Flat spatial grid (counting sort).
  private gInvCell = 1;
  private gOriginX = 0;
  private gOriginY = 0;
  private gCols = 0;
  private gRows = 0;
  private gNumCells = 0;
  private cellCount = new Int32Array(0);
  private cellStart = new Int32Array(0);
  private cellCursor = new Int32Array(0);
  private sortedIdx = new Int32Array(0);
  private cellOfBoid = new Int32Array(0);

  constructor(params: BoidsConfig) {
    this.p = params;
  }

  /** Allocate and randomise `params.nBoids` boids. Also used for reset. */
  init(width: number, height: number): void {
    this.allocate(this.p.nBoids);
    this.count = this.p.nBoids;
    for (let i = 0; i < this.count; i++) {
      this.posX[i] = Math.random() * width;
      this.posY[i] = Math.random() * height;
      this.velX[i] = Math.random() * 10 - 5;
      this.velY[i] = Math.random() * 10 - 5;
      const hue = Math.random() * 360;
      this.baseHue[i] = hue;
      this.colH[i] = hue;
      this.colS[i] = 70;
      this.colL[i] = 60;
    }
    this.setTrailLength(this.p.trailLength);
  }

  private allocate(capacity: number): void {
    if (capacity === this.capacity) return;
    this.capacity = capacity;
    this.posX = new Float32Array(capacity);
    this.posY = new Float32Array(capacity);
    this.velX = new Float32Array(capacity);
    this.velY = new Float32Array(capacity);
    this.baseHue = new Float32Array(capacity);
    this.colH = new Float32Array(capacity);
    this.colS = new Float32Array(capacity);
    this.colL = new Float32Array(capacity);
    this.cellOfBoid = new Int32Array(capacity);
    this.sortedIdx = new Int32Array(capacity);
    this.trailHead = new Int32Array(capacity);
    this.structureVersion++;
  }

  /** (Re)allocate trail buffers and seed them to current positions. */
  setTrailLength(len: number): void {
    const n = Math.max(0, len | 0);
    this.trailLen = n;
    this.trailX = new Float32Array(this.capacity * n);
    this.trailY = new Float32Array(this.capacity * n);
    this.trailHead.fill(0);
    this.seedTrails();
    this.structureVersion++;
  }

  private seedTrails(): void {
    const n = this.trailLen;
    if (n === 0) return;
    for (let i = 0; i < this.count; i++) {
      const base = i * n;
      const x = this.posX[i];
      const y = this.posY[i];
      for (let k = 0; k < n; k++) {
        this.trailX[base + k] = x;
        this.trailY[base + k] = y;
      }
      this.trailHead[i] = 0;
    }
  }

  /** Advance the simulation one tick. */
  step(c: SimStepContext): void {
    const p = this.p;
    const n = this.count;
    if (n === 0) return;

    const posX = this.posX;
    const posY = this.posY;
    const velX = this.velX;
    const velY = this.velY;
    const colH = this.colH;

    const visualRange = p.visualRange;
    const minDistance = p.minDistance;
    const visualRange2 = visualRange * visualRange;
    const minDistance2 = minDistance * minDistance;
    const alignmentFactor = p.alignmentFactor;
    const cohesionFactor = p.cohesionFactor;
    const separationFactor = p.separationFactor;
    const maxSpeed = p.maxSpeed;
    const minSpeed = p.minSpeed;
    const maxSpeed2 = maxSpeed * maxSpeed;
    const minSpeed2 = minSpeed * minSpeed;
    const maxTurnRate = p.maxTurnRate;
    const wallMargin = p.wallMargin;
    const wallTurnFactor = p.wallTurnFactor;
    const width = c.width;
    const height = c.height;

    const fullFov = p.fieldOfView >= 360;
    const fovGt180 = p.fieldOfView > 180;
    let cosHalfFovSq = 0;
    if (!fullFov) {
      const cc = Math.cos((p.fieldOfView * Math.PI) / 360);
      cosHalfFovSq = cc * cc;
    }

    const colorMode = p.colorMode;
    const doFlock = colorMode === "flock";
    const uniformHue = p.uniformHue;
    const colorBlendSpeed = p.colorBlendSpeed;

    const cursorMag = p.cursorMagnetism;
    const cursorOn = cursorMag !== 0 && c.isCursorActive;
    const cursorRange = p.cursorMagnetismRange;
    const worldMouseX = c.mouseX / c.camZoom + c.camX;
    const worldMouseY = c.mouseY / c.camZoom + c.camY;

    // Build the grid from frame-start positions.
    this.buildGrid(width, height, Math.max(1, visualRange));
    const invCell = this.gInvCell;
    const cols = this.gCols;
    const rows = this.gRows;
    const originX = this.gOriginX;
    const originY = this.gOriginY;
    const cellStart = this.cellStart;
    const sortedIdx = this.sortedIdx;
    const cellRadius = Math.max(1, Math.ceil(visualRange * invCell));

    const trailLen = this.trailLen;
    const trailX = this.trailX;
    const trailY = this.trailY;
    const trailHead = this.trailHead;

    for (let i = 0; i < n; i++) {
      const bx = posX[i];
      const by = posY[i];
      const origDx = velX[i];
      const origDy = velY[i];
      let vx = origDx;
      let vy = origDy;
      const vMag2 = vx * vx + vy * vy;

      let sepX = 0;
      let sepY = 0;
      let alignX = 0;
      let alignY = 0;
      let cohX = 0;
      let cohY = 0;
      let count = 0;
      let flockAvgH = colH[i];
      let flockCount = 1;

      const cx = clampInt(Math.floor((bx - originX) * invCell), 0, cols - 1);
      const cy = clampInt(Math.floor((by - originY) * invCell), 0, rows - 1);
      const xlo = Math.max(0, cx - cellRadius);
      const xhi = Math.min(cols - 1, cx + cellRadius);
      const ylo = Math.max(0, cy - cellRadius);
      const yhi = Math.min(rows - 1, cy + cellRadius);

      for (let gy = ylo; gy <= yhi; gy++) {
        const rowBase = gy * cols;
        for (let gx = xlo; gx <= xhi; gx++) {
          const cidx = rowBase + gx;
          const end = cellStart[cidx + 1];
          for (let s = cellStart[cidx]; s < end; s++) {
            const j = sortedIdx[s];
            if (j === i) continue;
            const dx = posX[j] - bx;
            const dy = posY[j] - by;
            const dist2 = dx * dx + dy * dy;
            if (dist2 === 0) continue;
            if (dist2 > visualRange2 && dist2 > minDistance2) continue;

            let inFov = true;
            if (!fullFov && vMag2 !== 0) {
              const dot = vx * dx + vy * dy;
              if (fovGt180) {
                inFov = dot >= 0 ? true : dot * dot <= vMag2 * dist2 * cosHalfFovSq;
              } else {
                inFov = dot <= 0 ? false : dot * dot >= vMag2 * dist2 * cosHalfFovSq;
              }
            }

            if (dist2 <= minDistance2) {
              const factor = inFov ? 1.0 : 0.5;
              sepX += -dx * factor;
              sepY += -dy * factor;
            }
            if (dist2 <= visualRange2 && inFov) {
              alignX += velX[j];
              alignY += velY[j];
              cohX += posX[j];
              cohY += posY[j];
              count++;
              if (doFlock) {
                let otherH = colH[j];
                let avgH = flockAvgH;
                if (Math.abs(avgH - otherH) > 180) {
                  if (otherH < avgH) otherH += 360;
                  else avgH += 360;
                }
                flockAvgH = (avgH * flockCount + otherH) / (flockCount + 1);
                flockCount++;
              }
            }
          }
        }
      }

      // Separation.
      vx += sepX * separationFactor;
      vy += sepY * separationFactor;

      // Alignment & cohesion.
      if (count > 0) {
        const dxAvg = alignX / count;
        const dyAvg = alignY / count;
        vx += (dxAvg - vx) * alignmentFactor;
        vy += (dyAvg - vy) * alignmentFactor;
        const ccx = cohX / count;
        const ccy = cohY / count;
        vx += (ccx - bx) * cohesionFactor;
        vy += (ccy - by) * cohesionFactor;
      }

      // Wall avoidance.
      if (bx < wallMargin) vx += wallTurnFactor * (1 - bx / wallMargin);
      if (bx > width - wallMargin) vx -= wallTurnFactor * (1 - (width - bx) / wallMargin);
      if (by < wallMargin) vy += wallTurnFactor * (1 - by / wallMargin);
      if (by > height - wallMargin) vy -= wallTurnFactor * (1 - (height - by) / wallMargin);

      // Cursor magnetism.
      if (cursorOn) {
        const dx = worldMouseX - bx;
        const dy = worldMouseY - by;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < cursorRange && dist > 0) {
          const strength = cursorMag * (1 - dist / cursorRange);
          vx += (dx / dist) * strength;
          vy += (dy / dist) * strength;
        }
      }

      // Speed clamp (squared compare; sqrt only when rescaling).
      const speed2 = vx * vx + vy * vy;
      if (speed2 > maxSpeed2) {
        const inv = maxSpeed / Math.sqrt(speed2);
        vx *= inv;
        vy *= inv;
      } else if (speed2 < minSpeed2 && speed2 > 0) {
        const inv = minSpeed / Math.sqrt(speed2);
        vx *= inv;
        vy *= inv;
      }

      // Turn-rate limit.
      {
        const currentHeading = Math.atan2(origDy, origDx);
        const desiredHeading = Math.atan2(vy, vx);
        let angleDiff = desiredHeading - currentHeading;
        while (angleDiff > Math.PI) angleDiff -= TWO_PI;
        while (angleDiff < -Math.PI) angleDiff += TWO_PI;
        const clampedDiff = angleDiff < -maxTurnRate ? -maxTurnRate : angleDiff > maxTurnRate ? maxTurnRate : angleDiff;
        const newHeading = currentHeading + clampedDiff;
        let speed = Math.sqrt(vx * vx + vy * vy);
        if (speed < minSpeed) speed = minSpeed;
        vx = Math.cos(newHeading) * speed;
        vy = Math.sin(newHeading) * speed;
      }

      velX[i] = vx;
      velY[i] = vy;

      this.updateColor(i, colorMode, flockAvgH, uniformHue, colorBlendSpeed, maxSpeed, vx, vy);

      // Integrate position.
      const nx = bx + vx;
      const ny = by + vy;
      posX[i] = nx;
      posY[i] = ny;

      // Push trail point (ring is always full).
      if (trailLen > 0) {
        const base = i * trailLen;
        const hh = trailHead[i];
        trailX[base + hh] = nx;
        trailY[base + hh] = ny;
        trailHead[i] = (hh + 1) % trailLen;
      }
    }
  }

  private updateColor(
    i: number,
    colorMode: BoidsConfig["colorMode"],
    flockAvgHRaw: number,
    uniformHue: number,
    colorBlendSpeed: number,
    maxSpeed: number,
    vx: number,
    vy: number,
  ): void {
    const colH = this.colH;
    const colS = this.colS;
    const colL = this.colL;
    switch (colorMode) {
      case "uniform":
        colH[i] = uniformHue;
        colS[i] = 70;
        colL[i] = 60;
        break;
      case "random":
        colH[i] = this.baseHue[i];
        colS[i] = 70;
        colL[i] = 60;
        break;
      case "velocity": {
        const angle = Math.atan2(vy, vx);
        const hue = ((angle + Math.PI) / TWO_PI) * 360;
        const speed = Math.sqrt(vx * vx + vy * vy);
        colH[i] = hue;
        colS[i] = 80;
        colL[i] = 40 + (speed / maxSpeed) * 30;
        break;
      }
      case "flock": {
        let target = flockAvgHRaw % 360;
        if (target < 0) target += 360;
        const current = colH[i];
        const delta = ((((target - current) % 360) + 540) % 360) - 180;
        colH[i] = (current + delta * colorBlendSpeed + 360) % 360;
        colS[i] = 75;
        colL[i] = 55;
        break;
      }
    }
  }

  private buildGrid(width: number, height: number, cell: number): void {
    const invCell = 1 / cell;
    const pad = GRID_PADDING_CELLS;
    const originX = -pad * cell;
    const originY = -pad * cell;
    const cols = Math.max(1, Math.ceil((width - originX) * invCell) + pad);
    const rows = Math.max(1, Math.ceil((height - originY) * invCell) + pad);
    const numCells = cols * rows;

    if (numCells !== this.gNumCells) {
      this.cellCount = new Int32Array(numCells);
      this.cellStart = new Int32Array(numCells + 1);
      this.cellCursor = new Int32Array(numCells);
      this.gNumCells = numCells;
    }

    this.gInvCell = invCell;
    this.gOriginX = originX;
    this.gOriginY = originY;
    this.gCols = cols;
    this.gRows = rows;

    const n = this.count;
    const posX = this.posX;
    const posY = this.posY;
    const cellOfBoid = this.cellOfBoid;
    const cellCount = this.cellCount;
    cellCount.fill(0);

    for (let i = 0; i < n; i++) {
      const gx = clampInt(Math.floor((posX[i] - originX) * invCell), 0, cols - 1);
      const gy = clampInt(Math.floor((posY[i] - originY) * invCell), 0, rows - 1);
      const cidx = gy * cols + gx;
      cellOfBoid[i] = cidx;
      cellCount[cidx]++;
    }

    const cellStart = this.cellStart;
    let acc = 0;
    for (let cidx = 0; cidx < numCells; cidx++) {
      cellStart[cidx] = acc;
      acc += cellCount[cidx];
    }
    cellStart[numCells] = acc;

    const cursor = this.cellCursor;
    cursor.set(cellStart.subarray(0, numCells));
    const sortedIdx = this.sortedIdx;
    for (let i = 0; i < n; i++) {
      const cidx = cellOfBoid[i];
      sortedIdx[cursor[cidx]++] = i;
    }
  }

  /**
   * Iterate boid indices in the cell block around (bx, by) covering `range`.
   * Uses the grid as built by the last `step()` — for the debug overlay only.
   */
  queryNeighbors(bx: number, by: number, range: number, cb: (j: number) => void): void {
    if (this.gNumCells === 0) return;
    const invCell = this.gInvCell;
    const cols = this.gCols;
    const rows = this.gRows;
    const cellRadius = Math.max(1, Math.ceil(range * invCell));
    const cx = clampInt(Math.floor((bx - this.gOriginX) * invCell), 0, cols - 1);
    const cy = clampInt(Math.floor((by - this.gOriginY) * invCell), 0, rows - 1);
    const xlo = Math.max(0, cx - cellRadius);
    const xhi = Math.min(cols - 1, cx + cellRadius);
    const ylo = Math.max(0, cy - cellRadius);
    const yhi = Math.min(rows - 1, cy + cellRadius);
    const cellStart = this.cellStart;
    const sortedIdx = this.sortedIdx;
    for (let gy = ylo; gy <= yhi; gy++) {
      const rowBase = gy * cols;
      for (let gx = xlo; gx <= xhi; gx++) {
        const cidx = rowBase + gx;
        const end = cellStart[cidx + 1];
        for (let s = cellStart[cidx]; s < end; s++) {
          cb(sortedIdx[s]);
        }
      }
    }
  }
}
