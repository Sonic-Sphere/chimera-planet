import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import type { Character, PoseSource, StateSource } from "./types";
export const assetURL = (path: string): string =>
  `${import.meta.env?.BASE_URL ?? "/"}local-assets/${path}`;
export async function json<T>(path: string): Promise<T> {
  const r = await fetch(assetURL(path));
  if (!r.ok) throw new Error(`Missing local asset: ${path}`);
  return r.json();
}
export class Assets {
  readonly buffers = new Map<string, AudioBuffer>();
  private audioLoads = new Map<string, Promise<AudioBuffer>>();
  private heldSounds = new Map<string, number>();
  private loader = new GLTFLoader();
  async sound(context: BaseAudioContext, path: string): Promise<AudioBuffer> {
    const cached = this.buffers.get(path);
    if (cached) return cached;
    let p = this.audioLoads.get(path);
    if (!p) {
      p = (async () => {
        const r = await fetch(assetURL(`port/${path}`));
        if (!r.ok) throw new Error(`Sound unavailable: ${path}`);
        const b = await context.decodeAudioData(await r.arrayBuffer());
        this.buffers.set(path, b);
        return b;
      })();
      this.audioLoads.set(path, p);
    }
    try {
      return await p;
    } finally {
      this.audioLoads.delete(path);
    }
  }
  async performer(
    c: Character,
    context: BaseAudioContext,
  ): Promise<{ gltf: GLTF; poses: PoseSource; states: StateSource }> {
    // All dependencies settle before propagating a failure so an orphan GLB is disposed.
    const results = await Promise.allSettled([
      this.loader.loadAsync(assetURL(`extrusions/${c.extrusion.model}`)),
      json<PoseSource>(`extrusions/${c.extrusion.source}`),
      json<StateSource>(`states/${c.id}.json`),
      this.sound(context, c.music.a),
      this.sound(context, c.music.b ?? c.music.a),
    ]);
    const error = results.find((r) => r.status === "rejected");
    if (error) {
      if (results[0].status === "fulfilled")
        disposeModel(results[0].value.scene);
      throw (error as PromiseRejectedResult).reason;
    }
    return {
      gltf: (results[0] as PromiseFulfilledResult<GLTF>).value,
      poses: (results[1] as PromiseFulfilledResult<PoseSource>).value,
      states: (results[2] as PromiseFulfilledResult<StateSource>).value,
    };
  }
  retainSounds(paths: string[]): () => void {
    const unique = new Set(paths);
    for (const path of unique)
      this.heldSounds.set(path, (this.heldSounds.get(path) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const path of unique) {
        const remaining = (this.heldSounds.get(path) ?? 1) - 1;
        if (remaining) this.heldSounds.set(path, remaining);
        else this.heldSounds.delete(path);
      }
    };
  }
  prune(paths: Set<string>): void {
    for (const key of this.buffers.keys())
      if (!paths.has(key) && !this.heldSounds.has(key))
        this.buffers.delete(key);
  }
  get bytes(): number {
    return [...this.buffers.values()].reduce(
      (n, b) => n + b.length * b.numberOfChannels * 4,
      0,
    );
  }
}
export function disposeModel(root: import("three").Object3D): void {
  const geometries = new Set<import("three").BufferGeometry>(),
    materials = new Set<import("three").Material>(),
    textures = new Set<import("three").Texture>();
  root.traverse((o) => {
    const mesh = o as import("three").Mesh;
    if (mesh.isMesh) {
      geometries.add(mesh.geometry);
      for (const m of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]) {
        materials.add(m);
        for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
      }
    }
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
  for (const t of textures) {
    t.dispose();
    const image = t.image as ImageBitmap;
    if (image?.close) image.close();
  }
}
