import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Engine } from "../src/engine";
import { planPerformance } from "../src/performance";
import type { Catalog, PerformanceSave } from "../src/types";
const catalog: Catalog = JSON.parse(
  fs.readFileSync("public/local-assets/catalog.json", "utf8"),
);
function setup(ei = 1, rate = 48000) {
  const starts: any[] = [],
    stops: any[] = [];
  const ctx: any = {
    currentTime: 0,
    sampleRate: rate,
    state: "running",
    async suspend() {
      ctx.state = "suspended";
    },
    async resume() {
      ctx.state = "running";
    },
    createGain() {
      const g: any = {
        value: 1,
        events: [],
        setValueAtTime(v: number, t: number) {
          g.value = v;
        },
        setTargetAtTime(v: number, t: number, c: number) {
          g.value = v;
          g.events.push({ v, t, c });
        },
        cancelAndHoldAtTime() {},
        cancelScheduledValues() {},
      };
      return { gain: g, connect() {}, disconnect() {} };
    },
    createBufferSource() {
      const node: any = {
        buffer: null,
        playbackRate: { value: 1 },
        connect() {},
        disconnect() {},
        start(t: number, o: number) {
          starts.push({ t, o, buffer: node.buffer });
        },
        stop(t: number) {
          node.stoppedAt = t;
          stops.push(t);
        },
      };
      return node;
    },
  };
  (globalThis as any).window = { setInterval: () => 0 };
  const engine = new Engine(catalog, catalog.editions[ei]);
  engine.context = ctx;
  engine.master = ctx.createGain();
  const e = catalog.editions[ei];
  for (const c of catalog.characters.filter((c) => c.editionId === e.id))
    for (const path of [c.music.a, c.music.b ?? c.music.a])
      engine.assets.buffers.set(path, {
        duration: engine.duration,
        length: Math.round(engine.duration * rate),
        numberOfChannels: 2,
        sampleRate: rate,
        path,
      } as any);
  const assign = (slot: number, part: string) => {
    engine.reserve(slot, part);
    engine.assignReady(slot, part);
  };
  const advance = (t: number) => {
    while (ctx.currentTime + 0.02 < t) {
      ctx.currentTime += 0.02;
      engine.pump();
    }
    ctx.currentTime = t;
    engine.pump();
  };
  return { engine, ctx, starts, stops, advance, assign, e };
}
test("live engine and offline planner agree on phase selection and subphrase commands at both device rates", () => {
  for (const rate of [44100, 48000])
    for (const ei of [0, 1, 2]) {
      const { engine, ctx, advance, assign, e } = setup(ei, rate);
      assign(0, e.characterIds[0]);
      const epoch = engine.epoch,
        d = engine.duration;
      const commands: PerformanceSave["events"] = [
        {
          time: 0,
          command: { type: "assign", slot: 0, part: e.characterIds[0] },
        },
        {
          time: d * 0.3,
          command: { type: "assign", slot: 1, part: e.characterIds[1] },
        },
        { time: d * 1.2, command: { type: "mute", slot: 0 } },
        { time: d * 1.4, command: { type: "mute", slot: 0 } },
        { time: d * 1.5, command: { type: "solo", slot: 1 } },
        { time: d * 1.6, command: { type: "solo", slot: 1 } },
        { time: d * 2.4, command: { type: "remove", slot: 1 } },
      ];
      for (const { time, command: c } of commands.slice(1)) {
        advance(epoch + time);
        if (c.type === "assign") assign(c.slot, c.part);
        if (c.type === "mute") engine.mute(c.slot);
        if (c.type === "solo") engine.solo(c.slot);
        if (c.type === "remove") engine.remove(c.slot);
      }
      advance(epoch + d * 3 + 0.1);
      const normalized = new Map<string, any>();
      for (const x of engine.trace)
        if (x.type === "scheduled" && Number(x.slot) >= 0)
          normalized.set(`${x.slot}/${x.phase}`, x);
      const plan = planPerformance(
        {
          format: "bongo-chorus",
          version: 1,
          edition: e.id,
          duration: d * 3 + 0.2,
          events: commands,
        },
        catalog,
      );
      for (const v of plan.voices.filter((v) => v.slot >= 0)) {
        const event = normalized.get(`${v.slot}/${v.phase}`);
        assert(event, `${e.id}/${v.slot}/${v.phase}`);
        assert.equal(event.path, v.path);
        assert(Math.abs(Number(event.start) - epoch - v.start) <= 1 / rate);
      }
    }
});
test("pause freezes the shared phase and resumes existing sources without restarting A", async () => {
  for (const rate of [44100, 48000]) {
    const { engine, ctx, advance, assign, e, starts, stops } = setup(1, rate);
    assign(0, e.characterIds[0]);
    advance(engine.epoch + engine.duration * 1.35);
    const before = engine.snapshot(),
      count = starts.length,
      stopped = stops.length;
    await engine.pause();
    assert(engine.paused);
    assert.equal(ctx.state, "suspended");
    await engine.warm();
    assert.equal(
      ctx.state,
      "suspended",
      "asset warm-up must not undo intentional pause",
    );
    engine.pump();
    assert.equal(engine.epoch, before.epoch);
    assert.equal(engine.phase, before.phase);
    assert.equal(engine.progress, before.progress);
    assert.equal(starts.length, count);
    assert.equal(stops.length, stopped);
    await engine.resume();
    assert(!engine.paused);
    assert.equal(engine.epoch, before.epoch);
    assert.equal(engine.phase, 1);
    assert.equal(starts.length, count);
    advance(engine.time(2) + 0.01);
    assert.equal(engine.phase, 2);
    assert(!engine.trace.some((x) => x.type === "interruption"));
  }
});
test("replay resume does not also start the live scheduler; Stop still clears a paused transport", async () => {
  const { engine, assign, e, starts } = setup();
  assign(0, e.characterIds[0]);
  await engine.pause();
  const count = starts.length;
  await engine.resume(false);
  assert.equal(starts.length, count);
  await engine.pause();
  engine.stop();
  await engine.resume();
  assert(!engine.paused);
  assert(!engine.running);
  assert.equal(engine.phase, 0);
});
test("ready-after-stop and duplicate assignment cannot create a ghost entrance", () => {
  const { engine, assign, e } = setup();
  const token = engine.reserve(0, e.characterIds[0]);
  engine.stop();
  assert.equal(engine.slots[0].part, null);
  assert.notEqual(engine.slots[0].token, token);
  engine.assignReady(0, e.characterIds[0]);
  assert(!engine.running);
  assign(0, e.characterIds[0]);
  assert.throws(() => assign(0, e.characterIds[1]));
  assert.throws(() => assign(1, e.characterIds[0]));
});
test("live removal and restore retain their source guards and last removal stops", () => {
  const { engine, advance, assign, e } = setup();
  assign(0, e.characterIds[0]);
  assign(1, e.characterIds[1]);
  advance(engine.epoch + engine.duration - 0.3);
  engine.remove(0);
  assert.equal(engine.slots[0].removing, 1);
  advance(engine.epoch + engine.duration + 0.01);
  assert.equal(engine.slots[0].part, null);
  engine.remove(1);
  assert(!engine.running);
  assert.equal(engine.phase, 0);
});
test("scheduler stalls below horizon retain future onsets, beyond horizon report interruption", () => {
  const { engine, ctx, advance, assign, e } = setup();
  assign(0, e.characterIds[0]);
  advance(engine.epoch + engine.duration - 0.1);
  const next = engine.trace.find(
    (e) => e.type === "scheduled" && e.phase === 1,
  );
  assert(next);
  ctx.currentTime += 0.25;
  engine.pump();
  assert(engine.running);
  let message = "";
  engine.onInterrupt = (m) => {
    message = m;
  };
  ctx.currentTime += 1.3;
  engine.pump();
  assert(!engine.running);
  assert(message.includes("scheduler"));
});
test("removed performers release their decoded bank entries", () => {
  const { engine, assign, e, advance } = setup();
  assign(0, e.characterIds[0]);
  assign(1, e.characterIds[1]);
  advance(engine.epoch + 1);
  engine.remove(1);
  const c = catalog.characters.find((c) => c.id === e.characterIds[1])!;
  assert(!engine.assets.buffers.has(c.music.a));
  assert(!engine.assets.buffers.has(c.music.b ?? c.music.a));
});
test("live repeated Jeevan bonuses launch on A after odd-length return realignment", async () => {
  const { engine, assign, e, advance } = setup(6),
    b = e.bonuses[0];
  for (const [slot, n] of b.code.entries()) assign(slot, e.characterIds[n - 1]);
  for (const path of [b.music, b.predrop].filter(Boolean) as string[])
    engine.assets.buffers.set(path, {
      duration: engine.duration * b.phases,
      length: 100,
      numberOfChannels: 2,
      sampleRate: 48000,
    } as any);
  advance(engine.epoch + 0.2);
  await engine.requestBonus(b);
  assert.equal(engine.bonus!.start, 2);
  const end = engine.bonus!.end;
  advance(engine.epoch + end * engine.duration + 0.3);
  assert(!engine.bonus);
  assert.equal(engine.parity(), 0);
  await engine.requestBonus(b);
  assert.equal(engine.parity(engine.bonus!.start), 0);
  assert.equal(engine.bonus!.start % 2, 1);
});
test("a later solo does not erase the original pending restoration queue", () => {
  const { engine, assign, e, advance } = setup();
  assign(0, e.characterIds[0]);
  assign(1, e.characterIds[1]);
  engine.solo(0);
  advance(engine.epoch + engine.duration - 0.3);
  engine.solo(0);
  engine.solo(1);
  assign(2, e.characterIds[2]);
  advance(engine.epoch + engine.duration + 0.02);
  assert.deepEqual(
    engine.slots.slice(0, 3).map((s) => s.muted),
    [false, false, true],
  );
  assert(engine.slots[1].solo);
});
test("queued bonus fades remain editable and Stop overrides every future cancellation", async () => {
  const { engine, assign, e, advance, ctx } = setup();
  const b = e.bonuses[0];
  for (const [slot, n] of b.code.entries()) assign(slot, e.characterIds[n - 1]);
  for (const buffer of engine.assets.buffers.values())
    (buffer as any).duration = engine.duration + 0.01;
  for (const path of [b.music, b.predrop].filter(Boolean) as string[])
    engine.assets.buffers.set(path, {
      duration: engine.duration * b.phases,
      length: 100,
      numberOfChannels: 2,
      sampleRate: 48000,
    } as any);
  advance(engine.epoch + engine.duration + 0.2);
  await engine.requestBonus(b);
  const current = (engine as any).voices.filter(
      (v: any) => v.slot >= 0 && v.phase === 1,
    ),
    voice = current.find((v: any) => v.slot === 0);
  assert(voice.releaseAt > engine.now);
  engine.mute(0);
  engine.mute(0);
  assert.deepEqual(
    voice.gain.gain.events
      .filter((e: any) => e.t === ctx.currentTime)
      .map((e: any) => e.v),
    [0, 1],
  );
  engine.stop();
  assert(current.every((v: any) => v.source.stoppedAt === ctx.currentTime));
  assert(!engine.running);
});
test("removing a muted voice uses the source immediate-stop exception", () => {
  const { engine, assign, e, advance, ctx } = setup();
  assign(0, e.characterIds[0]);
  assign(1, e.characterIds[1]);
  advance(engine.epoch + 1);
  engine.mute(0);
  const voice = (engine as any).voices.find(
    (v: any) => v.slot === 0 && v.phase === 0,
  );
  engine.remove(0);
  assert.equal(voice.source.stoppedAt, ctx.currentTime);
});

test("replacing the only dressed performer keeps the shared phase and releases its previous outfit", () => {
  for (const rate of [44100, 48000]) {
    const { engine, assign, advance, e } = setup(1, rate);
    assign(0, e.characterIds[0]);
    advance(engine.epoch + engine.duration * 0.4);
    const epoch = engine.epoch,
      generation = engine.generation,
      oldToken = engine.slots[0].token;
    const events: any[] = [];
    engine.onCommand = (c) => events.push(c);
    engine.replaceReady(0, e.characterIds[7]);
    assert.equal(engine.epoch, epoch);
    assert.equal(engine.generation, generation);
    assert(engine.running);
    assert.equal(engine.slots[0].part, e.characterIds[7]);
    assert.equal(engine.slots[0].joined, 1);
    assert.equal(engine.slots[0].token, oldToken + 1);
    assert(!engine.slots.some((s) => s.part === e.characterIds[0]));
    assert.deepEqual(events, [
      { type: "replace", slot: 0, part: e.characterIds[7] },
    ]);
    advance(engine.time(1) + 0.01);
    const newPart = catalog.characters.find((c) => c.id === e.characterIds[7])!;
    const voice = (engine.snapshot().voices as any[]).find(
      (v) => v.slot === 0 && v.phase === 1,
    );
    assert.equal(voice.path, newPart.music.b ?? newPart.music.a);
    assert.equal(voice.start, engine.time(1));
  }
});
test("replacement retains mute/solo state and protects other staged replacement sounds", () => {
  const { engine, assign, e } = setup();
  assign(0, e.characterIds[0]);
  assign(1, e.characterIds[1]);
  engine.solo(0);
  const pending = catalog.characters.find((c) => c.id === e.characterIds[3])!;
  const release = engine.assets.retainSounds([
    pending.music.a,
    pending.music.b ?? pending.music.a,
  ]);
  engine.replaceReady(0, e.characterIds[2]);
  assert(engine.slots[0].solo);
  assert(!engine.slots[0].muted);
  assert(engine.slots[1].muted);
  assert(engine.assets.buffers.has(pending.music.a));
  release();
  release();
  engine.assets.prune(new Set());
  assert(!engine.assets.buffers.has(pending.music.a));
});
test("replacement rejects unready or duplicate sound without changing the valid performer", () => {
  const { engine, assign, e } = setup();
  assign(0, e.characterIds[0]);
  assign(1, e.characterIds[1]);
  const before = structuredClone(engine.slots);
  assert.throws(() => engine.replaceReady(0, e.characterIds[1]));
  const missing = catalog.characters.find((c) => c.id === e.characterIds[2])!;
  engine.assets.buffers.delete(missing.music.a);
  assert.throws(() => engine.replaceReady(0, missing.id));
  assert.deepEqual(engine.slots, before);
});
test("edition decoding prepares a context without resuming or starting the sequencer", async () => {
  const { engine, ctx } = setup();
  ctx.state = "suspended";
  let resumes = 0;
  ctx.resume = async () => { resumes++; ctx.state = "running"; };
  assert.equal(engine.prepareAudio(), ctx);
  assert.equal(resumes, 0);
  assert.equal(engine.running, false);
  await engine.warm();
  assert.equal(resumes, 1);
  assert.equal(engine.running, false);
});
test("deterministic replay preserves replacement entrances and the continuing A/B clock", () => {
  const { engine, assign, advance, e } = setup();
  assign(0, e.characterIds[0]);
  const epoch = engine.epoch,
    d = engine.duration;
  advance(epoch + d * 0.4);
  engine.replaceReady(0, e.characterIds[7]);
  const plan = planPerformance(
    {
      format: "bongo-chorus",
      version: 1,
      edition: e.id,
      duration: d * 2.2,
      events: [
        {
          time: 0,
          command: { type: "assign", slot: 0, part: e.characterIds[0] },
        },
        {
          time: d * 0.4,
          command: { type: "replace", slot: 0, part: e.characterIds[7] },
        },
      ],
    },
    catalog,
  );
  const state = plan.states.find((s) => s.time === d * 0.4)!;
  assert.equal(state.epoch, 0);
  assert(state.running);
  assert.equal(state.slots[0].joined, 1);
  const first = plan.voices.find((v) => v.slot === 0 && v.phase === 0)!;
  assert(Math.abs(first.stop! - (d * 0.4 + 0.09)) < 1e-8);
  advance(epoch + d * 2 + 0.01);
  for (const phase of [1, 2]) {
    const live = (engine.snapshot().voices as any[]).find(
      (v) => v.slot === 0 && v.phase === phase,
    );
    const expected = plan.voices.find(
      (v) => v.slot === 0 && v.phase === phase,
    )!;
    if (live) {
      assert.equal(live.path, expected.path);
      assert(Math.abs(live.start - epoch - expected.start) < 1 / 48000);
    }
    assert.equal(expected.start, phase * d);
  }
});

test("an outfit moved onto an occupied performer returns its old outfit immediately without restarting the source voice", () => {
  const { engine, assign, advance, e } = setup();
  assign(0, e.characterIds[0]);
  assign(1, e.characterIds[1]);
  advance(engine.time(1) - 0.2);
  const epoch = engine.epoch,
    source = { ...engine.slots[0] };
  engine.displace(1);
  assert.equal(engine.slots[1].part, null);
  assert.deepEqual(engine.slots[0], source);
  assert(engine.running);
  assert.equal(engine.epoch, epoch);
  assert(!(engine.snapshot().voices as any[]).some((v) => v.slot === 1));
  assert((engine.snapshot().voices as any[]).some((v) => v.slot === 0));
});
