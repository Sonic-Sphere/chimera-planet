import type { Assets } from "./assets";
import {
  bonusBoundary,
  GAIN_CONSTANT,
  guardedRemoval,
  guardedRestore,
  newSlots,
  phaseDuration,
  RELEASE,
} from "./compatibility";
import type { Bonus, Catalog, Edition, PerformanceSave, Slot } from "./types";
export interface PlannedVoice {
  path: string;
  slot: number;
  phase: number;
  start: number;
  offset: number;
  gain: number;
  changes: { time: number; value: number }[];
  stop: number | null;
}
export interface ReplayState {
  time: number;
  slots: Slot[];
  epoch: number;
  running: boolean;
  shift: number;
  bonus: { id: string; start: number; end: number } | null;
}
export interface PerformancePlan {
  voices: PlannedVoice[];
  states: ReplayState[];
  duration: number;
}
export function validateSave(
  value: unknown,
  catalog: Catalog,
): PerformanceSave {
  const d = value as PerformanceSave;
  if (
    !d ||
    d.format !== "bongo-chorus" ||
    d.version !== 1 ||
    !catalog.editions.some((e) => e.id === d.edition) ||
    !Number.isFinite(d.duration) ||
    d.duration <= 0 ||
    d.duration > 1800 ||
    !Array.isArray(d.events) ||
    d.events.length > 10000
  )
    throw new Error(
      "This is not a supported Chorus performance (maximum 30 minutes).",
    );
  let last = -1;
  const edition = catalog.editions.find((e) => e.id === d.edition)!;
  for (const event of d.events) {
    const c = event.command;
    if (
      !Number.isFinite(event.time) ||
      event.time < 0 ||
      event.time < last ||
      event.time > d.duration ||
      !c ||
      ![
        "assign",
        "replace",
        "remove",
        "displace",
        "mute",
        "solo",
        "play",
        "stop",
        "bonus",
        "cancelBonus",
      ].includes(c.type)
    )
      throw new Error("The performance contains an invalid event.");
    last = event.time;
    if ("slot" in c && (!Number.isInteger(c.slot) || c.slot < 0 || c.slot > 6))
      throw new Error("Invalid performer in performance.");
    if (
      (c.type === "assign" || c.type === "replace") &&
      !edition.characterIds.includes(c.part)
    )
      throw new Error("The performance uses a sound from another edition.");
    if (c.type === "bonus" && !edition.bonuses.some((b) => b.id === c.id))
      throw new Error("Invalid bonus in performance.");
  }
  return structuredClone(d);
}
/** Deterministic interpretation of readiness-time commands, used by both replay and export. */
export function planPerformance(
  save: PerformanceSave,
  catalog: Catalog,
): PerformancePlan {
  const edition = catalog.editions.find((e) => e.id === save.edition)!,
    characters = new Map(catalog.characters.map((c) => [c.id, c]));
  const restoreSlots = new Set<number>();
  const duration = phaseDuration(edition),
    slots = newSlots(),
    voices: PlannedVoice[] = [],
    states: ReplayState[] = [];
  let running = false,
    epoch = 0,
    next = 0,
    shift = 0,
    restore: number | null = null,
    bonus: { value: Bonus; start: number; end: number } | null = null;
  const boundary = (n: number) => epoch + n * duration;
  const snapshot = (time: number) =>
    states.push({
      time,
      slots: slots.map((s) => ({ ...s })),
      running,
      epoch,
      shift,
      bonus: bonus
        ? { id: bonus.value.id, start: bonus.start, end: bonus.end }
        : null,
    });
  const active = (t: number) =>
    voices.filter((v) => v.start <= t && v.stop === null);
  const gains = (t: number) => {
    for (const v of active(t))
      if (v.slot >= 0)
        v.changes.push({ time: t, value: slots[v.slot].muted ? 0 : 1 });
  };
  const stopVoice = (v: PlannedVoice, t: number, immediate = false) => {
    if (v.stop !== null && v.stop <= t) return;
    v.changes.push({ time: t, value: 0 });
    v.stop = t + (immediate || v.gain === 0 ? 0 : RELEASE);
  };
  const remove = (slot: Slot, t: number) => {
    const solo = slot.solo;
    for (const v of active(t))
      if (v.slot === slot.index) stopVoice(v, t, slot.muted);
    Object.assign(slot, {
      part: null,
      ready: false,
      muted: false,
      solo: false,
      joined: Infinity,
      removing: null,
    });
    if (solo) {
      if (guardedRestore(boundary(next) - t)) {
        restore = next;
        for (const s of slots) if (s.part) restoreSlots.add(s.index);
      } else {
        for (const s of slots) s.muted = false;
        gains(t);
      }
    }
  };
  const start = (t: number) => {
    if (running || !slots.some((s) => s.part)) return;
    running = true;
    epoch = t;
    next = 0;
    shift = 0;
    for (const s of slots) if (s.part) s.joined = 0;
  };
  const stop = (t: number) => {
    for (const v of voices) stopVoice(v, t, true);
    running = false;
    bonus = null;
    restore = null;
    restoreSlots.clear();
    shift = 0;
    for (const s of slots) {
      s.joined = Infinity;
      s.removing = null;
    }
  };
  const phrase = (time: number) => {
    const phase = next++;
    for (const s of slots)
      if (s.removing !== null && s.removing <= phase) remove(s, time);
    if (restore !== null && restore <= phase) {
      for (const s of slots) if (restoreSlots.has(s.index)) s.muted = false;
      restore = null;
      restoreSlots.clear();
      gains(time);
    }
    if (bonus && phase >= bonus.end) {
      if (edition.bonusendloopA) shift = phase % 2;
      bonus = null;
    }
    if (bonus && phase >= bonus.start) {
      if (phase === bonus.start) {
        for (const v of active(time)) if (v.slot >= 0) stopVoice(v, time);
        voices.push({
          path: bonus.value.music,
          slot: -1,
          phase,
          start: time,
          offset: 0,
          gain: 1,
          changes: [],
          stop: boundary(bonus.end),
        });
      }
      snapshot(time);
      return;
    }
    for (const s of slots)
      if (s.part && phase >= s.joined) {
        const c = characters.get(s.part)!;
        voices.push({
          path: (phase + shift) % 2 ? (c.music.b ?? c.music.a) : c.music.a,
          slot: s.index,
          phase,
          start: time,
          offset: 0,
          gain: s.muted ? 0 : 1,
          changes: [],
          stop: null,
        });
      }
    snapshot(time);
  };
  for (let eventIndex = 0; eventIndex < save.events.length; ) {
    const t = save.events[eventIndex].time;
    while (
      running &&
      boundary(next) <= t + 1e-8 &&
      !(next === 0 && Math.abs(t - epoch) < 1e-8)
    )
      phrase(boundary(next));
    // Group simultaneous initial assignments before starting the initial phase.
    while (
      eventIndex < save.events.length &&
      Math.abs(save.events[eventIndex].time - t) < 1e-8
    ) {
      const c = save.events[eventIndex++].command,
        s = "slot" in c ? slots[c.slot] : null;
      switch (c.type) {
        case "replace":
          if (
            s?.part &&
            !slots.some((x) => x.index !== s.index && x.part === c.part) &&
            (!bonus || t < boundary(bonus.start))
          ) {
            if (s.part === c.part) break;
            if (
              bonus?.value.code.some(
                (n) => edition.characterIds[n - 1] === s.part,
              )
            ) {
              for (const v of voices) if (v.slot < 0) stopVoice(v, t, true);
              bonus = null;
              for (const x of slots) if (x.part) x.joined = next;
            }
            for (const v of active(t))
              if (v.slot === s.index) stopVoice(v, t, s.muted);
            Object.assign(s, {
              part: c.part,
              ready: true,
              joined: running ? next : 0,
              assignedAt: t,
              removing: null,
            });
            start(t);
          }
          break;
        case "assign":
          if (s && !s.part && !slots.some((s) => s.part === c.part)) {
            s.part = c.part;
            s.ready = true;
            s.joined = running ? next : 0;
            s.assignedAt = t;
            start(t);
            if (slots.some((s) => s.solo)) s.muted = true;
          }
          break;
        case "mute":
          if (s?.part && (!bonus || t < boundary(bonus.start))) {
            s.muted = !s.muted;
            gains(t);
          }
          break;
        case "solo":
          if (s?.part && (!bonus || t < boundary(bonus.start))) {
            if (s.solo) {
              for (const x of slots) x.solo = false;
              if (running && guardedRestore(boundary(next) - t)) {
                restore = next;
                for (const x of slots) if (x.part) restoreSlots.add(x.index);
              } else {
                for (const x of slots) x.muted = false;
                restore = null;
                restoreSlots.clear();
              }
            } else {
              for (const x of slots) {
                if (!x.part) continue;
                x.solo = x === s;
                x.muted = x !== s;
              }
            }
            gains(t);
          }
          break;
        case "displace":
        case "remove":
          if (s?.part && (!bonus || t < boundary(bonus.start))) {
            if (
              bonus &&
              bonus.value.code.some(
                (n) => edition.characterIds[n - 1] === s.part,
              )
            ) {
              for (const v of voices) if (v.slot < 0) stopVoice(v, t, true);
              bonus = null;
            }
            if (
              c.type !== "displace" &&
              running &&
              guardedRemoval(boundary(next) - t)
            )
              s.removing = next;
            else remove(s, t);
            if (!slots.some((s) => s.part && s.removing === null)) {
              for (const s of slots) if (s.part) remove(s, t);
              stop(t);
            }
          }
          break;
        case "play":
          start(t);
          break;
        case "stop":
          stop(t);
          break;
        case "cancelBonus":
          if (bonus) {
            for (const v of voices) if (v.slot < 0) stopVoice(v, t, true);
            bonus = null;
            for (const s of slots) if (s.part) s.joined = next;
          }
          break;
        case "bonus": {
          const b = edition.bonuses.find((b) => b.id === c.id)!;
          if (
            running &&
            !bonus &&
            b.code.every((i) =>
              slots.some((s) => s.part === edition.characterIds[i - 1]),
            )
          ) {
            const p = bonusBoundary(next, edition.bonusloopA, shift);
            bonus = { value: b, start: p, end: p + b.phases };
            if (b.predrop) {
              const pre = boundary(p - 1),
                start = Math.max(t, pre);
              if (start === pre || boundary(p) - t > 0.6)
                voices.push({
                  path: b.predrop,
                  slot: -2,
                  phase: p - 1,
                  start,
                  offset: start === pre ? 0 : Math.round((t - pre) * 100) / 100,
                  gain: 1,
                  changes: [],
                  stop: boundary(p),
                });
            }
          }
          break;
        }
      }
    }
    snapshot(t);
    if (running && next === 0 && boundary(0) <= t + 1e-8) phrase(boundary(0));
  }
  while (running && boundary(next) < save.duration) phrase(boundary(next));
  // End at the recorded stop point, retaining a normal 90 ms release.
  for (const v of voices)
    if (v.stop === null || v.stop > save.duration) {
      v.changes.push({ time: save.duration, value: 0 });
      v.stop = save.duration + RELEASE;
    }
  return {
    voices: voices
      .filter((v) => v.stop === null || v.stop > v.start)
      .sort((a, b) => a.start - b.start),
    states: states.sort((a, b) => a.time - b.time),
    duration: save.duration + RELEASE,
  };
}
export function scheduleVoice(
  context: BaseAudioContext,
  destination: AudioNode,
  assets: Assets,
  v: PlannedVoice,
  origin: number,
): AudioBufferSourceNode {
  const source = context.createBufferSource(),
    gain = context.createGain();
  source.buffer = assets.buffers.get(v.path)!;
  if (!source.buffer) throw new Error("A recorded sound has not loaded.");
  source.connect(gain);
  gain.connect(destination);
  gain.gain.setValueAtTime(v.gain, origin + v.start);
  for (const change of v.changes)
    if (change.time >= v.start)
      gain.gain.setTargetAtTime(
        change.value,
        origin + change.time,
        GAIN_CONSTANT,
      );
  source.start(origin + v.start, v.offset);
  if (v.stop !== null) source.stop(origin + v.stop);
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
  };
  return source;
}
export async function exportWave(
  save: PerformanceSave,
  catalog: Catalog,
  assets: Assets,
): Promise<Blob> {
  const plan = planPerformance(save, catalog),
    context = new OfflineAudioContext(
      2,
      Math.ceil(plan.duration * 44100),
      44100,
    );
  for (const path of new Set(plan.voices.map((v) => v.path)))
    await assets.sound(context, path);
  for (const v of plan.voices)
    scheduleVoice(context, context.destination, assets, v, 0);
  const buffer = await context.startRendering();
  return wav(buffer);
}
export function wav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels,
    frames = buffer.length,
    bytes = new ArrayBuffer(44 + frames * channels * 2),
    view = new DataView(bytes);
  const str = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++)
      view.setUint8(offset + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, frames * channels * 2, true);
  const data = Array.from({ length: channels }, (_, i) =>
    buffer.getChannelData(i),
  );
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < channels; c++)
      view.setInt16(
        44 + (i * channels + c) * 2,
        Math.max(-1, Math.min(1, data[c][i])) *
          (data[c][i] < 0 ? 32768 : 32767),
        true,
      );
  return new Blob([bytes], { type: "audio/wav" });
}
export function download(value: Blob, name: string): void {
  const url = URL.createObjectURL(value),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
