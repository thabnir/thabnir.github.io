// WebGL2 instanced renderer — the default backend.
//
//   * Boids: one `drawArraysInstanced` of a 3-vertex triangle whose shape
//     matches the old Canvas2D geometry (apex at the boid, base behind it,
//     half-width size/3). Per-instance position/velocity/colour are streamed
//     from the sim's SoA arrays each frame.
//   * Trails: one indexed `LINE_STRIP` draw using WebGL2 primitive restart
//     (UNSIGNED_INT sentinel 0xFFFFFFFF between boids). One upload + one draw
//     for every trail on screen.
//
// Premultiplied-alpha blending is used so translucent trails composite over
// the page background exactly like the old `source-over` Canvas2D draws.

import type { BoidRenderer, BoidsConfig, Camera } from "./types";
import type { BoidSim } from "./sim";

// #f4a855 — the highlight colour the original used for the "vision" boid.
const VISION_R = 244 / 255;
const VISION_G = 168 / 255;
const VISION_B = 85 / 255;

const TRAIL_ALPHA = 0.4;
const TRAIL_LIGHTNESS = 50;
const RESTART_INDEX = 0xffffffff;

const BOID_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aLocal;
layout(location=1) in vec2 iPos;
layout(location=2) in vec2 iVel;
layout(location=3) in vec3 iColor;
uniform float uSize;
uniform float uCamZoom;
uniform vec2 uCamPos;
uniform vec2 uViewport;
out vec3 vColor;
void main() {
  vec2 dir = iVel;
  float spd2 = dot(dir, dir);
  vec2 u = spd2 > 1e-8 ? dir * inversesqrt(spd2) : vec2(1.0, 0.0);
  vec2 perp = vec2(-u.y, u.x);
  vec2 local = aLocal * uSize;
  vec2 world = iPos + u * local.x + perp * local.y;
  vec2 screen = (world - uCamPos) * uCamZoom;
  vec2 clip = vec2(screen.x / uViewport.x * 2.0 - 1.0, 1.0 - screen.y / uViewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vColor = iColor;
}`;

const BOID_FS = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor, 1.0); }`;

const TRAIL_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
layout(location=1) in vec3 aColor;
uniform float uCamZoom;
uniform vec2 uCamPos;
uniform vec2 uViewport;
out vec3 vColor;
void main() {
  vec2 screen = (aPos - uCamPos) * uCamZoom;
  vec2 clip = vec2(screen.x / uViewport.x * 2.0 - 1.0, 1.0 - screen.y / uViewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vColor = aColor;
}`;

const TRAIL_FS = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
uniform float uAlpha;
void main() { outColor = vec4(vColor * uAlpha, uAlpha); }`;

function must<T>(value: T | null, message: string): T {
  if (value === null) throw new Error(message);
  return value;
}

/** Write hsl (h in deg, s/l in %) as rgb in 0..1 into out[off..off+2]. */
function hslToRgb(h: number, s: number, l: number, out: Float32Array, off: number): void {
  h = ((h % 360) + 360) % 360;
  s *= 0.01;
  l *= 0.01;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) {
    r = c;
    g = x;
  } else if (hp < 2) {
    r = x;
    g = c;
  } else if (hp < 3) {
    g = c;
    b = x;
  } else if (hp < 4) {
    g = x;
    b = c;
  } else if (hp < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const m = l - c / 2;
  out[off] = r + m;
  out[off + 1] = g + m;
  out[off + 2] = b + m;
}

interface ProgramInfo {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

export class WebGLBoidRenderer implements BoidRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private sim: BoidSim;
  private params: BoidsConfig;

  private width = 1;
  private height = 1;

  private boid!: ProgramInfo;
  private trail!: ProgramInfo;

  private geomBuffer!: WebGLBuffer;
  private boidVAO!: WebGLVertexArrayObject;
  private instanceBuffer!: WebGLBuffer;
  private trailVAO!: WebGLVertexArrayObject;
  private trailVertexBuffer!: WebGLBuffer;
  private trailIndexBuffer!: WebGLBuffer;

  // CPU-side scratch, reused across frames.
  private instanceData = new Float32Array(0);
  private trailData = new Float32Array(0);
  private trailIndexData = new Uint32Array(0);
  private tmpRGB = new Float32Array(3);

  private cachedStructureVersion = -1;
  private contextLost = false;

  private onLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
  };
  private onRestored = (): void => {
    this.contextLost = false;
    this.initGL();
    this.cachedStructureVersion = -1; // force buffer rebuild
  };

  constructor(canvas: HTMLCanvasElement, sim: BoidSim, params: BoidsConfig) {
    this.canvas = canvas;
    this.sim = sim;
    this.params = params;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      depth: false,
      stencil: false,
    });
    this.gl = must(gl, "WebGL2 not available");
    canvas.addEventListener("webglcontextlost", this.onLost, false);
    canvas.addEventListener("webglcontextrestored", this.onRestored, false);
    this.initGL();
  }

  private initGL(): void {
    const gl = this.gl;
    this.boid = this.createProgram(BOID_VS, BOID_FS, ["uSize", "uCamZoom", "uCamPos", "uViewport"]);
    this.trail = this.createProgram(TRAIL_VS, TRAIL_FS, ["uCamZoom", "uCamPos", "uViewport", "uAlpha"]);

    // Static unit-triangle geometry (apex, base-left, base-right).
    this.geomBuffer = must(gl.createBuffer(), "geom buffer");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.geomBuffer);
    // prettier-ignore
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0.0, 0.0,
      -1.0, 1 / 3,
      -1.0, -1 / 3,
    ]), gl.STATIC_DRAW);

    // Boid VAO: geometry (divisor 0) + instance attributes (divisor 1).
    this.boidVAO = must(gl.createVertexArray(), "boid VAO");
    this.instanceBuffer = must(gl.createBuffer(), "instance buffer");
    gl.bindVertexArray(this.boidVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.geomBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    const stride = 7 * 4;
    gl.enableVertexAttribArray(1); // iPos
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); // iVel
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 2 * 4);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3); // iColor
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, stride, 4 * 4);
    gl.vertexAttribDivisor(3, 1);

    // Trail VAO: interleaved pos(vec2) + color(vec3), indexed.
    this.trailVAO = must(gl.createVertexArray(), "trail VAO");
    this.trailVertexBuffer = must(gl.createBuffer(), "trail vertex buffer");
    this.trailIndexBuffer = must(gl.createBuffer(), "trail index buffer");
    gl.bindVertexArray(this.trailVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.trailVertexBuffer);
    const tStride = 5 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, tStride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, tStride, 2 * 4);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.trailIndexBuffer);

    gl.bindVertexArray(null);
  }

  private createProgram(vsSrc: string, fsSrc: string, uniformNames: string[]): ProgramInfo {
    const gl = this.gl;
    const vs = this.compileShader(gl.VERTEX_SHADER, vsSrc);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSrc);
    const program = must(gl.createProgram(), "program");
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      throw new Error("Program link failed: " + log);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const name of uniformNames) uniforms[name] = gl.getUniformLocation(program, name);
    return { program, uniforms };
  }

  private compileShader(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const shader = must(gl.createShader(type), "shader");
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error("Shader compile failed: " + log);
    }
    return shader;
  }

  /** (Re)size GPU buffers + rebuild the static trail index buffer. */
  private reallocate(): void {
    const gl = this.gl;
    const sim = this.sim;
    const cap = sim.capacity;
    const tl = sim.trailLen;

    this.instanceData = new Float32Array(cap * 7);
    gl.bindVertexArray(this.boidVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);

    if (tl > 0) {
      this.trailData = new Float32Array(cap * tl * 5);
      // One index run per boid (oldest->newest) + a restart sentinel.
      this.trailIndexData = new Uint32Array(cap * (tl + 1));
      let w = 0;
      for (let i = 0; i < cap; i++) {
        const baseV = i * tl;
        for (let k = 0; k < tl; k++) this.trailIndexData[w++] = baseV + k;
        this.trailIndexData[w++] = RESTART_INDEX;
      }
      gl.bindVertexArray(this.trailVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.trailVertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.trailData.byteLength, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.trailIndexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.trailIndexData, gl.STATIC_DRAW);
    }

    gl.bindVertexArray(null);
    this.cachedStructureVersion = sim.structureVersion;
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  syncBuffers(): void {
    this.cachedStructureVersion = -1;
  }

  render(camera: Camera): void {
    if (this.contextLost) return;
    const gl = this.gl;
    if (this.cachedStructureVersion !== this.sim.structureVersion) this.reallocate();

    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const n = this.sim.count;
    if (n === 0) return;

    if (this.params.drawTrail && this.sim.trailLen > 0) this.drawTrails(camera, n);
    this.drawBoids(camera, n);
  }

  private drawBoids(camera: Camera, n: number): void {
    const gl = this.gl;
    const sim = this.sim;
    const data = this.instanceData;
    const { posX, posY, velX, velY, colH, colS, colL } = sim;

    for (let i = 0; i < n; i++) {
      const o = i * 7;
      data[o] = posX[i];
      data[o + 1] = posY[i];
      data[o + 2] = velX[i];
      data[o + 3] = velY[i];
      hslToRgb(colH[i], colS[i], colL[i], data, o + 4);
    }
    if (this.params.showVision) {
      const vi = this.params.visionBoidIndex;
      if (vi >= 0 && vi < n) {
        const o = vi * 7;
        data[o + 4] = VISION_R;
        data[o + 5] = VISION_G;
        data[o + 6] = VISION_B;
      }
    }

    gl.bindVertexArray(this.boidVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 7);

    const p = this.boid;
    gl.useProgram(p.program);
    gl.uniform1f(p.uniforms.uSize, this.params.boidSize);
    this.setCameraUniforms(p, camera);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, n);
    gl.bindVertexArray(null);
  }

  private drawTrails(camera: Camera, n: number): void {
    const gl = this.gl;
    const sim = this.sim;
    const tl = sim.trailLen;
    const data = this.trailData;
    const { trailX, trailY, trailHead, colH, colS } = sim;
    const tmp = this.tmpRGB;
    const visionIdx = this.params.showVision ? this.params.visionBoidIndex : -1;

    for (let i = 0; i < n; i++) {
      const base = i * tl;
      const head = trailHead[i];
      let r: number;
      let g: number;
      let b: number;
      if (i === visionIdx) {
        r = VISION_R;
        g = VISION_G;
        b = VISION_B;
      } else {
        hslToRgb(colH[i], colS[i], TRAIL_LIGHTNESS, tmp, 0);
        r = tmp[0];
        g = tmp[1];
        b = tmp[2];
      }
      for (let k = 0; k < tl; k++) {
        const slot = (head + k) % tl;
        const v = (base + k) * 5;
        data[v] = trailX[base + slot];
        data[v + 1] = trailY[base + slot];
        data[v + 2] = r;
        data[v + 3] = g;
        data[v + 4] = b;
      }
    }

    gl.bindVertexArray(this.trailVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.trailVertexBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * tl * 5);

    const p = this.trail;
    gl.useProgram(p.program);
    gl.uniform1f(p.uniforms.uAlpha, TRAIL_ALPHA);
    this.setCameraUniforms(p, camera);
    gl.drawElements(gl.LINE_STRIP, n * (tl + 1), gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  private setCameraUniforms(p: ProgramInfo, camera: Camera): void {
    const gl = this.gl;
    gl.uniform1f(p.uniforms.uCamZoom, camera.zoom);
    gl.uniform2f(p.uniforms.uCamPos, camera.x, camera.y);
    gl.uniform2f(p.uniforms.uViewport, this.width, this.height);
  }

  destroy(): void {
    const gl = this.gl;
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    gl.deleteBuffer(this.geomBuffer);
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteBuffer(this.trailVertexBuffer);
    gl.deleteBuffer(this.trailIndexBuffer);
    gl.deleteVertexArray(this.boidVAO);
    gl.deleteVertexArray(this.trailVAO);
    gl.deleteProgram(this.boid.program);
    gl.deleteProgram(this.trail.program);
  }
}
