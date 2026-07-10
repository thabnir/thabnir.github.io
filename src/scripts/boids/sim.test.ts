import { describe, expect, test } from "bun:test";

import { BoidSim } from "./sim";
import type { BoidsConfig, SimStepContext } from "./types";

const config: BoidsConfig = {
  nBoids: 3,
  visualRange: 100,
  minDistance: 0,
  maxSpeed: 100,
  minSpeed: 0,
  maxTurnRate: Math.PI,
  fieldOfView: 360,
  alignmentFactor: 0,
  cohesionFactor: 1,
  separationFactor: 0,
  wallMargin: 0,
  wallTurnFactor: 0,
  cursorMagnetism: 0,
  cursorMagnetismRange: 0,
  boidSize: 10,
  trailLength: 0,
  drawTrail: false,
  showVision: false,
  showVisionCone: false,
  visionBoidIndex: 0,
  followBoid: false,
  zoomLevel: 1,
  cameraSmoothing: 1,
  zoomSmoothing: 1,
  colorMode: "uniform",
  uniformHue: 215,
  colorBlendSpeed: 0,
  fpsLimit: 60,
  enableFpsLimit: false,
  showStats: false,
  showControls: false,
  enableScrollControl: false,
};

const stepContext: SimStepContext = {
  width: 1000,
  height: 1000,
  mouseX: 0,
  mouseY: 0,
  isCursorActive: false,
  camZoom: 1,
  camX: 0,
  camY: 0,
};

function setHorizontalState(sim: BoidSim, positions: [number, number, number]): void {
  sim.posX.set(positions);
  sim.posY.fill(100);
  sim.velX.fill(0);
  sim.velY.fill(0);
}

describe("cohesion centroid", () => {
  test("recomputes the centroid when the same neighbors move", () => {
    const sim = new BoidSim({ ...config });
    sim.init(stepContext.width, stepContext.height);

    setHorizontalState(sim, [100, 110, 120]);
    sim.step(stepContext);
    expect(sim.velX[0]).toBeCloseTo(15, 5);
    expect(sim.posX[0]).toBeCloseTo(115, 5);

    setHorizontalState(sim, [100, 120, 140]);
    sim.step(stepContext);
    expect(sim.velX[0]).toBeCloseTo(30, 5);
    expect(sim.posX[0]).toBeCloseTo(130, 5);
  });

  test("all boids steer from the same frame-start positions", () => {
    const sim = new BoidSim({ ...config });
    sim.init(stepContext.width, stepContext.height);

    setHorizontalState(sim, [100, 110, 120]);
    sim.step(stepContext);

    expect(sim.velX[0]).toBeCloseTo(15, 5);
    expect(sim.velX[2]).toBeCloseTo(-15, 5);
    expect(sim.posX[0]).toBeCloseTo(115, 5);
    expect(sim.posX[2]).toBeCloseTo(105, 5);
  });
});
