import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { assetURL, disposeModel, json } from "./assets";
import type { Character, PoseSource, StateSource } from "./types";
/** A separate source-art comparison view. It never changes the musical clock. */
export async function inspectArtwork(
  character: Character,
  buildStates: (data: StateSource) => Promise<Record<string, THREE.Group>>,
): Promise<void> {
  const dialog = document.createElement("dialog");
  dialog.className = "art-inspector";
  dialog.innerHTML = `<button class="dialog-close icon-button" aria-label="Close artwork comparison">×</button><span class="eyebrow">ORIGINAL ART COMPARISON</span><h2>${character.displayName}</h2><div class="comparison"><figure><figcaption>Original sprite</figcaption><canvas id="source-art" width="328" height="760"></canvas></figure><figure><figcaption>Smooth extrusion</figcaption><div id="extruded-art"></div></figure></div><div class="inspection-controls"><select id="art-state" aria-label="Visual state"><option value="performance">Performance</option><option value="waiting">Waiting</option><option value="mute">Muted</option></select><button id="previous-frame" aria-label="Previous frame">←</button><input id="art-frame" type="range" min="0" value="0" aria-label="Animation frame"><button id="next-frame" aria-label="Next frame">→</button><output id="frame-label"></output><label>Turn <input id="art-turn" type="range" min="-40" max="40" value="0" aria-label="Turn extrusion"></label></div><p>Step through the complete A + B timeline. The comparison uses the original sheet and discrete source poses. Music keeps its place while you inspect.</p>`;
  document.body.append(dialog);
  dialog.showModal();
  let renderer: THREE.WebGLRenderer | null = null,
    root: THREE.Group | null = null,
    closed = false;
  const close = () => {
    closed = true;
    renderer?.dispose();
    if (root) disposeModel(root);
    dialog.remove();
  };
  dialog.querySelector("button")!.onclick = () => dialog.close();
  dialog.addEventListener("close", close, { once: true });
  const [gltf, poses, states, original, image] = await Promise.all([
    new GLTFLoader().loadAsync(
      assetURL(`extrusions/${character.extrusion.model}`),
    ),
    json<PoseSource>(`extrusions/${character.extrusion.source}`),
    json<StateSource>(`states/${character.id}.json`),
    json<any>(`port/${character.animation}`),
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = assetURL(`port/${character.sprites.full}`);
    }),
  ]);
  if (closed) {
    disposeModel(gltf.scene);
    return;
  }
  const groups = await buildStates(states);
  if (closed) {
    disposeModel(gltf.scene);
    Object.values(groups).forEach(disposeModel);
    return;
  }
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(164, 380);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  dialog.querySelector("#extruded-art")!.append(renderer.domElement);
  const scene = new THREE.Scene(),
    camera = new THREE.OrthographicCamera(
      (-0.16 * 328) / 760 / 2,
      (0.16 * 328) / 760 / 2,
      0.08,
      -0.08,
      0.01,
      10,
    );
  camera.position.z = 1;
  scene.add(new THREE.HemisphereLight(0xfff6e5, 0x3b3840, 3));
  root = new THREE.Group();
  root.add(gltf.scene, groups.waiting);
  const mute = new THREE.Group();
  mute.add(groups.waiting.clone());
  const hidden = groups.hidden;
  hidden.position.z = 0.0005;
  hidden.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.material = (
        Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      ).map((m) => {
        const c = m.clone();
        c.transparent = true;
        c.opacity = 0.7;
        c.depthWrite = false;
        return c;
      });
    }
  });
  mute.add(hidden);
  root.add(mute);
  scene.add(root);
  const frameInput = dialog.querySelector<HTMLInputElement>("#art-frame")!,
    turn = dialog.querySelector<HTMLInputElement>("#art-turn")!,
    state = dialog.querySelector<HTMLSelectElement>("#art-state")!;
  frameInput.max = String(poses.frames.length - 1);
  const head = gltf.scene.getObjectByName("Head")!,
    headPoses = head.children.filter((o) => o.name.startsWith("HeadPose_"));
  for (const pose of headPoses) pose.scale.setScalar(1);
  const canvas = dialog.querySelector<HTMLCanvasElement>("#source-art")!,
    ctx = canvas.getContext("2d")!;
  const draw = () => {
    if (closed || !renderer || !root) return;
    const index = Number(frameInput.value),
      frame = poses.frames[index],
      width = Number(original.width) * 2,
      height = Number(original.height) * 2,
      gap = Number(original.gap ?? 0) * 2;
    ctx.clearRect(0, 0, 328, 760);
    ctx.save();
    ctx.scale(328 / width, 760 / height);
    ctx.globalAlpha = 1;
    if (state.value === "performance") {
      const [sx, sy, dx, dy] = original.arrayFrame[frame.sourceFrame].prop
        .split(",")
        .map((v: string) => parseInt(v, 10));
      ctx.drawImage(
        image,
        width + 2 * gap,
        gap,
        width,
        height,
        0,
        0,
        width,
        height,
      );
      ctx.drawImage(
        image,
        sx * 2,
        sy * 2 + 1,
        width,
        Number(original.headHeight) * 2 - 1,
        dx * 2,
        dy * 2 + 2,
        width,
        Number(original.headHeight) * 2 - 2,
      );
    } else {
      ctx.drawImage(image, gap, gap, width, height, 0, 0, width, height);
      if (state.value === "mute") {
        ctx.globalAlpha = 0.7;
        ctx.drawImage(
          image,
          2 * width + 3 * gap,
          gap,
          width,
          height,
          0,
          0,
          width,
          height,
        );
      }
    }
    ctx.restore();
    gltf.scene.visible = state.value === "performance";
    groups.waiting.visible = state.value === "waiting";
    mute.visible = state.value === "mute";
    for (const pose of headPoses)
      pose.visible = pose.name === `HeadPose_${frame.head}`;
    head.position.set(
      frame.offset[0] * 2 * poses.unitsPerPixel,
      ((poses.sourceCanvas[1] - poses.heads[frame.head].renderHeight) / 2) *
        poses.unitsPerPixel -
        frame.offset[1] * 2 * poses.unitsPerPixel,
      poses.headLayerOffset,
    );
    root.rotation.y = (Number(turn.value) * Math.PI) / 180;
    renderer.render(scene, camera);
    dialog.querySelector("output")!.textContent =
      `${index + 1} / ${poses.frames.length} · ${index < poses.frames.length / 2 ? "A" : "B"} · source ${frame.sourceFrame}`;
  };
  frameInput.oninput = turn.oninput = state.onchange = draw;
  dialog.querySelector<HTMLButtonElement>("#previous-frame")!.onclick = () => {
    frameInput.value = String(
      (Number(frameInput.value) - 1 + poses.frames.length) %
        poses.frames.length,
    );
    draw();
  };
  dialog.querySelector<HTMLButtonElement>("#next-frame")!.onclick = () => {
    frameInput.value = String(
      (Number(frameInput.value) + 1) % poses.frames.length,
    );
    draw();
  };
  draw();
}
