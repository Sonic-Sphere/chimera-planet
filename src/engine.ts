import { Assets } from "./assets";
import {
  bonusBoundary,
  boundaryTime,
  canAssign,
  GAIN_CONSTANT,
  guardedRemoval,
  guardedRestore,
  newSlots,
  phaseAt,
  phaseDuration,
  RELEASE,
} from "./compatibility";
import type {
  Bonus,
  Catalog,
  Character,
  Command,
  Edition,
  PerformanceEvent,
  Slot,
} from "./types";
interface Voice {
  releaseAt?: number;
  id: number;
  source: AudioBufferSourceNode;
  gain: GainNode;
  slot: number;
  phase: number;
  start: number;
  end: number;
  path: string;
  cancelled: boolean;
}
export interface BonusPlan {
  bonus: Bonus;
  start: number;
  end: number;
  predrop: Voice | null;
}
export class Engine {
  context: AudioContext | null = null;
  master: GainNode | null = null;
  analyser: AnalyserNode | null = null;
  edition: Edition;
  slots: Slot[] = newSlots();
  epoch = 0;
  running = false;
  paused = false;
  generation = 0;
  bonus: BonusPlan | null = null;
  trace: Record<string, unknown>[] = [];
  readonly assets = new Assets();
  onChange = (): void => {};
  onCommand = (_command: Command): void => {};
  onInterrupt = (_message: string): void => {};
  private voices: Voice[] = [];
  private voiceID = 0;
  private interval = 0;
  private scheduled = new Set<number>();
  private lastTick = 0;
  private lastPhase = -1;
  private restoreAt: number | null = null;
  private restoreSlots = new Set<number>();
  private parityChanges: { at: number; shift: number }[] = [];
  readonly horizon = 1.2;
  private bonusRequest = 0;
  private bonusLoading = false;
  private characters: Map<string, Character>;
  constructor(catalog: Catalog, edition: Edition) {
    this.edition = edition;
    this.characters = new Map(catalog.characters.map((c) => [c.id, c]));
  }
  get duration(): number {
    return phaseDuration(this.edition);
  }
  get now(): number {
    return this.context?.currentTime ?? 0;
  }
  get presentationNow(): number {
    const c = this.context;
    if (!c || c.state !== "running") return this.now;
    const ts = c.getOutputTimestamp?.(),
      ct = ts?.contextTime ?? 0,
      pt = ts?.performanceTime ?? 0;
    if (ct > 0 && pt > 0)
      return Math.min(
        c.currentTime,
        ct + Math.max(0, performance.now() - pt) / 1000,
      );
    return Math.max(0, c.currentTime - (c.outputLatency ?? c.baseLatency ?? 0));
  }
  get displayPhase(): number {
    return this.running
      ? phaseAt(this.presentationNow, this.epoch, this.duration)
      : 0;
  }
  get displayProgress(): number {
    return this.running
      ? Math.max(
          0,
          Math.min(
            1,
            (this.presentationNow - this.time(this.displayPhase)) /
              this.duration,
          ),
        )
      : 0;
  }
  get phase(): number {
    return this.running ? phaseAt(this.now, this.epoch, this.duration) : 0;
  }
  get progress(): number {
    return this.running
      ? Math.max(
          0,
          Math.min(1, (this.now - this.time(this.phase)) / this.duration),
        )
      : 0;
  }
  parity(phase = this.phase): number {
    let shift = 0;
    for (const p of this.parityChanges) if (phase >= p.at) shift = p.shift;
    return (phase + shift) % 2;
  }
  time(phase: number): number {
    return boundaryTime(
      this.epoch,
      phase,
      this.duration,
      this.context?.sampleRate ?? 48000,
    );
  }
  prepareAudio(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: "interactive" });
      this.master = this.context.createGain();
      this.master.gain.value = 1;
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 256;
      this.master.connect(this.analyser);
      this.analyser.connect(this.context.destination);
      this.context.onstatechange = () => {
        if (this.context?.state !== "running" && this.running && !this.paused)
          this.interrupt(
            "Audio was interrupted. Press Play to restart together on A.",
          );
      };
    }
    return this.context;
  }
  async warm(): Promise<AudioContext> {
    const context = this.prepareAudio();
    if (context.state !== "running" && !this.paused) await context.resume();
    return context;
  }
  async pause(): Promise<void> {
    if (!this.running || this.paused || !this.context) return;
    this.paused = true;
    clearInterval(this.interval);
    try {
      // Suspending the shared clock preserves every source offset and future onset.
      await this.context.suspend();
      this.log("pause");
    } catch (error) {
      this.paused = false;
      this.interval = window.setInterval(() => this.pump(), 25);
      throw error;
    } finally {
      this.onChange();
    }
  }
  async resume(schedule = true): Promise<void> {
    if (!this.paused || !this.context) return;
    const generation = this.generation;
    await this.context.resume();
    if (generation !== this.generation) return;
    this.paused = false;
    this.lastTick = this.now;
    if (schedule) {
      this.pump();
      this.interval = window.setInterval(() => this.pump(), 25);
    }
    this.log("resume");
    this.onChange();
  }
  private log(type: string, fields: Record<string, unknown> = {}): void {
    this.trace.push({
      type,
      time: this.now,
      generation: this.generation,
      ...fields,
    });
    if (this.trace.length > 12000) this.trace.splice(0, 2000);
  }
  start(): void {
    if (this.running || !this.slots.some((s) => s.part && s.ready)) return;
    if (this.context?.state !== "running") return;
    this.running = true;
    this.epoch =
      Math.ceil((this.now + 0.08) * this.context.sampleRate) /
      this.context.sampleRate;
    this.lastPhase = -1;
    this.lastTick = this.now;
    this.parityChanges = [];
    for (const s of this.slots)
      if (s.part && s.ready) {
        s.joined = 0;
        s.removing = null;
      }
    this.scheduled.clear();
    this.pump();
    this.interval = window.setInterval(() => this.pump(), 25);
    this.onChange();
  }
  stop(emit = true): void {
    const now = this.now;
    this.generation++;
    this.bonusRequest++;
    this.bonusLoading = false;
    this.running = false;
    this.paused = false;
    clearInterval(this.interval);
    this.scheduled.clear();
    this.bonus = null;
    this.restoreAt = null;
    this.restoreSlots.clear();
    this.parityChanges = [];
    for (const v of this.voices) this.cancel(v, now, true);
    this.voices = [];
    for (const s of this.slots) {
      s.token++;
      s.removing = null;
      s.joined = Infinity;
      if (!s.ready) s.part = null;
    }
    this.log("stop");
    if (emit) this.onCommand({ type: "stop" });
    this.onChange();
  }
  clear(): void {
    this.stop(false);
    this.slots = newSlots();
    this.assets.prune(new Set());
    this.onChange();
  }
  interrupt(message: string): void {
    this.log("interruption", { message });
    this.stop(false);
    this.onInterrupt(message);
  }
  private cancel(v: Voice, at: number, immediate = false): void {
    if (v.cancelled) {
      // Stop overrides a previously scheduled future removal or bonus fade.
      if (immediate && at <= this.now) {
        try {
          v.gain.gain.cancelScheduledValues(at);
          v.gain.gain.setValueAtTime(0, at);
          v.source.stop(at);
        } catch {
          /* Already ended. */
        }
        v.releaseAt = undefined;
      }
      return;
    }
    v.cancelled = true;
    v.releaseAt = at > this.now ? at : undefined;
    this.log("cancelled", {
      id: v.id,
      slot: v.slot,
      phase: v.phase,
      start: v.start,
      effective: at,
      immediate,
    });
    try {
      if (immediate || v.start > at || v.gain.gain.value === 0)
        v.source.stop(at);
      else {
        v.gain.gain.cancelAndHoldAtTime(at);
        v.gain.gain.setTargetAtTime(0, at, GAIN_CONSTANT);
        v.source.stop(at + RELEASE);
      }
    } catch {
      /* Already ended. */
    }
  }
  private gainAt(s: Slot, phase: number): number {
    return this.restoreAt !== null &&
      phase >= this.restoreAt &&
      this.restoreSlots.has(s.index)
      ? 1
      : s.muted
        ? 0
        : 1;
  }
  private voice(
    path: string,
    slot: number,
    phase: number,
    start: number,
    gain: number,
    offset = 0,
  ): Voice {
    const context = this.context!,
      buffer = this.assets.buffers.get(path);
    if (!buffer) throw new Error(`Undecoded sound: ${path}`);
    const source = context.createBufferSource(),
      node = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = 1;
    node.gain.setValueAtTime(gain, start);
    source.connect(node);
    node.connect(this.master!);
    const v = {
      id: ++this.voiceID,
      source,
      gain: node,
      slot,
      phase,
      start,
      end: start + buffer.duration - offset,
      path,
      cancelled: false,
    };
    source.onended = () => {
      source.disconnect();
      node.disconnect();
      this.voices = this.voices.filter((x) => x !== v);
    };
    source.start(start, offset);
    this.voices.push(v);
    this.log("scheduled", {
      id: v.id,
      slot,
      phase,
      parity: this.parity(phase) ? "B" : "A",
      start,
      path,
      offset,
      gain,
      frames: buffer.length,
      rate: buffer.sampleRate,
      decodedDuration: buffer.duration,
    });
    return v;
  }
  private plan(phase: number): void {
    if (this.scheduled.has(phase)) return;
    this.scheduled.add(phase);
    const start = this.time(phase),
      b = this.bonus;
    if (b && phase >= b.start && phase < b.end) {
      if (phase === b.start) this.voice(b.bonus.music, -1, phase, start, 1);
      return;
    }
    for (const s of this.slots) {
      if (
        !s.part ||
        !s.ready ||
        phase < s.joined ||
        (s.removing !== null && phase >= s.removing)
      )
        continue;
      const c = this.characters.get(s.part)!;
      this.voice(
        this.parity(phase) ? (c.music.b ?? c.music.a) : c.music.a,
        s.index,
        phase,
        start,
        this.gainAt(s, phase),
      );
    }
  }
  pump(): void {
    if (!this.running || this.paused) return;
    const now = this.now;
    if (now - this.lastTick > this.horizon) {
      this.interrupt(
        "The audio scheduler was delayed. Press Play to restart together on A.",
      );
      return;
    }
    this.lastTick = now;
    // Boundary observers never decide source starts. Sources already carry audio timestamps.
    const phase = this.phase;
    if (now >= this.epoch && phase !== this.lastPhase) {
      for (let p = this.lastPhase + 1; p <= phase; p++)
        this.log("boundary", {
          phase: p,
          start: this.time(p),
          parity: this.parity(p) ? "B" : "A",
          observerDelay: now - this.time(p),
        });
      this.lastPhase = phase;
      for (const s of this.slots)
        if (s.removing !== null && s.removing <= phase) this.commitRemove(s);
      if (this.restoreAt !== null && phase >= this.restoreAt) {
        for (const s of this.slots)
          if (this.restoreSlots.has(s.index)) s.muted = false;
        this.restoreAt = null;
        this.restoreSlots.clear();
      }
      this.onChange();
    }
    if (this.bonus && this.displayPhase >= this.bonus.end) {
      this.log("bonus-return", { id: this.bonus.bonus.id, phase });
      this.bonus = null;
      this.onChange();
    }
    let p = Math.max(0, phase);
    if (this.time(p) < now - 0.001) p++;
    while (this.time(p) < now + this.horizon) {
      this.plan(p);
      p++;
    }
    for (const n of this.scheduled) if (n < phase - 2) this.scheduled.delete(n);
  }
  private replan(): void {
    const cutoff = this.now + 0.002;
    for (const v of [...this.voices])
      if (v.start >= cutoff && v.slot !== -2) this.cancel(v, this.now, true);
    for (const n of this.scheduled)
      if (this.time(n) >= cutoff) this.scheduled.delete(n);
    this.pump();
  }
  private nextPhase(): number {
    if (!this.running) return 0;
    let p = this.phase;
    if (this.time(p) < this.now + 0.002) p++;
    return p;
  }
  assignReady(index: number, part: string): void {
    const s = this.slots[index];
    if (s.part !== part) return;
    s.ready = true;
    s.joined = this.nextPhase();
    s.assignedAt = this.now;
    if (this.slots.some((s) => s.solo)) s.muted = true;
    this.onCommand({ type: "assign", slot: index, part });
    this.log("assign", { slot: index, part, joined: s.joined });
    if (!this.running) this.start();
    else this.replan();
    this.onChange();
  }
  replaceReady(index: number, part: string): void {
    const slot = this.slots[index],
      character = this.characters.get(part);
    if (
      !slot?.part ||
      !slot.ready ||
      !character ||
      character.editionId !== this.edition.id
    )
      throw new Error(
        "The performer and outfit must be ready before replacing.",
      );
    if (slot.part === part) return;
    if (this.slots.some((s) => s.index !== index && s.part === part))
      throw new Error("That outfit is already being worn.");
    if (this.bonusPlaying) throw new Error("Wait for the bonus to finish.");
    if (
      ![character.music.a, character.music.b ?? character.music.a].every(
        (path) => this.assets.buffers.has(path),
      )
    )
      throw new Error("The new outfit's sound is not ready.");
    const previous = slot.part;
    if (
      this.bonus?.bonus.code.some(
        (n) => this.edition.characterIds[n - 1] === previous,
      )
    )
      this.cancelBonus(false);
    for (const voice of this.voices) {
      if (voice.slot !== index) continue;
      // A replacement supersedes even an earlier, queued future bonus/removal fade.
      if (voice.releaseAt !== undefined && voice.releaseAt > this.now)
        voice.cancelled = false;
      this.cancel(voice, this.now, slot.muted);
    }
    Object.assign(slot, {
      part,
      token: slot.token + 1,
      joined: this.nextPhase(),
      assignedAt: this.now,
      removing: null,
    });
    this.onCommand({ type: "replace", slot: index, part });
    this.log("replace", { slot: index, previous, part, joined: slot.joined });
    if (this.running) this.replan();
    else this.start();
    this.pruneAudio();
    this.onChange();
  }
  reserve(index: number, part: string): number {
    if (this.bonusPlaying)
      throw new Error(
        "Wait for the bonus to finish before dressing a performer.",
      );
    if (!canAssign(this.slots, index, part))
      throw new Error("Choose an empty performer and an unused sound.");
    const s = this.slots[index];
    s.part = part;
    s.ready = false;
    s.token++;
    this.onChange();
    return s.token;
  }
  fail(index: number, token: number): void {
    const s = this.slots[index];
    if (s.token === token && !s.ready) {
      s.part = null;
      s.token++;
      this.onChange();
    }
  }
  mute(index: number, emit = true): void {
    const s = this.slots[index];
    if (!s.part || !s.ready || s.removing !== null || this.bonusPlaying) return;
    s.muted = !s.muted;
    this.applyGains();
    this.replan();
    if (emit) this.onCommand({ type: "mute", slot: index });
    this.onChange();
  }
  private applyGains(): void {
    const now = this.now;
    for (const v of this.voices)
      if (
        v.slot >= 0 &&
        (!v.cancelled || (v.releaseAt !== undefined && v.releaseAt > now)) &&
        v.start <= now &&
        v.end > now
      ) {
        v.gain.gain.cancelAndHoldAtTime(now);
        v.gain.gain.setTargetAtTime(
          this.slots[v.slot].muted ? 0 : 1,
          now,
          GAIN_CONSTANT,
        );
        if (v.releaseAt !== undefined && v.releaseAt > now) {
          v.gain.gain.setTargetAtTime(0, v.releaseAt, GAIN_CONSTANT);
          try {
            v.source.stop(
              v.releaseAt + (this.slots[v.slot].muted ? 0 : RELEASE),
            );
          } catch {
            /* Already ended. */
          }
        }
      }
  }
  solo(index: number, emit = true): void {
    const s = this.slots[index];
    if (!s.part || !s.ready || s.removing !== null || this.bonusPlaying) return;
    if (s.solo) {
      for (const s of this.slots) s.solo = false;
      const next = this.nextPhase(),
        remaining = this.time(next) - this.now;
      if (this.running && guardedRestore(remaining)) {
        this.restoreAt = next;
        for (const x of this.slots) if (x.part) this.restoreSlots.add(x.index);
      } else {
        for (const s of this.slots) s.muted = false;
        this.restoreAt = null;
        this.restoreSlots.clear();
      }
    } else {
      for (const s of this.slots) {
        if (!s.part) continue;
        s.solo = s.index === index;
        s.muted = !s.solo;
      }
    }
    this.applyGains();
    this.replan();
    if (emit) this.onCommand({ type: "solo", slot: index });
    this.onChange();
  }
  displace(index: number): void {
    for (const voice of this.voices)
      if (
        voice.slot === index &&
        voice.releaseAt !== undefined &&
        voice.releaseAt > this.now
      )
        voice.cancelled = false;
    this.remove(index, true, true);
  }
  remove(index: number, emit = true, immediate = false): void {
    const s = this.slots[index];
    if (!s.part || this.bonusPlaying) return;
    if (
      this.bonus &&
      !this.bonusPlaying &&
      this.bonus.bonus.code.some(
        (n) => this.edition.characterIds[n - 1] === s.part,
      )
    )
      this.cancelBonus(false);
    if (emit)
      this.onCommand({ type: immediate ? "displace" : "remove", slot: index });
    if (!s.ready) {
      s.token++;
      s.part = null;
      this.onChange();
      return;
    }
    const next = this.nextPhase(),
      remaining = this.time(next) - this.now;
    if (!immediate && this.running && guardedRemoval(remaining)) {
      s.removing = next;
      for (const v of this.voices)
        if (v.slot === index && v.start < this.time(next))
          this.cancel(v, this.time(next), s.muted);
    } else this.commitRemove(s);
    if (!this.slots.some((s) => s.part && s.removing === null)) {
      for (const s of this.slots) if (s.part) this.commitRemove(s);
      this.stop(false);
    } else this.replan();
    this.onChange();
  }
  private pruneAudio(): void {
    const paths = new Set<string>();
    for (const s of this.slots) {
      if (!s.part) continue;
      const c = this.characters.get(s.part)!;
      paths.add(c.music.a);
      paths.add(c.music.b ?? c.music.a);
    }
    if (this.bonus) {
      paths.add(this.bonus.bonus.music);
      if (this.bonus.bonus.predrop) paths.add(this.bonus.bonus.predrop);
    }
    if (this.bonusLoading)
      for (const b of this.edition.bonuses) {
        paths.add(b.music);
        if (b.predrop) paths.add(b.predrop);
      }
    this.assets.prune(paths);
  }
  private commitRemove(s: Slot): void {
    const solo = s.solo;
    for (const v of this.voices)
      if (v.slot === s.index) this.cancel(v, this.now, s.muted);
    Object.assign(s, {
      part: null,
      ready: false,
      token: s.token + 1,
      joined: Infinity,
      muted: false,
      solo: false,
      removing: null,
    });
    if (solo) {
      const next = this.nextPhase();
      if (this.running && guardedRestore(this.time(next) - this.now)) {
        this.restoreAt = next;
        for (const x of this.slots) if (x.part) this.restoreSlots.add(x.index);
      } else {
        for (const s of this.slots) s.muted = false;
        this.restoreAt = null;
        this.restoreSlots.clear();
      }
      this.applyGains();
    }
    this.pruneAudio();
  }
  get bonusPlaying(): boolean {
    return (
      !!this.bonus &&
      this.phase >= this.bonus.start &&
      this.phase < this.bonus.end
    );
  }
  get bonusVisible(): boolean {
    return (
      !!this.bonus &&
      this.displayPhase >= this.bonus.start &&
      this.displayPhase < this.bonus.end
    );
  }
  bonusEligible(b: Bonus): boolean {
    return b.code.every((i) =>
      this.slots.some(
        (s) => s.part === this.edition.characterIds[i - 1] && s.ready,
      ),
    );
  }
  async requestBonus(b: Bonus, emit = true): Promise<void> {
    if (
      !this.running ||
      this.bonus ||
      this.bonusLoading ||
      !this.bonusEligible(b)
    )
      throw new Error("Find the five sounds in this bonus combination first.");
    const next = this.nextPhase(),
      eligible = bonusBoundary(
        next,
        this.edition.bonusloopA,
        this.parity(next) - (next % 2),
      );
    if (this.time(next) - this.now < 0.5 && eligible === next)
      throw new Error(
        "Bonus is too close to the boundary. Try in the next phrase.",
      );
    const generation = this.generation,
      request = ++this.bonusRequest;
    this.bonusLoading = true;
    try {
      await Promise.all([
        this.assets.sound(this.context!, b.music),
        b.predrop
          ? this.assets.sound(this.context!, b.predrop)
          : Promise.resolve(),
      ]);
    } finally {
      if (request === this.bonusRequest) this.bonusLoading = false;
    }
    if (
      request !== this.bonusRequest ||
      generation !== this.generation ||
      !this.running ||
      !this.bonusEligible(b)
    )
      return;
    const start = bonusBoundary(
        this.nextPhase(),
        this.edition.bonusloopA,
        this.parity(this.nextPhase()) - (this.nextPhase() % 2),
      ),
      end = start + b.phases;
    this.bonus = { bonus: b, start, end, predrop: null };
    if (this.edition.bonusendloopA)
      this.parityChanges.push({ at: end, shift: end % 2 });
    // Predrop belongs to the final phrase before the bonus. Start partway through it only when >600 ms remains, with the source's 10 ms offset rounding.
    const prePhase = start - 1,
      preStart = this.time(prePhase);
    if (b.predrop && preStart < this.now && this.time(start) - this.now > 0.6) {
      const offset = Math.round((this.now - preStart) * 100) / 100;
      this.bonus.predrop = this.voice(
        b.predrop,
        -2,
        prePhase,
        this.now,
        0,
        offset,
      );
      this.bonus.predrop.gain.gain.setTargetAtTime(1, this.now, GAIN_CONSTANT);
    } else if (b.predrop && preStart >= this.now)
      this.bonus.predrop = this.voice(b.predrop, -2, prePhase, preStart, 1);
    for (const v of this.voices)
      if (v.slot >= 0 && v.start < this.time(start) && v.end > this.time(start))
        this.cancel(v, this.time(start));
    this.replan();
    if (emit) this.onCommand({ type: "bonus", id: b.id });
    this.log("bonus-request", { id: b.id, start, end });
    this.onChange();
  }
  cancelBonus(emit = true): void {
    if (!this.bonus) return;
    const b = this.bonus;
    for (const v of this.voices) if (v.slot < 0) this.cancel(v, this.now, true);
    this.parityChanges = this.parityChanges.filter((p) => p.at !== b.end);
    this.bonus = null;
    // Cancel during a scene resumes stems on the next shared boundary, without jumping into phrases.
    for (const s of this.slots) if (s.part) s.joined = this.nextPhase();
    this.replan();
    if (emit) this.onCommand({ type: "cancelBonus" });
    this.onChange();
  }
  observeReplay(
    slots: Slot[],
    epoch: number,
    running: boolean,
    shift: number,
    bonus: { bonus: Bonus; start: number; end: number } | null,
  ): void {
    this.slots = slots.map((s) => ({ ...s }));
    this.epoch = epoch;
    this.running = running;
    this.parityChanges = [{ at: 0, shift }];
    this.bonus = bonus ? { ...bonus, predrop: null } : null;
  }
  snapshot(): Record<string, unknown> {
    return {
      running: this.running,
      paused: this.paused,
      edition: this.edition.id,
      phase: this.phase,
      parity: this.parity() ? "B" : "A",
      progress: this.progress,
      epoch: this.epoch,
      duration: this.duration,
      contextState: this.context?.state,
      rate: this.context?.sampleRate,
      presentationTime: this.presentationNow,
      displayPhase: this.displayPhase,
      displayProgress: this.displayProgress,
      baseLatency: this.context?.baseLatency,
      outputLatency: this.context?.outputLatency,
      slots: this.slots.map((s) => ({ ...s })),
      voices: this.voices
        .filter((v) => !v.cancelled)
        .map((v) => ({
          slot: v.slot,
          phase: v.phase,
          start: v.start,
          path: v.path,
        })),
      decodedBytes: this.assets.bytes,
      bonus: this.bonus
        ? {
            id: this.bonus.bonus.id,
            start: this.bonus.start,
            end: this.bonus.end,
          }
        : null,
    };
  }
  level(): number {
    if (!this.analyser) return 0;
    const values = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(values);
    return Math.sqrt(values.reduce((n, x) => n + x * x, 0) / values.length);
  }
}
