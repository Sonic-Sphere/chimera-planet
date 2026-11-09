import * as THREE from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { NEUTRAL, restTip } from "../vendor/chimera/src/wasm/engine.ts";
import { VoiceModel } from "../vendor/chimera/src/ui/analysis.ts";
import { sameBody } from "../vendor/chimera/src/ui/body.ts";
import { V } from "../vendor/chimera/src/ui/colors.ts";
import { advanceTrail, mouthWordFade, type Trail } from "../vendor/chimera/src/ui/mouthWords.ts";
import { Anatomy3D } from "../vendor/chimera/src/ui/render/anatomy3d.ts";
import { Glow, label, seg } from "../vendor/chimera/src/ui/render/vector.ts";
import { HEADS, type HeadState } from "./heads.ts";
import type { StageVoice, StageWord } from "./studio/audio.ts";

const RADIUS = 4.6;
const POLE_HEIGHT = RADIUS + 0.63;
const HEAD_SCALE = 0.105;
const FIELD_OF_VIEW = 38.5;
const FACE_FORWARD = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const VIEW = { pressure: false, particles: false, grid: false, calipers: false };

interface Head {
  root: THREE.Group;
  anatomy: Anatomy3D;
  model: VoiceModel | null;
  trail: Trail<StageWord>;
  mouth: THREE.Vector3;
  forward: THREE.Vector3;
}

export class ChorusStage {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, 0.1, 100);
  private readonly resetPosition = new THREE.Vector3(10, 9.9, 17.3);
  private readonly target = new THREE.Vector3(0, 0.45, 0);
  private readonly fog = new THREE.Fog(0x000000, 0, 60);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly canvas = document.createElement("canvas");
  private readonly ctx = this.canvas.getContext("2d", { alpha: false })!;
  private readonly glow = new Glow();
  private readonly controls: TrackballControls;
  private readonly heads: Head[];
  private readonly restArtic: HeadState["artic"];
  private readonly reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  private readonly point = new THREE.Vector3();
  private readonly viewDirection = new THREE.Vector3();
  private readonly screenUp = new THREE.Vector3();
  private readonly lipPoint = new THREE.Vector3();
  private readonly labelPoint = new THREE.Vector3();
  private readonly pointer = new THREE.Vector2();
  private readonly gazePointer = new THREE.Vector2();
  private readonly gaze = { target: new THREE.Vector3(), weight: 0 };
  private pointerInside = false;
  private orbit = false;
  private showWords = false;
  private interacting = false;
  private lastFrame = 0;
  private width = 0;
  private height = 0;
  private dpr = 1;

  constructor(private readonly element: HTMLElement,
    private readonly performanceFrames: (showWords: boolean) => StageVoice[]) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(0x000000, 1);
    this.scene.fog = this.fog;
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("aria-label", "3D chorus. Use arrow keys to orbit and plus or minus to zoom.");
    element.append(this.canvas);

    // The Bongo Chorus trackball, with the camera framed for floating anatomical heads.
    this.camera.position.copy(this.resetPosition);
    this.controls = new TrackballControls(this.camera, this.canvas);
    this.controls.target.copy(this.target);
    this.controls.noPan = true;
    this.controls.minDistance = 9;
    this.controls.maxDistance = 42;
    this.controls.rotateSpeed = 1.6;
    this.controls.staticMoving = true;
    this.controls.keys = ["", "", ""];
    this.controls.addEventListener("start", () => { this.interacting = true; });
    this.controls.addEventListener("end", this.endInteraction);
    this.canvas.addEventListener("keydown", this.moveWithKeys);
    this.canvas.addEventListener("pointermove", this.trackPointer);
    this.canvas.addEventListener("pointerleave", this.clearPointer);
    this.canvas.addEventListener("pointercancel", this.clearPointer);
    this.canvas.addEventListener("lostpointercapture", this.endInteraction);
    window.addEventListener("blur", this.clearPointer);
    this.controls.update();

    this.addGuides();
    const tip = restTip(NEUTRAL.jaw, NEUTRAL.tbX, NEUTRAL.tbY);
    this.restArtic = { ...NEUTRAL, ttX: tip.x, ttY: tip.y };
    this.heads = HEADS.map(({ pole }, index) => {
      const theta = Math.PI / 6 + index * Math.PI / 3;
      const anchor = pole
        ? new THREE.Vector3(0, pole * POLE_HEIGHT, 0)
        : new THREE.Vector3(Math.cos(theta) * RADIUS, 0, Math.sin(theta) * RADIUS);
      const anatomy = new Anatomy3D();
      const root = new THREE.Group();
      root.position.copy(anchor);
      // Chimera's faces point along local +X. Align that axis with the radius, including both poles.
      root.quaternion.setFromUnitVectors(FACE_FORWARD, anchor.normalize());
      root.scale.setScalar(HEAD_SCALE);
      root.add(anatomy.scene);
      this.scene.add(root);

      return { root, anatomy, model: null, trail: { entries: [] }, mouth: new THREE.Vector3(), forward: new THREE.Vector3() };
    });
    new ResizeObserver(() => this.resize()).observe(element);
    this.resize();
    requestAnimationFrame(this.render);
  }

  toggleOrbit(): boolean {
    this.orbit = !this.orbit;
    return this.orbit;
  }

  toggleWords(): boolean {
    this.showWords = !this.showWords;
    if (!this.showWords) for (const head of this.heads) head.trail.entries.length = 0;
    return this.showWords;
  }

  reset(): void {
    this.orbit = false;
    this.controls.update();
    this.controls.reset();
    this.controls.target.copy(this.target);
    this.controls.update();
  }

  private endInteraction = (): void => { this.interacting = false; };

  private trackPointer = (event: PointerEvent): void => {
    if (event.pointerType === "touch") return;
    const bounds = this.canvas.getBoundingClientRect();
    const x = 2 * (event.clientX - bounds.left) / bounds.width - 1;
    const y = 1 - 2 * (event.clientY - bounds.top) / bounds.height;
    this.pointerInside = Math.abs(x) <= 1 && Math.abs(y) <= 1;
    if (this.pointerInside) this.pointer.set(x, y);
  };

  private clearPointer = (): void => { this.pointerInside = false; };

  private addGuides(): void {
    // Keep the original open geodesic guide, using Chimera's dim structural blue.
    const icosahedron = new THREE.IcosahedronGeometry(RADIUS, 2);
    const color = new THREE.Color().setStyle(V.blueDim, THREE.LinearSRGBColorSpace);
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(icosahedron, 1), new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.27, depthWrite: false, fog: false, toneMapped: false,
    }));
    icosahedron.dispose();
    wire.renderOrder = -2;
    this.scene.add(wire);

    const points = Array.from({ length: 96 }, (_, index) => {
      const angle = (index / 96) * Math.PI * 2;
      return new THREE.Vector3(RADIUS * Math.cos(angle), 0, RADIUS * Math.sin(angle));
    });
    const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.36, depthWrite: false, fog: false, toneMapped: false,
    }));
    ring.renderOrder = -1;
    this.scene.add(ring);
  }

  private resize(): void {
    const width = this.element.clientWidth;
    const height = this.element.clientHeight;
    if (width === 0 || height === 0) return;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.canvas.width = this.renderer.domElement.width;
    this.canvas.height = this.renderer.domElement.height;
    this.camera.aspect = width / height;
    // Leave room for both poles when the viewport is narrow or short.
    const framing = Math.max(1, 1 / this.camera.aspect, 350 / height);
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(
      Math.tan(THREE.MathUtils.degToRad(FIELD_OF_VIEW / 2)) * framing,
    ));
    this.camera.updateProjectionMatrix();
    this.controls.handleResize();
    for (const { anatomy } of this.heads) anatomy.resize(width, height);
  }

  private moveWithKeys = (event: KeyboardEvent): void => {
    const offset = this.point.copy(this.camera.position).sub(this.controls.target);
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      offset.applyAxisAngle(Y_AXIS, event.key === "ArrowLeft" ? 0.12 : -0.12);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      const angle = event.key === "ArrowUp" ? -0.12 : 0.12;
      offset.applyAxisAngle(axis, angle);
      this.camera.up.applyAxisAngle(axis, angle);
    } else if (["+", "=", "-"].includes(event.key)) {
      offset.setLength(THREE.MathUtils.clamp(
        offset.length() * (event.key === "-" ? 1.12 : 1 / 1.12),
        this.controls.minDistance, this.controls.maxDistance,
      ));
    } else return;
    event.preventDefault();
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  };

  private projectLabel(point: THREE.Vector3): number {
    point.applyMatrix4(this.camera.matrixWorldInverse);
    const depth = -point.z;
    point.applyMatrix4(this.camera.projectionMatrix);
    point.set((point.x + 1) * this.width / 2, (1 - point.y) * this.height / 2, 0);
    return depth;
  }

  private drawWords(clock: number, focalLength: number): void {
    // Like the original face view, draw camera-facing Hershey text in the glow pass.
    // Here the label positions and sizes come from the animated mouths in the 3D scene.
    this.ctx.save();
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.screenUp.setFromMatrixColumn(this.camera.matrixWorld, 1);
    for (const { trail, mouth, forward } of this.heads) {
      if (!trail.entries.length || this.projectLabel(this.lipPoint.copy(mouth)) <= 0) continue;
      const lip = this.lipPoint;
      const p = this.labelPoint;
      this.projectLabel(p.copy(mouth).addScaledVector(forward, 0.52));
      const dx = p.x - lip.x;
      const dy = p.y - lip.y;
      const align = Math.abs(dx) > Math.max(5, Math.abs(dy) * 0.65) ? (dx > 0 ? "left" : "right") : "center";
      const headOn = Math.hypot(dx, dy) < 11;
      for (const { word, left } of trail.entries) {
        const { age, scale, alpha } = mouthWordFade(left, clock);
        const depth = this.projectLabel(p.copy(mouth).addScaledVector(forward, 0.52 + age * 1.6)
          .addScaledVector(this.screenUp, (headOn ? 0.36 : 0) + age * 1.8));
        if (depth <= this.camera.near) continue;
        const visibility = 1 - THREE.MathUtils.smoothstep(depth, this.fog.near, this.fog.far);
        const size = THREE.MathUtils.clamp(0.46 * focalLength / depth, 13, 44) * scale;
        const color = word.spoken ? V.white : V.green;
        if (left === null) {
          const x = p.x - lip.x, y = p.y - lip.y;
          seg(this.ctx, lip.x + x * 0.24, lip.y + y * 0.24, p.x - x * 0.25, p.y - y * 0.25,
            color, 1, { dash: [2, 5], alpha: visibility * 0.7 });
        }
        label(this.ctx, word.text.toUpperCase(), p.x, p.y, {
          size, color, weight: "m", ls: 0.05, alpha: alpha * visibility, align, baseline: "middle", moving: left !== null,
        });
      }
    }
    this.ctx.restore();
  }

  private render = (now: number): void => {
    requestAnimationFrame(this.render);
    if (this.width === 0 || (this.lastFrame && now - this.lastFrame < 1000 / 45)) return;
    const dt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.075) : 0;
    this.lastFrame = now;
    const allowIdleMotion = !this.reducedMotion.matches;
    const idleDt = allowIdleMotion ? dt : 0;

    if (this.orbit && !this.interacting) {
      const angle = dt * 0.11;
      this.camera.position.sub(this.controls.target).applyAxisAngle(Y_AXIS, angle).add(this.controls.target);
      this.camera.up.applyAxisAngle(Y_AXIS, angle);
    }
    this.controls.update();
    this.camera.getWorldDirection(this.viewDirection);
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.fog.near = Math.max(0, distance - 3);
    this.fog.far = distance + 12;

    // Put the pointer on a plane between the camera and the ensemble so it
    // stays in front of the eyes when the camera orbits or zooms.
    const ease = 1 - Math.exp(-dt * 18);
    this.gaze.weight = THREE.MathUtils.lerp(this.gaze.weight, this.pointerInside && allowIdleMotion ? 1 : 0, ease);
    this.gazePointer.lerp(this.pointer, ease);
    const depth = distance * 0.55;
    const halfHeight = depth * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.camera.localToWorld(this.gaze.target.set(
      this.gazePointer.x * halfHeight * this.camera.aspect, this.gazePointer.y * halfHeight, -depth,
    ));

    const performance = this.performanceFrames(this.showWords);
    const clock = now / 1000;
    this.heads.forEach((head, index) => {
      const tele = performance[index]?.tele ?? null;
      const body = tele?.body ?? HEADS[index].body;
      const artic = tele ? VoiceModel.articFromArray(tele.t.artic) : this.restArtic;
      if (!head.model || !sameBody(head.model.body, body)) {
        head.model?.dispose();
        head.model = new VoiceModel(body, 48000);
        const { target } = head.anatomy.poses(head.model);
        head.anatomy.scene.position.copy(target).negate();
      }
      // A small extra reduction in the rear half reinforces the camera's perspective.
      const rearDepth = head.root.position.dot(this.viewDirection) / POLE_HEIGHT;
      head.root.scale.setScalar(HEAD_SCALE * (1 - 0.07 * Math.max(0, rearDepth)));
      head.root.updateWorldMatrix(true, false);
      head.anatomy.camera.position.copy(this.camera.position);
      head.anatomy.face.update(tele, tele ? dt : idleDt);
      const frame = head.model.frame(artic);
      head.anatomy.update(head.model, frame, artic, tele, VIEW, tele ? dt : idleDt,
        this.gaze.weight > 0.001 ? this.gaze : undefined);
      if (this.showWords) {
        advanceTrail(head.trail, performance[index]?.word ?? null, clock);
        if (head.trail.entries.length) head.anatomy.mouthPose(head.model, frame, artic, head.mouth, head.forward);
      }
    });

    this.renderer.render(this.scene, this.camera);
    this.ctx.drawImage(this.renderer.domElement, 0, 0);
    if (this.showWords) this.drawWords(clock, this.height * this.camera.projectionMatrix.elements[5] / 2);
    this.glow.apply(this.canvas, this.ctx, this.dpr);
  };
}
