import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  boundaryTime,
  canAssign,
  guardedRemoval,
  guardedRestore,
  newSlots,
  phaseDuration,
  sourceFrame,
} from "../src/compatibility";
import { planPerformance, validateSave } from "../src/performance";
import type { Catalog, PerformanceSave } from "../src/types";
const catalog: Catalog = JSON.parse(
  fs.readFileSync("public/local-assets/catalog.json", "utf8"),
);
const readable = fs.readFileSync(
  "evidence/reference/script.readable.js",
  "utf8",
);
function recover(name: string): string {
  const start = readable.indexOf(`function ${name}(`),
    open = readable.indexOf("{", start),
    re =
      /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*|[{}]/g;
  re.lastIndex = open;
  let depth = 0;
  for (let m; (m = re.exec(readable)); ) {
    if (m[0] === "{") depth++;
    if (m[0] === "}" && --depth === 0)
      return readable.slice(start, m.index + 1);
  }
  throw new Error(name);
}
function oracle(names: string[], extra: Record<string, unknown>): any {
  const context = vm.createContext({ yz: {}, ...extra });
  vm.runInContext(names.map(recover).join("\n"), context);
  return context;
}
const observations: any[] = [];
test("all nine clocks retain source duration separately from ideal BPM and sample rounding", () => {
  for (const e of catalog.editions) {
    const t = e.timing,
      d = phaseDuration(e);
    assert.equal(
      d,
      Math.floor((t.sourcePhaseDurationMs / 1000) * 44100) / 44100,
    );
    for (const rate of [44100, 48000])
      for (const n of [0, 1, 100, 10000])
        assert(
          Math.abs(boundaryTime(1, n, d, rate) - (1 + n * d)) <= 0.5001 / rate,
        );
  }
  assert.notEqual(
    phaseDuration(catalog.editions[0]),
    catalog.editions[0].timing.idealPhaseDurationFromBpmMs / 1000,
  );
});
test("recovered source 500 ms removal guard, last removal and solo restoration strictness", () => {
  for (const remaining of [0, 0.0001, 0.4999, 0.5, 0.5001, 4.8]) {
    const actions: string[] = [];
    const slot = {
      desactiverClick() {
        actions.push("disable");
      },
    };
    const source = oracle(["r3"], {
      rX: false,
      qy: false,
      pK: 500,
      qv: [],
      t5: () => remaining * 1000,
      rj: () => actions.push("remove"),
      t8: () => [slot, {}],
      sz: () => actions.push("stop"),
    });
    source.r3(slot);
    assert.equal(source.qv.length === 1, guardedRemoval(remaining));
    observations.push({
      function: "r3",
      remaining,
      actions,
      deferred: source.qv.length,
    });
    let restored = false;
    const q = {
      setSolo() {},
      unmute() {
        restored = true;
      },
    };
    const solo = oracle(["r8", "r9"], {
      t8: () => [q],
      qw: [],
      t5: () => remaining * 1000,
      pK: 500,
    });
    solo.r8();
    assert.equal(!restored, guardedRestore(remaining));
  }
  let stopped = false;
  const last = oracle(["r3"], {
    rX: false,
    qy: false,
    pK: 500,
    qv: [],
    t5: () => 10,
    rj: () => {},
    t8: () => [{}],
    sz: () => {
      stopped = true;
    },
  });
  last.r3({ desactiverClick() {} });
  assert(stopped);
});
test("recovered source solo mutes others and restore unmutes all", () => {
  const slots = Array.from({ length: 7 }, (_, id) => ({
    id,
    muted: id === 2,
    solo: false,
    setSolo(v: boolean) {
      this.solo = v;
    },
    mute() {
      this.muted = true;
    },
    unmute() {
      this.muted = false;
    },
  }));
  const source = oracle(["r7", "r8", "r9"], {
    t8: () => slots,
    qw: [],
    t5: () => 1000,
    pK: 500,
  });
  source.r7(slots[3]);
  assert.deepEqual(
    slots.map((s) => s.muted),
    [true, true, true, false, true, true, true],
  );
  source.r8();
  assert(slots.every((s) => !s.muted && !s.solo));
});
test("recovered source first assignment, busy waiting, and empty-only target selection", () => {
  const actions: string[] = [];
  const slot = {
    habiller() {
      actions.push("dress");
    },
    showLoader() {
      actions.push("wait");
    },
    activerClick() {
      actions.push("enable");
    },
  };
  const source = oracle(["r0"], {
    hy: (v: unknown) => v == null,
    lP: [{}],
    pM: true,
    rW: false,
    s3: 0,
  });
  source.r0(slot, { id: 0 });
  assert.deepEqual(actions, ["dress", "wait", "enable"]);
  const slots = newSlots();
  assert(canAssign(slots, 0, "a"));
  slots[0].part = "a";
  assert(!canAssign(slots, 0, "b"));
  assert(!canAssign(slots, 1, "a"));
  assert(!canAssign(slots, 7, "b"));
});
test("every expanded frame agrees with the original JSON selection and integer offsets", () => {
  let frames = 0,
    native = 0;
  for (const c of catalog.characters) {
    const edition = catalog.editions.find((e) => e.id === c.editionId)!,
      total = edition.timing.animationFramesPerFullCycle;
    const original = JSON.parse(
        fs.readFileSync(`public/local-assets/port/${c.animation}`, "utf8"),
      ),
      derived = JSON.parse(
        fs.readFileSync(
          `public/local-assets/extrusions/${c.extrusion.source}`,
          "utf8",
        ),
      );
    native += original.arrayFrame.length;
    assert.equal(derived.frames.length, total);
    assert.equal(
      original.bat === "true" || original.bat === "1",
      false,
      "current supplied roster has no JSON orientation flags",
    );
    for (let i = 0; i < total; i++) {
      const index = sourceFrame(
        i % (total / 2),
        Math.floor(i / (total / 2)),
        original.arrayFrame.length,
        total,
      );
      const [sx, sy, dx, dy] = original.arrayFrame[index].prop
        .split(",")
        .map((v: string) => parseInt(v, 10) || 0);
      const frame = derived.frames[i];
      assert.equal(frame.sourceFrame, index);
      assert.deepEqual(frame.offset, [dx, dy + 1]);
      assert.deepEqual(derived.heads[frame.head].crop.slice(0, 2), [
        sx * 2,
        sy * 2 + 1,
      ]);
      frames++;
    }
  }
  assert.equal(frames, 57960);
  assert.equal(native, 40415);
});
function performance(
  editionIndex: number,
  events: PerformanceSave["events"],
  duration = 20,
): PerformanceSave {
  return {
    format: "bongo-chorus",
    version: 1,
    edition: catalog.editions[editionIndex].id,
    duration,
    events,
  };
}
test("recording planner preserves late B joins, singles, mute and solo windows", () => {
  const e = catalog.editions[1];
  const save = performance(1, [
    { time: 0, command: { type: "assign", slot: 0, part: e.characterIds[0] } },
    { time: 2, command: { type: "assign", slot: 1, part: e.characterIds[1] } },
    { time: 3, command: { type: "assign", slot: 2, part: e.characterIds[2] } },
    { time: 6, command: { type: "mute", slot: 0 } },
    { time: 7, command: { type: "mute", slot: 0 } },
    { time: 8, command: { type: "solo", slot: 1 } },
    { time: 9.2, command: { type: "solo", slot: 1 } },
  ]);
  const p = planPerformance(save, catalog);
  const late = p.voices.find((v) => v.slot === 1)!;
  assert.equal(late.start, 4.8);
  assert(late.path.endsWith("_b.mp3"));
  assert(
    p.voices
      .filter((v) => v.slot === 2)
      .every((v) => v.path.endsWith("_a.mp3")),
  );
  assert(
    p.voices.some(
      (v) =>
        v.slot === 0 &&
        v.changes.some((c) => c.time === 6 && c.value === 0) &&
        v.changes.some((c) => c.time === 7 && c.value === 1),
    ),
  );
  assert(
    p.states
      .filter((s) => s.time >= 9.6)
      .every((s) => s.slots.every((s) => !s.muted)),
  );
});
test("all 27 bonus fixtures retain one-based combinations, native audio and return parity", () => {
  for (const [ei, e] of catalog.editions.entries())
    for (const b of e.bonuses) {
      const duration = phaseDuration(e);
      const save = performance(
        ei,
        [
          ...b.code.map((index, slot) => ({
            time: 0,
            command: {
              type: "assign" as const,
              slot,
              part: e.characterIds[index - 1],
            },
          })),
          { time: 0.2, command: { type: "bonus" as const, id: b.id } },
        ],
        duration * (b.phases + 4),
      );
      const p = planPerformance(save, catalog);
      const bonus = p.voices.find((v) => v.slot === -1)!;
      assert(bonus, b.id);
      const start = bonus.phase;
      assert(!e.bonusloopA || start % 2 === 0, b.id);
      assert.equal(bonus.path, b.music);
      assert(
        !p.voices.some(
          (v) => v.slot >= 0 && v.phase >= start && v.phase < start + b.phases,
        ),
      );
      const returning = p.voices.find(
        (v) => v.slot >= 0 && v.phase === start + b.phases,
      )!;
      assert(returning, b.id);
      if (e.bonusendloopA) {
        const part = catalog.characters.find(
          (c) => c.id === e.characterIds[b.code[0] - 1],
        )!;
        assert.equal(returning.path, part.music.a);
      }
    }
});
test("malformed performance imports reject invalid timing, slots and edition references", () => {
  const good = performance(1, [
    {
      time: 0,
      command: {
        type: "assign",
        slot: 0,
        part: catalog.editions[1].characterIds[0],
      },
    },
  ]);
  assert(validateSave(good, catalog));
  for (const bad of [
    { ...good, duration: Infinity },
    { ...good, duration: 1801 },
    { ...good, version: 2 },
    { ...good, events: [{ time: -1, command: { type: "play" } }] },
    {
      ...good,
      events: [
        { time: 0, command: { type: "assign", slot: 9, part: "unknown" } },
      ],
    },
  ])
    assert.throws(() => validateSave(bad, catalog));
});
test.after(() => {
  fs.mkdirSync("evidence/stage-0", { recursive: true });
  fs.writeFileSync(
    "evidence/stage-0/extended-source-probes.json",
    JSON.stringify({ status: "passed", observations }, null, 2),
  );
});
test("Jeevan repeated bonuses launch on shared A after an odd-length bonus realigns return", () => {
  const e = catalog.editions[6],
    d = phaseDuration(e),
    b = e.bonuses[0];
  const save = performance(
    6,
    [
      ...b.code.map((n, slot) => ({
        time: 0,
        command: { type: "assign" as const, slot, part: e.characterIds[n - 1] },
      })),
      { time: 0.2, command: { type: "bonus" as const, id: b.id } },
      { time: d * 5 + 0.2, command: { type: "bonus" as const, id: b.id } },
    ],
    d * 12,
  );
  const p = planPerformance(save, catalog),
    bonuses = p.voices.filter((v) => v.slot === -1);
  assert.equal(bonuses.length, 2);
  assert.equal(bonuses[0].phase, 2);
  assert.equal(bonuses[1].phase % 2, 1);
  const second = bonuses[1];
  const state = p.states.filter((s) => s.time <= second.start).at(-1)!;
  assert.equal((second.phase + state.shift) % 2, 0);
});
test("stopping or cancelling before a predrop starts removes its future voice", () => {
  const e = catalog.editions[1],
    b = e.bonuses[0];
  for (const type of ["stop", "cancelBonus"] as const) {
    const save = performance(
      1,
      [
        ...b.code.map((n, slot) => ({
          time: 0,
          command: {
            type: "assign" as const,
            slot,
            part: e.characterIds[n - 1],
          },
        })),
        { time: 0.2, command: { type: "bonus" as const, id: b.id } },
        { time: 0.3, command: { type } },
      ],
      12,
    );
    const p = planPerformance(save, catalog);
    assert(!p.voices.some((v) => v.slot < 0), type);
  }
});
test("recovered source preserves the queued restore across a new solo", () => {
  const slots = Array.from({ length: 3 }, (_, id) => ({
      id,
      muted: false,
      solo: false,
      setSolo(v: boolean) {
        this.solo = v;
      },
      mute() {
        this.muted = true;
      },
      unmute() {
        this.muted = false;
      },
    })),
    busy = slots.slice(0, 2);
  const source = oracle(["r7", "r8", "r9"], {
    t8: () => busy,
    qw: [],
    t5: () => 400,
    pK: 500,
  });
  source.r7(slots[0]);
  source.r8();
  source.r7(slots[1]);
  busy.push(slots[2]);
  slots[2].muted = true;
  source.r9();
  assert.deepEqual(
    slots.map((s) => s.muted),
    [false, false, true],
  );
  assert(slots[1].solo);
  const e = catalog.editions[1],
    d = phaseDuration(e),
    p = planPerformance(
      performance(1, [
        {
          time: 0,
          command: { type: "assign", slot: 0, part: e.characterIds[0] },
        },
        {
          time: 0,
          command: { type: "assign", slot: 1, part: e.characterIds[1] },
        },
        { time: 0.2, command: { type: "solo", slot: 0 } },
        { time: d - 0.3, command: { type: "solo", slot: 0 } },
        { time: d - 0.2, command: { type: "solo", slot: 1 } },
        {
          time: d - 0.1,
          command: { type: "assign", slot: 2, part: e.characterIds[2] },
        },
      ]),
      catalog,
    );
  assert.deepEqual(
    p.states
      .find((s) => s.time === d)!
      .slots.slice(0, 3)
      .map((s) => s.muted),
    [false, false, true],
  );
});
