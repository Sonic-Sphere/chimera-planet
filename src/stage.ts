import * as THREE from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { NEUTRAL, restTip } from "../vendor/chimera/src/wasm/engine.ts";
import { VoiceModel } from "../vendor/chimera/src/ui/analysis.ts";
import { bodyLabel, sameBody } from "../vendor/chimera/src/ui/body.ts";
import { V } from "../vendor/chimera/src/ui/colors.ts";
import { Anatomy3D } from "../vendor/chimera/src/ui/render/anatomy3d.ts";
import { Glow } from "../vendor/chimera/src/ui/render/vector.ts";
import { HEADS, headNumber, type HeadState } from "./heads.ts";

const RADIUS = 4.6;
const HEAD_SCALE = 0.105;
const FIELD_OF_VIEW = 36;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const VIEW = { pressure: false, particles: false, grid: false, calipers: false };

interface Head {
  anchor: THREE.Vector3;
  root: THREE.Group;
  anatomy: Anatomy3D;
  label: HTMLButtonElement;
  state: HeadState;
  model: VoiceModel | null;
  labelHeight: number;
}

export class ChorusStage {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, 0.1, 100);
  private readonly resetPosition = new THREE.Vector3(0.65, 11.7, 16.9);
  private readonly target = new THREE.Vector3(0, 0.9, 0);
  private readonly fog = new THREE.Fog(0x000000, 0, 60);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly canvas = document.createElement("canvas");
  private readonly ctx = this.canvas.getContext("2d", { alpha: false })!;
  private readonly glow = new Glow();
  private readonly controls: TrackballControls;
  private readonly heads: Head[];
  private readonly reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  private readonly point = new THREE.Vector3();
  private raf: number | null = null;
  private lastFrame = 0;
  private time = 0;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private orbit = false;
  private interacting = false;

  constructor(private readonly element: HTMLElement, openHead: (index: number) => void) {
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
    this.controls.addEventListener("end", () => { this.interacting = false; });
    this.canvas.addEventListener("keydown", this.moveWithKeys);
    this.controls.update();

    this.addGuides();
    const tip = restTip(NEUTRAL.jaw, NEUTRAL.tbX, NEUTRAL.tbY);
    const artic = { ...NEUTRAL, ttX: tip.x, ttY: tip.y };
    this.heads = HEADS.map(({ body, yaw }, index) => {
      const theta = Math.PI / 6 + index * Math.PI / 3;
      const anchor = index === HEADS.length - 1
        ? new THREE.Vector3(0, RADIUS + 0.63, 0)
        : new THREE.Vector3(Math.cos(theta) * RADIUS, 0, Math.sin(theta) * RADIUS);
      const anatomy = new Anatomy3D();
      const root = new THREE.Group();
      root.position.copy(anchor);
      root.rotation.y = THREE.MathUtils.degToRad(yaw);
      root.scale.setScalar(HEAD_SCALE);
      root.add(anatomy.scene);
      this.scene.add(root);

      const label = document.createElement("button");
      label.type = "button";
      label.className = "head-marker";
      label.textContent = headNumber(index);
      label.setAttribute("aria-label", `Open head ${headNumber(index)} controls`);
      label.hidden = true;
      label.onclick = () => openHead(index);
      element.append(label);
      return { anchor, root, anatomy, label, state: { body, artic }, model: null, labelHeight: 1.5 };
    });
    new ResizeObserver(() => this.resize()).observe(element);
    this.resize();
  }

  setHead(index: number, state: HeadState): void {
    this.heads[index].state = state;
  }

  setActive(active: boolean): void {
    if (active && this.raf === null) {
      this.lastFrame = 0;
      this.resize();
      this.raf = requestAnimationFrame(this.render);
    } else if (!active && this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }

  toggleOrbit(): boolean {
    this.orbit = !this.orbit;
    return this.orbit;
  }

  reset(): void {
    this.orbit = false;
    this.controls.reset();
    this.camera.position.copy(this.resetPosition);
    this.camera.up.set(0, 1, 0);
    this.controls.target.copy(this.target);
    this.controls.update();
  }

  private addGuides(): void {
    // Keep the original open geodesic guide, using Chimera's dim structural blue.
    const icosahedron = new THREE.IcosahedronGeometry(RADIUS, 2);
    const color = new THREE.Color().setStyle(V.blueDim, THREE.LinearSRGBColorSpace);
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(icosahedron, 1), new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.13, depthWrite: false, fog: false, toneMapped: false,
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
    // Retain a perspective view and fit the entire ring at narrow widths.
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(
      Math.tan(THREE.MathUtils.degToRad(FIELD_OF_VIEW / 2)) * Math.max(1, 1 / this.camera.aspect),
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

  private render = (now: number): void => {
    this.raf = requestAnimationFrame(this.render);
    if (this.width === 0 || (this.lastFrame && now - this.lastFrame < 1000 / 45)) return;
    const dt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.075) : 0;
    this.lastFrame = now;
    const float = !this.reducedMotion.matches;
    const motion = float ? dt : 0;
    this.time += motion;

    if (this.orbit && !this.interacting) {
      this.camera.position.sub(this.controls.target).applyAxisAngle(Y_AXIS, dt * 0.11).add(this.controls.target);
      this.camera.up.applyAxisAngle(Y_AXIS, dt * 0.11);
    }
    this.controls.update();
    this.camera.updateMatrixWorld();
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.fog.near = Math.max(0, distance - 3);
    this.fog.far = distance + 15;

    this.heads.forEach((head, index) => {
      const { body, artic } = head.state;
      if (!head.model || !sameBody(head.model.body, body)) {
        head.model?.dispose();
        head.model = new VoiceModel(body, 48000);
        const { target } = head.anatomy.poses(head.model);
        head.anatomy.scene.position.copy(target).negate();
        head.labelHeight = 14.2 * head.model.tract.scale * HEAD_SCALE;
        head.label.title = `Head ${headNumber(index)} · ${bodyLabel(body)}`;
      }
      head.root.position.y = head.anchor.y + (float ? 0.13 * Math.sin(this.time * 0.88 + index * 1.77) : 0);
      head.root.updateWorldMatrix(true, false);
      // Chimera uses the viewer's position for the pupils and cutaway. The stage provides it
      // in world space so each renderer can transform it back into its own head.
      head.anatomy.camera.position.copy(this.camera.position);
      head.anatomy.face.update(null, motion);
      head.anatomy.update(head.model, head.model.frame(artic), artic, null, VIEW, motion);

      const overhead = index === this.heads.length - 1;
      const p = this.point.copy(head.root.position);
      p.y += overhead ? head.labelHeight : -head.labelHeight;
      p.project(this.camera);
      head.label.hidden = Math.abs(p.x) > 0.98 || Math.abs(p.y) > 0.97 || Math.abs(p.z) > 1;
      const y = (1 - p.y) * this.height / 2 - (overhead ? 5 : 0);
      head.label.style.transform = `translate(${(p.x + 1) * this.width / 2}px, ${y}px) translate(-50%, ${overhead ? "-100%" : "0"})`;
    });

    this.renderer.render(this.scene, this.camera);
    this.ctx.drawImage(this.renderer.domElement, 0, 0);
    this.glow.apply(this.canvas, this.ctx, this.dpr);
  };
}
