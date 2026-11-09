import * as THREE from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { assetURL, disposeModel, json } from "./assets";
import { animationFrame } from "./compatibility";
import type { Engine } from "./engine";
import type { PoseSource, StatePart, StateSource } from "./types";
export interface Performer {
  root: THREE.Group;
  performance: THREE.Object3D;
  head: THREE.Object3D;
  poses: THREE.Object3D[];
  timeline: PoseSource;
  waiting: THREE.Group;
  muted: THREE.Group;
  created: number;
  frame: number;
  part: string;
}
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 100);
  readonly controls: TrackballControls;
  slowOrbit = false;
  private interacting = false;
  private roots: THREE.Group[] = [];
  private idles: THREE.Group[] = [];
  private performers = new Map<number, Performer>();
  private bank = new Map<string, Performer>();
  retainForReplay = false;
  private parked = new Map<string, Performer>();
  private retiring: {
    root: THREE.Group;
    start: number;
    scale: THREE.Vector3;
  }[] = [];
  private labels: HTMLElement[] = [];
  private positions: THREE.Vector3[] = [];
  private selected = -1;
  frameTimes: number[] = [];
  private previous = 0;
  private progress: HTMLElement;
  private hovering = -1;
  private pointer = new THREE.Vector2();
  private width = 1;
  private height = 1;
  private resetPosition = new THREE.Vector3(3.5, 7.4, 9.6);
  private fadeMaterials = new WeakMap<
    THREE.Object3D,
    { material: THREE.Material; opacity: number }[]
  >();
  private fades = Array<number>(7).fill(1);
  private renderBound = () => this.render();
  onSelect = (_index: number): void => {};
  onDrop = (_index: number, _part: string): void => {};
  onMove = (_from: number, _to: number): void => {};
  onFrame = (): void => {};
  constructor(
    private element: HTMLElement,
    private engine: Engine,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    element.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    this.camera.position.copy(this.resetPosition);
    this.camera.lookAt(0, 1, 0);
    this.camera.near = 0.1;
    this.camera.far = 100;
    this.camera.zoom = 1;
    this.controls = new TrackballControls(
      this.camera,
      this.renderer.domElement,
    );
    this.controls.target.set(0, 1, 0);
    this.controls.noPan = true;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 36;
    this.controls.rotateSpeed = 1.8;
    this.controls.staticMoving = true;
    this.controls.keys = ["", "", ""];
    this.controls.addEventListener("start", () => {
      this.interacting = true;
    });
    this.controls.addEventListener("end", () => {
      this.interacting = false;
    });
    this.scene.add(new THREE.HemisphereLight(0xfff1ce, 0x463c58, 2));
    const light = new THREE.DirectionalLight(0xffe4ac, 3);
    light.position.set(-3, 8, 8);
    this.scene.add(light);
    element.addEventListener("pointermove", (e) => {
      const rect = element.getBoundingClientRect();
      this.pointer.set(e.clientX - rect.left, e.clientY - rect.top);
    });
    this.guides();
    for (let i = 0; i < 7; i++) {
      const theta = Math.PI / 6 + ((i % 6) * Math.PI) / 3;
      const pos =
        i === 6
          ? new THREE.Vector3(0, 4.6, 0)
          : new THREE.Vector3(Math.cos(theta) * 4.6, 0, Math.sin(theta) * 4.6);
      this.positions.push(pos);
      const root = new THREE.Group();
      root.position.copy(pos);
      root.scale.z = 0.15; // Present original artwork as flat camera-facing cards.
      this.roots.push(root);
      this.scene.add(root);
      const button = document.createElement("button");
      button.className = "slot-target";
      button.dataset.slot = String(i);
      button.setAttribute(
        "aria-label",
        `Assign a sound to ${i === 6 ? "overhead performer" : "performer " + (i + 1)}`,
      );
      button.addEventListener("click", () => this.onSelect(i));
      button.addEventListener("pointerenter", () => {
        this.hovering = i;
      });
      button.addEventListener("pointerleave", () => {
        this.hovering = -1;
      });
      button.addEventListener("dragover", (e) => {
        e.preventDefault();
        button.classList.add("drop-target");
      });
      button.addEventListener("dragleave", () =>
        button.classList.remove("drop-target"),
      );
      button.addEventListener("drop", (e) => {
        e.preventDefault();
        button.classList.remove("drop-target");
        const from = e.dataTransfer?.getData("application/x-bongo-performer");
        if (from !== undefined && from !== "") {
          this.onMove(Number(from), i);
          return;
        }
        const part = e.dataTransfer?.getData("text/plain");
        if (part) this.onDrop(i, part);
      });
      element.append(button);
      this.labels.push(button);
    }
    this.progress = document.querySelector("#phase-progress")!;
    new ResizeObserver(() => this.resize()).observe(element);
    this.resize();
    requestAnimationFrame(this.renderBound);
  }
  private guides(): void {
    const mist = new THREE.Mesh(
      new THREE.IcosahedronGeometry(4.58, 4),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { tint: { value: new THREE.Color("#939da7") } },
        vertexShader: `varying vec3 n; varying vec3 eye;
          void main() { vec4 p = modelViewMatrix * vec4(position, 1.0);
            n = normalize(normalMatrix * normal); eye = -p.xyz;
            gl_Position = projectionMatrix * p; }`,
        fragmentShader: `uniform vec3 tint; varying vec3 n; varying vec3 eye;
          void main() { float facing = abs(dot(normalize(n), normalize(eye)));
            float rim = pow(1.0 - facing, 2.5);
            float light = 0.78 + 0.22 * max(0.0, dot(normalize(n), normalize(vec3(-0.5, 0.8, 1.0))));
            gl_FragColor = vec4(tint * light, 0.075 + rim * 0.14); }`,
      }),
    );
    mist.name = "sphere-atmosphere";
    mist.renderOrder = -2;
    this.scene.add(mist);
    const geodesic = new THREE.IcosahedronGeometry(4.6, 2);
    const edges = new THREE.EdgesGeometry(geodesic, 1);
    geodesic.dispose();
    const grid = new THREE.LineSegments(
      edges,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        vertexShader: `varying float facing;
        void main() { vec4 p = modelViewMatrix * vec4(position, 1.0);
          vec3 n = normalize(normalMatrix * normalize(position));
          facing = dot(n, normalize(-p.xyz)); gl_Position = projectionMatrix * p; }`,
        fragmentShader: `varying float facing;
        void main() { gl_FragColor = vec4(vec3(0.76, 0.80, 0.84), 0.055 + 0.17 * max(0.0, facing)); }`,
      }),
    );
    grid.name = "geodesic-grid";
    grid.renderOrder = -1;
    this.scene.add(grid);
  }
  private mesh(
    part: StatePart,
    source: StateSource,
    texture: THREE.Texture,
  ): THREE.Group {
    const unit = source.unitsPerPixel,
      ratio = part.renderHeight / part.height;
    const point = ([x, y]: [number, number]) =>
      new THREE.Vector2(
        (x - part.width / 2) * unit,
        (part.renderHeight / 2 - y * ratio) * unit,
      );
    const shapes = part.shapes.map((s) => {
      const sh = new THREE.Shape(s.outer.map(point));
      for (const hole of s.holes)
        sh.holes.push(new THREE.Path(hole.map(point)));
      return sh;
    });
    const geo = new THREE.ExtrudeGeometry(shapes, {
      depth: source.depth,
      steps: 1,
      bevelEnabled: false,
      curveSegments: 1,
    });
    geo.translate(0, 0, 0.005);
    const p = geo.attributes.position,
      uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++)
      uv.setXY(
        i,
        (p.getX(i) / unit + part.width / 2 + part.crop[0]) /
          source.sheetSize[0],
        ((part.renderHeight / 2 - p.getY(i) / unit) / ratio + part.crop[1]) /
          source.sheetSize[1],
      );
    const front = new THREE.MeshBasicMaterial({
      map: texture,
      alphaTest: 0.1,
      side: THREE.DoubleSide,
    });
    const edge = new THREE.MeshStandardMaterial({
      color: 0x17131b,
      roughness: 0.8,
    });
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geo, [front, edge]));
    return group;
  }
  private async stateGroups(
    data: StateSource,
  ): Promise<Record<string, THREE.Group>> {
    const texture = await new THREE.TextureLoader().loadAsync(
      assetURL(data.sheet),
    );
    texture.flipY = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(
      8,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    return Object.fromEntries(
      Object.entries(data.parts).map(([key, p]) => [
        key,
        this.mesh(p, data, texture),
      ]),
    );
  }
  comparisonStates(data: StateSource): Promise<Record<string, THREE.Group>> {
    return this.stateGroups(data);
  }
  async initialize(): Promise<void> {
    const data = await json<StateSource>("states/idle.json"),
      groups = await this.stateGroups(data);
    // Geometry/textures remain shared; opacity belongs to each individual performer.
    for (let i = 0; i < 7; i++) {
      const idle = new THREE.Group();
      const body = groups.body.clone();
      idle.add(body);
      for (let j = 0; j < 12; j++) {
        const eye = groups[`eyes${j}`].clone();
        eye.name = `eyes${j}`;
        eye.position.set(
          0,
          ((800 - 80) / 2) * data.unitsPerPixel - 194 * data.unitsPerPixel,
          0.0004,
        );
        eye.visible = j === 0;
        idle.add(eye);
      }
      const shade = groups.shade.clone();
      shade.name = "shade";
      shade.position.z = 0.0008;
      shade.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          const mesh = o as THREE.Mesh;
          mesh.material = (mesh.material as THREE.Material[]).map((m) => {
            const c = m.clone();
            c.transparent = true;
            c.opacity = 0.5;
            c.depthWrite = false;
            return c;
          });
        }
      });
      idle.add(shade);
      for (let j = 0; j < 4; j++) {
        const lid = groups[`lid${j}`].clone();
        lid.name = `lid${j}`;
        lid.position.set(
          0,
          ((800 - 80) / 2) * data.unitsPerPixel - 194 * data.unitsPerPixel,
          0.0004,
        );
        lid.visible = false;
        idle.add(lid);
      }
      for (let j = 0; j < 2; j++) {
        const pupil = groups.pupil.clone();
        pupil.name = `pupil${j}`;
        pupil.position.set(
          ((j ? 190 : 108) + 16 - 164) * data.unitsPerPixel,
          (400 - 220 - 16) * data.unitsPerPixel,
          0.0003,
        );
        pupil.visible = false;
        idle.add(pupil);
      }
      idle.scale.setScalar(16.0);
      this.prepareFade(idle, true);
      this.roots[i].add(idle);
      this.idles.push(idle);
    }
  }
  reuse(index: number, part: string): boolean {
    const p = this.parked.get(part);
    if (!p) return false;
    this.unmount(index, false);
    this.parked.delete(part);
    this.performers.set(index, p);
    this.roots[index].add(p.root);
    this.idles[index].visible = false;
    return true;
  }
  releaseRetained(): void {
    this.retainForReplay = false;
    for (const p of this.parked.values())
      if (this.bank.get(p.part) !== p) disposeModel(p.root);
    this.parked.clear();
  }
  async mount(
    index: number,
    part: string,
    gltf: GLTF,
    poses: PoseSource,
    states: StateSource,
    valid: () => boolean,
  ): Promise<boolean> {
    const prepared = await this.prepare(part, gltf, poses, states);
    if (!valid()) {
      disposeModel(prepared.root);
      return false;
    }
    this.attach(index, prepared);
    return true;
  }
  async prepare(
    part: string,
    gltf: GLTF,
    poses: PoseSource,
    states: StateSource,
  ): Promise<Performer> {
    let groups: Record<string, THREE.Group>;
    try { groups = await this.stateGroups(states); }
    catch (error) { disposeModel(gltf.scene); throw error; }
    const root = new THREE.Group();
    root.scale.setScalar(16.0);
    root.add(gltf.scene, groups.waiting);
    const muted = new THREE.Group();
    muted.add(groups.waiting.clone());
    const overlay = groups.hidden;
    overlay.position.z = 0.0005;
    overlay.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const mats = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        mesh.material = mats.map((m) => {
          const clone = m.clone();
          clone.transparent = true;
          clone.opacity = 0.7;
          clone.depthWrite = false;
          return clone;
        });
      }
    });
    muted.add(overlay);
    root.add(muted);
    const head = gltf.scene.getObjectByName("Head")!;
    const headPoses = head.children.filter((o) =>
      o.name.startsWith("HeadPose_"),
    );
    for (const pose of headPoses) pose.scale.setScalar(1);
    const performer: Performer = {
      root,
      performance: gltf.scene,
      head,
      poses: headPoses,
      timeline: poses,
      waiting: groups.waiting,
      muted,
      created: this.engine.now,
      frame: -1,
      part,
    };
    this.prepareFade(root);
    return performer;
  }
  async warmGraphics(bank: Map<string, Performer>): Promise<void> {
    // Upload every pose and state before interaction, including initially hidden meshes.
    const warmScene = new THREE.Scene();
    const visibility = new Map<THREE.Object3D, boolean>();
    const culling = new Map<THREE.Object3D, boolean>();
    for (const p of bank.values()) {
      warmScene.add(p.root);
      p.root.traverse((o) => {
        visibility.set(o, o.visible);
        o.visible = true;
        culling.set(o, o.frustumCulled);
        o.frustumCulled = false;
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh)
          for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
            for (const value of Object.values(m))
              if (value?.isTexture) this.renderer.initTexture(value);
      });
    }
    for (const child of this.scene.children)
      if ((child as THREE.Light).isLight) warmScene.add(child.clone());
    try {
      await this.renderer.compileAsync(warmScene, this.camera);
      this.renderer.render(warmScene, this.camera);
    } finally {
      for (const [o, visible] of visibility) o.visible = visible;
      for (const [o, culled] of culling) o.frustumCulled = culled;
      for (const p of bank.values()) warmScene.remove(p.root);
    }
  }
  useBank(bank: Map<string, Performer>): void {
    this.bank = bank;
  }
  activate(index: number, part: string): boolean {
    const p = this.bank.get(part);
    if (!p) return false;
    this.attach(index, p);
    return true;
  }
  private attach(index: number, p: Performer): void {
    this.unmount(index, false);
    this.retiring = this.retiring.filter((r) => r.root !== p.root);
    this.parked.delete(p.part);
    p.root.removeFromParent();
    p.root.position.set(0, 0, 0);
    p.root.quaternion.identity();
    p.root.scale.setScalar(16);
    p.created = this.engine.now;
    p.frame = -1;
    this.performers.set(index, p);
    this.roots[index].add(p.root);
    this.idles[index].visible = false;
  }
  disposeBank(bank: Map<string, Performer>): void {
    const roots = new Set([...bank.values()].map((p) => p.root));
    this.retiring = this.retiring.filter((r) => {
      if (!roots.has(r.root)) return true;
      r.root.removeFromParent();
      return false;
    });
    for (const p of bank.values()) { p.root.removeFromParent(); disposeModel(p.root); }
    bank.clear();
  }
  unmount(index: number, animate = true): void {
    const p = this.performers.get(index);
    if (p) {
      if (this.retainForReplay) {
        this.roots[index].remove(p.root);
        this.parked.set(p.part, p);
      } else if (animate) {
        // Retain its displayed size/orientation as it leaves, including depth exaggeration.
        this.scene.attach(p.root);
        this.retiring.push({
          root: p.root,
          start: performance.now(),
          scale: p.root.scale.clone(),
        });
      } else {
        this.roots[index].remove(p.root);
        if (this.bank.get(p.part) !== p) disposeModel(p.root);
      }
      this.performers.delete(index);
    }
    if (this.idles[index]) this.idles[index].visible = true;
  }
  select(index: number): void {
    this.selected = index;
  }
  move(from: number, to: number): void {
    if (
      from === to ||
      !this.roots[from] ||
      !this.roots[to] ||
      !this.engine.slots[from].ready
    )
      return;
    // Exchange spatial anchors, preserving logical voices, gain state and native phrase offsets.
    [this.positions[from], this.positions[to]] = [
      this.positions[to],
      this.positions[from],
    ];
    this.roots[from].position.copy(this.positions[from]);
    this.roots[to].position.copy(this.positions[to]);
    this.select(from);
  }
  setTheme(color: string): void {
    const mist = this.scene.getObjectByName("sphere-atmosphere") as THREE.Mesh<
      THREE.IcosahedronGeometry,
      THREE.ShaderMaterial
    >;
    mist.material.uniforms.tint.value
      .set(color)
      .lerp(new THREE.Color("#c6d1db"), 0.6);
  }
  private prepareFade(root: THREE.Object3D, clone = false): void {
    const owned = new Map<THREE.Material, THREE.Material>();
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      const mapped = materials.map((material) => {
        if (!owned.has(material))
          owned.set(material, clone ? material.clone() : material);
        return owned.get(material)!;
      });
      mesh.material = Array.isArray(mesh.material) ? mapped : mapped[0];
    });
    this.fadeMaterials.set(
      root,
      [...owned.values()].map((material) => {
        material.transparent = true;
        return { material, opacity: material.opacity };
      }),
    );
  }
  private fade(root: THREE.Object3D, opacity: number): void {
    for (const entry of this.fadeMaterials.get(root) ?? [])
      entry.material.opacity = entry.opacity * opacity;
  }
  zoom(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(
      THREE.MathUtils.clamp(
        offset.length() / factor,
        this.controls.minDistance,
        this.controls.maxDistance,
      ),
    );
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }
  reset(): void {
    this.controls.reset();
    this.camera.position.copy(this.resetPosition);
    this.camera.up.set(0, 1, 0);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 1, 0);
    this.controls.update();
  }
  private resize(): void {
    this.width = this.element.clientWidth;
    this.height = this.element.clientHeight;
    this.renderer.setSize(this.width, this.height);
    const aspect = this.width / Math.max(1, this.height);
    this.camera.aspect = aspect;
    // Keep a full ensemble in narrow viewports while retaining a true perspective projection.
    this.camera.fov = THREE.MathUtils.radToDeg(
      2 *
        Math.atan(
          Math.tan(THREE.MathUtils.degToRad(58 / 2)) * Math.max(1, 1 / aspect),
        ),
    );
    this.camera.updateProjectionMatrix();
    this.controls.handleResize();
  }
  private render(): void {
    const now = performance.now();
    if (this.previous) {
      this.frameTimes.push(now - this.previous);
      if (this.frameTimes.length > 36000) this.frameTimes.shift();
    }
    const delta = this.previous
      ? Math.min(0.1, (now - this.previous) / 1000)
      : 0;
    this.previous = now;
    if (this.slowOrbit && !this.interacting) {
      const axis = new THREE.Vector3(0, 1, 0),
        angle = delta * 0.065;
      this.camera.position
        .sub(this.controls.target)
        .applyAxisAngle(axis, angle)
        .add(this.controls.target);
      this.camera.up.applyAxisAngle(axis, angle);
    }
    this.controls.update();
    const engine = this.engine,
      phase = engine.displayPhase,
      parity = engine.parity(engine.displayPhase),
      phaseFrame = animationFrame(
        engine.presentationNow - engine.time(phase),
        engine.edition,
      );
    const cycle =
      phaseFrame + parity * engine.edition.timing.animationFramesPerPhase;
    this.camera.updateMatrixWorld();
    const depths = this.roots.map(
      (root) =>
        -root.position.clone().applyMatrix4(this.camera.matrixWorldInverse).z,
    );
    const near = Math.min(...depths),
      far = Math.max(...depths);
    const order = depths
      .map((depth, slot) => ({ depth, slot }))
      .sort((a, b) => b.depth - a.depth);
    for (let i = 0; i < 7; i++) {
      const root = this.roots[i],
        slot = engine.slots[i],
        p = this.performers.get(i);
      root.quaternion.copy(this.camera.quaternion);
      const distance =
        far - near > 0.01 ? (depths[i] - near) / (far - near) : 0;
      const smooth = distance * distance * (3 - 2 * distance);
      const opacity = 1 - 0.72 * smooth;
      const size = 1.25 - 0.4 * smooth;
      root.scale.set(size, size, 0.15);
      this.fades[i] = opacity;
      root.renderOrder = order.findIndex((entry) => entry.slot === i);
      this.fade(this.idles[i], opacity);
      if (p) this.fade(p.root, opacity);
      const label = this.labels[i],
        point = root.position.clone().project(this.camera),
        top = new THREE.Vector3(0, 1.34 * size, 0)
          .applyQuaternion(root.quaternion)
          .add(root.position)
          .project(this.camera),
        bottom = new THREE.Vector3(0, -1.34 * size, 0)
          .applyQuaternion(root.quaternion)
          .add(root.position)
          .project(this.camera);
      label.style.left = `${((point.x + 1) / 2) * this.width}px`;
      label.style.top = `${((bottom.y * -1 + 1) / 2) * this.height}px`;
      label.style.setProperty(
        "--hit-height",
        `${Math.max(36, ((top.y - bottom.y) * this.height) / 2)}px`,
      );
      label.style.zIndex = String(20 + root.renderOrder);
      label.hidden = depths[i] < this.camera.near || point.z > 1;
      label.dataset.depth = depths[i].toFixed(3);
      label.dataset.opacity = opacity.toFixed(3);
      label.draggable = false;
      label.dataset.dressed = String(
        !!slot.part && slot.ready && slot.removing === null,
      );
      label.dataset.part = slot.part ?? "";
      label.classList.toggle("selected", i === this.selected);
      label.classList.toggle("occupied", !!slot.part);
      label.classList.toggle(
        "waiting",
        !!slot.part && (!slot.ready || (engine.running && phase < slot.joined)),
      );
      const state = !slot.part
        ? "Add sound"
        : !slot.ready
          ? "Loading…"
          : slot.removing !== null
            ? "Leaving…"
            : !engine.running
              ? "Ready"
              : phase < slot.joined
                ? "Waiting"
                : slot.solo
                  ? "Solo"
                  : slot.muted
                    ? "Muted"
                    : "Playing";
      label.setAttribute(
        "aria-label",
        `Performer ${i + 1}, ${state}${p ? ", " + p.part : ""}`,
      );
      if (p && slot.part !== p.part) {
        this.unmount(i);
        continue;
      }
      if (p) {
        const playing =
          engine.running &&
          engine.presentationNow >= engine.epoch &&
          phase >= slot.joined &&
          !engine.bonusVisible;
        p.performance.visible = playing && !slot.muted;
        p.waiting.visible = !playing && !slot.muted;
        p.muted.visible = slot.muted;
        if (playing && !slot.muted) {
          const frame =
            p.timeline.frames[Math.min(p.timeline.frames.length - 1, cycle)];
          if (cycle !== p.frame) {
            p.frame = cycle;
            for (const pose of p.poses)
              pose.visible = pose.name === `HeadPose_${frame.head}`;
            p.head.position.set(
              frame.offset[0] * 2 * p.timeline.unitsPerPixel,
              ((p.timeline.sourceCanvas[1] -
                p.timeline.heads[frame.head].renderHeight) /
                2) *
                p.timeline.unitsPerPixel -
                frame.offset[1] * 2 * p.timeline.unitsPerPixel,
              p.timeline.headLayerOffset,
            );
          }
        }
        const age = engine.now - p.created;
        if (age < 0.3) {
          p.root.position.y = Math.sin(Math.min(1, age / 0.3) * Math.PI) * 0.08;
        } else p.root.position.y = 0;
      }
      if (!p && this.idles[i]) {
        const patterns = [
          [0, 1, 2, 2, 1, 0],
          [0, 3, 4, 5, 6, 7, 8, 0],
          [0, 3, 4, 4, 3, 0],
          [
            0, 1, 2, 2, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 10, 10, 10, 10, 10, 10,
            10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 1, 2, 2, 2, 2, 0,
          ],
          [
            0, 1, 2, 2, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 1, 2, 2, 9, 9,
            9, 9, 9, 2, 2, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9,
            0,
          ],
          [
            0, 1, 2, 2, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 2, 2, 2, 10, 10, 10,
            10, 10, 10, 10, 10, 10, 1, 2, 2, 10, 10, 10, 10, 10, 2, 2, 0,
          ],
        ];
        const clock = now + i * 617,
          pattern = patterns[Math.floor(clock / 4700) % patterns.length],
          eye = pattern[Math.floor((clock % 4700) / 36)] ?? 0,
          hover = this.hovering === i;
        const top = new THREE.Vector3(0, 1.28 * size, 0)
            .applyQuaternion(root.quaternion)
            .add(root.position)
            .project(this.camera),
          scale =
            (this.height * size) /
            (2 *
              depths[i] *
              Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))),
          relativeY =
            (this.pointer.y - ((1 - top.y) / 2) * this.height) /
            (scale * 16.0 * (0.16 / 800)),
          lid =
            relativeY < 180
              ? 3
              : relativeY < 260
                ? 2
                : relativeY >= 340
                  ? 1
                  : 0;
        for (const child of this.idles[i].children) {
          if (child.name.startsWith("eyes"))
            child.visible = !hover && child.name === `eyes${eye}`;
          if (child.name === "shade") child.visible = !hover;
          if (child.name.startsWith("lid"))
            child.visible = hover && child.name === `lid${lid}`;
          if (child.name.startsWith("pupil")) {
            child.visible = hover;
            const j = Number(child.name.at(-1)),
              base = new THREE.Vector3(
                ((j ? 190 : 108) + 16 - 164) * (0.16 / 800),
                (400 - 220 - 16) * (0.16 / 800),
                0.0003,
              ),
              screen = base
                .clone()
                .multiplyScalar(16.0 * size)
                .applyQuaternion(root.quaternion)
                .add(root.position)
                .project(this.camera),
              angle = Math.atan2(
                this.pointer.y - ((1 - screen.y) / 2) * this.height,
                this.pointer.x - ((1 + screen.x) / 2) * this.width,
              );
            child.position.set(
              base.x + 14 * (0.16 / 800) * Math.cos(angle),
              base.y - 14 * (0.16 / 800) * Math.sin(angle),
              base.z,
            );
          }
        }
      }
    }
    for (const r of [...this.retiring]) {
      const t = (now - r.start) / 300;
      r.root.position.y -= t * t * 0.08;
      r.root.scale.copy(r.scale).multiplyScalar(1 - Math.min(0.99, t) * 0.15);
      if (t >= 1) {
        this.scene.remove(r.root);
        if (![...this.bank.values()].some((p) => p.root === r.root)) disposeModel(r.root);
        this.retiring = this.retiring.filter((x) => x !== r);
      }
    }
    this.progress.style.setProperty(
      "--progress",
      String(engine.displayProgress),
    );
    this.renderer.render(this.scene, this.camera);
    this.onFrame();
    requestAnimationFrame(this.renderBound);
  }
  bounds(): Record<string, unknown>[] {
    return this.roots.map((root, slot) => {
      root.updateWorldMatrix(true, true);
      const corners: THREE.Vector3[] = [];
      root.traverseVisible((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox!;
        // Project each mesh's own corners; a world-axis box overstates tilted card bounds.
        for (const x of [box.min.x, box.max.x])
          for (const y of [box.min.y, box.max.y])
            for (const z of [box.min.z, box.max.z])
              corners.push(
                new THREE.Vector3(x, y, z)
                  .applyMatrix4(mesh.matrixWorld)
                  .project(this.camera),
              );
      });
      if (!corners.length)
        corners.push(root.position.clone().project(this.camera));
      return {
        slot,
        left: Math.min(...corners.map((p) => ((p.x + 1) / 2) * this.width)),
        right: Math.max(...corners.map((p) => ((p.x + 1) / 2) * this.width)),
        top: Math.min(...corners.map((p) => ((1 - p.y) / 2) * this.height)),
        bottom: Math.max(...corners.map((p) => ((1 - p.y) / 2) * this.height)),
      };
    });
  }
  metrics(): Record<string, unknown> {
    const times = this.frameTimes.slice().sort((a, b) => a - b);
    return {
      frames: times.length,
      p95: times[Math.floor(times.length * 0.95)],
      textures: this.renderer.info.memory.textures,
      geometries: this.renderer.info.memory.geometries,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      camera: {
        projection: "perspective",
        fov: this.camera.fov,
        position: this.camera.position.toArray(),
        up: this.camera.up.toArray(),
        zoom: this.camera.zoom,
        slowOrbit: this.slowOrbit,
      },
      opacity: this.fades,
      anchors: this.positions.map((p) => p.toArray()),
      geodesicEdges:
        (
          this.scene.getObjectByName("geodesic-grid") as THREE.LineSegments
        ).geometry.getAttribute("position").count / 2,
      bounds: this.bounds(),
      performers: [...this.performers].map(([slot, p]) => ({
        slot,
        part: p.part,
        frame: p.frame,
        head: p.poses.filter((h) => h.visible).map((h) => h.name),
        position: p.head.position.toArray(),
      })),
    };
  }
}
