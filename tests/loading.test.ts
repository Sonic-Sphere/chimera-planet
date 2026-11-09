import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import { loadTasks, prepareEdition } from "../src/edition-bank";
import { Stage } from "../src/stage";
import type { Catalog } from "../src/types";

const catalog: Catalog = JSON.parse(fs.readFileSync("public/local-assets/catalog.json", "utf8"));
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
};

test("loading is bounded and waits for all work before reporting readiness", async () => {
  const gates = Array.from({ length: 5 }, deferred), started: number[] = [], updates: number[] = [];
  let complete = false;
  const pending = loadTasks(gates.map((g, i) => async () => { started.push(i); await g.promise; }), (done) => updates.push(done), 2).then(() => { complete = true; });
  assert.deepEqual(started, [0, 1]);
  gates[1].resolve(); await new Promise(setImmediate);
  assert.deepEqual(started, [0, 1, 2]);
  assert.equal(complete, false);
  gates.forEach((g) => g.resolve()); await pending;
  assert.deepEqual(updates, [0, 1, 2, 3, 4, 5]);
});

test("failed loading settles in-flight work and stops launching more assets", async () => {
  const gate = deferred(), error = new Error("offline");
  let settled = false, extra = false;
  const pending = loadTasks([
    async () => { throw error; },
    async () => { await gate.promise; settled = true; },
    async () => { extra = true; },
  ], () => {}, 2);
  await new Promise(setImmediate);
  assert.equal(settled, false);
  gate.resolve();
  await assert.rejects(pending, error);
  assert.equal(settled, true);
  assert.equal(extra, false);
});

test("edition readiness includes all performers, audio, palette and films; release is idempotent", async (t) => {
  const edition = catalog.editions[8], prepared: string[] = [], audio = new Set<string>();
  let retained: string[] = [], releases = 0, disposed = 0, warmed = 0;
  t.mock.method(globalThis, "fetch", async () => new Response("film"));
  t.mock.method(URL, "createObjectURL", () => "blob:film" + Math.random());
  const revoke = t.mock.method(URL, "revokeObjectURL", () => {});
  const oldImage = globalThis.Image, oldRAF = globalThis.requestAnimationFrame;
  Object.assign(globalThis, { Image: class { async decode() {} }, requestAnimationFrame: (cb: FrameRequestCallback) => { cb(0); return 0; } });
  t.after(() => { Object.assign(globalThis, { Image: oldImage, requestAnimationFrame: oldRAF }); });
  const engine: any = {
    slots: [], prepareAudio: () => ({}),
    assets: {
      retainSounds(paths: string[]) { retained = paths; return () => { releases++; }; },
      async performer(c: any) { audio.add(c.music.a); audio.add(c.music.b ?? c.music.a); return { gltf: {}, poses: {}, states: {} }; },
      async sound(_context: unknown, path: string) { audio.add(path); }, prune() {},
    },
  };
  const stage: any = {
    async prepare(part: string) { prepared.push(part); return { part }; },
    async warmGraphics(bank: Map<string, unknown>) { assert.equal(bank.size, 20); warmed++; },
    disposeBank(bank: Map<string, unknown>) { disposed += bank.size; bank.clear(); },
  };
  const bank = await prepareEdition(catalog, edition, engine, stage, () => {});
  assert.deepEqual(prepared.sort(), [...edition.characterIds].sort());
  assert.equal(warmed, 1);
  assert.equal(bank.images.length, 1);
  assert.equal(bank.videos.size, 3);
  assert.deepEqual(new Set(retained), audio);
  assert.equal(releases, 0);
  bank.release(); bank.release();
  assert.equal(releases, 1);
  assert.equal(disposed, 20);
  assert.equal(revoke.mock.callCount(), 3);
});

test("removed and replaced outfits reuse the prepared graphics without disposal", () => {
  const stage: any = Object.create(Stage.prototype);
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
  root.add(new THREE.Mesh(geometry, material));
  const p: any = { root, part: "part", created: 0, frame: -1 };
  let disposals = 0;
  geometry.addEventListener("dispose", () => { disposals++; });
  Object.assign(stage, { engine: { now: 1 }, roots: [new THREE.Group()], idles: [new THREE.Group()], performers: new Map(), bank: new Map([["part", p]]), parked: new Map(), retiring: [], scene: new THREE.Scene() });
  assert.equal(stage.activate(0, "part"), true);
  stage.unmount(0, true);
  assert.equal(stage.retiring.length, 1);
  assert.equal(stage.activate(0, "part"), true);
  assert.equal(stage.retiring.length, 0);
  stage.unmount(0, false);
  assert.equal(disposals, 0);
  assert.equal(stage.activate(0, "part"), true);
  stage.unmount(0, false);
  stage.disposeBank(stage.bank);
  assert.equal(disposals, 1);
});
test("edition failure cleans completed and late performer loads without replacing the current bank", async () => {
  const edition = { ...catalog.editions[8], bonuses: [] };
  const gate = deferred(), freed: string[] = [];
  let releases = 0, warm = false;
  const engine: any = { slots: [], prepareAudio: () => ({}), assets: {
    retainSounds: () => () => { releases++; },
    async performer(c: any) {
      if (c.id.endsWith("01")) throw new Error("Missing animation");
      await gate.promise; return { gltf: {}, poses: {}, states: {} };
    }, prune() {},
  } };
  const stage: any = {
    async prepare(part: string) { return { part }; },
    async warmGraphics() { warm = true; },
    disposeBank(bank: Map<string, any>) { freed.push(...bank.keys()); bank.clear(); },
  };
  const pending = prepareEdition(catalog, edition, engine, stage, () => {});
  await new Promise(setImmediate);
  assert.equal(releases, 0);
  gate.resolve();
  await assert.rejects(pending, /Missing animation/);
  assert.deepEqual(freed.sort(), [edition.characterIds[1], edition.characterIds[2]]);
  assert.equal(releases, 1);
  assert.equal(warm, false);
});
