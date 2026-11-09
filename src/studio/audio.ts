import workletUrl from "../../vendor/chimera/src/worklet/processor.ts?worker&url";
import { chimeraModule } from "../../vendor/chimera/src/wasm/chimera.ts";
import { beatReady, DEFAULT_SOURCE, EnglishG2P, lyricsToSyllables, NEUTRAL, planSong, planUtterance, tokenizeIpa } from "../../vendor/chimera/src/wasm/engine.ts";
import type { BeatStep, Gesture, SungNote, Syllable, VoiceSource } from "../../vendor/chimera/src/wasm/types.ts";
import type { FromWorklet, TelemetryMessage, ToWorklet } from "../../vendor/chimera/src/worklet/protocol.ts";
import type { MouthWord } from "../../vendor/chimera/src/ui/mouthWords.ts";
import { wordSpans, type WordSpan } from "../../vendor/chimera/src/ui/words.ts";
import { HEADS, type HeadState } from "../heads.ts";
import type { Note } from "./songbook.ts";
import type { SongPerformance } from "./performance.ts";

export const BEAT_STEPS = 16;
export type Pattern = (BeatStep | null)[][];
export type Mix = { muted: boolean[]; solo: number | null };
type Start = Extract<ToWorklet, { type: "ensembleStart" }>["command"];
type Voice = { node: AudioWorkletNode; gain: GainNode; frames: { frame: number; telemetry: TelemetryMessage }[]; audible: boolean; words: TimedWord[] };
type Mode = "songs" | "beatbox";
type TimedWord = WordSpan & { spoken?: true };
export type StageWord = MouthWord & Pick<TimedWord, "spoken">;
export type StageVoice = { tele: TelemetryMessage | null; word: StageWord | null };

const PREROLL = 0.2; // Chimera's beat player also starts its first acoustic hit after 200 ms.
const VOWELS: Record<string, string> = { ah: "ɑ", aa: "ɑ", ay: "eɪ", ee: "i", eh: "ɛ", oh: "oʊ", oo: "u", ooh: "u", uh: "ʌ" };
const VOCABLES: Record<string, [string[], string, string[]]> = {
  ba: [["b"], "ɑ", []], da: [["d"], "ɑ", []], doo: [["d"], "u", []], dee: [["d"], "i", []],
  la: [["l"], "ɑ", []], ma: [["m"], "ɑ", []], dum: [["d"], "ʌ", ["m"]],
  weh: [["w"], "ɛ", []], zii: [["z"], "i", []], hmm: [["h"], "ə", ["m"]], mmm: [["m"], "ə", ["m"]],
  le: [["l"], "ə", []], tle: [["t"], "ə", ["l"]], twink: [["t", "w"], "ɪ", ["ŋ", "k"]],
  mar: [["m"], "ɛ", ["ɹ"]], y: [[], "i", []], gent: [["dʒ"], "ɛ", ["n", "t"]],
  gle: [["ɡ"], "ə", ["l"]], ful: [["f"], "ə", ["l"]], ly: [["l"], "i", []],
  ri: [["ɹ"], "ɪ", []], ers: [[], "ɚ", ["z"]], ner: [["n"], "ɚ", []], dy: [["d"], "i", []], dia: [["d"], "aɪ", []],
  wah: [["w"], "ɑ", []], moo: [["m"], "u", []], noh: [["n"], "oʊ", []],
};
const dictionary = new EnglishG2P();
export function warmDictionary(): void { void dictionary.load().catch(() => {}); }

export function readSyllable(text: string): Syllable | undefined {
  const clean = text.trim().toLowerCase().replace(/-$/, "");
  const wordEnd = !text.endsWith("-");
  if (!clean) return undefined;
  if (Object.hasOwn(VOWELS, clean)) return { text, onset: [], nucleus: { ipa: VOWELS[clean], stress: 1 }, coda: [], wordEnd, phraseEnd: false };
  if (Object.hasOwn(VOCABLES, clean)) {
    const [onset, ipa, coda] = VOCABLES[clean];
    return { text, onset: onset.map((ipa) => ({ ipa })), nucleus: { ipa, stress: 1 }, coda: coda.map((ipa) => ({ ipa })), wordEnd, phraseEnd: false };
  }
  const syllables = lyricsToSyllables(clean);
  return syllables.length === 1 && !syllables[0].melisma ? { ...syllables[0], wordEnd } : undefined;
}

type PerformedNote = { note: Note; sung: SungNote; start: number; end: number };

// Adjacent cosine ramps add to one, giving a continuous change of lung pressure.
function breathCurve(points: { time: number; level: number }[]): Gesture[] {
  return points.map(({ time, level }, index) => {
    const prev = points[index - 1], next = points[index + 1];
    return {
      t0: time, t1: time, rampIn: prev ? time - prev.time : 0.045, rampOut: next ? next.time - time : 0.065,
      strength: 1, targets: { breath: level }, label: "breath",
    };
  });
}

function shapePhrase(phrase: PerformedNote[], body: HeadState["body"], bpm: number, head: number,
  performance?: SongPerformance): Gesture[] {
  const first = phrase[0];
  const last = phrase.at(-1)!;
  const plan = planSong(phrase.map(({ sung }) => sung), {
    body, bpm, t0: first.start, vibrato: performance
      ? performance.color.vibrato * (performance.melody(head, first.note) ? 1 : 0.48) + (head % 3) * 3
      : 15 + (head % 4) * 6,
  });
  if (!performance) return plan.gestures;

  const drive = ({ note }: PerformedNote) => performance.drive(head, note);
  const breath = plan.gestures.find((gesture) => gesture.targets.breath !== undefined)!;
  const points = [{ time: breath.t0, level: drive(first) * 0.82 }];
  for (const part of phrase) {
    const span = part.end - part.start;
    const time = Math.min(part.start + Math.min(span * 0.33, 0.28), breath.t1 - 0.015);
    if (time > points.at(-1)!.time) points.push({ time, level: drive(part) });
  }
  points.push({ time: breath.t1, level: drive(last) * 0.64 });

  const gestures = plan.gestures.filter((gesture) => gesture !== breath);
  gestures.push(...breathCurve(points));

  for (const [index, part] of phrase.entries()) {
    const length = part.end - part.start;
    const lead = performance.melody(head, part.note);
    const interval = part.sung.midi - (phrase[index - 1]?.sung.midi ?? part.sung.midi);
    if (lead && performance.color.scoop && length > 0.46 && (index === 0 || interval > 2.5)) {
      const f0 = 440 * 2 ** ((part.sung.midi - 69 - performance.color.scoop / 100) / 12);
      gestures.push({
        t0: part.start - 0.02, t1: part.start + 0.036, rampIn: 0.025, rampOut: 0.10,
        strength: 6, targets: { f0 }, label: "scoop",
      });
    }
  }

  // Move the jaw a little more at projected peaks. Keep the calibrated tongue
  // targets and the consonant closures that make each syllable recognizable.
  let noteIndex = 0;
  const vowels = new Map(plan.segments.filter((segment) => segment.kind === "vowel")
    .map((segment) => [segment.t0, segment.ipa]));
  for (const gesture of gestures) {
    const jaw = gesture.targets.jaw;
    if (jaw === undefined || vowels.get(gesture.t0) !== gesture.label) continue;
    while (noteIndex + 1 < phrase.length && gesture.t0 >= phrase[noteIndex + 1].start - 0.001) noteIndex++;
    gesture.targets.jaw = Math.min(2.85, jaw + Math.max(0, drive(phrase[noteIndex]) - 0.95) * 0.52);
  }
  return gestures;
}

function addSpeech(body: HeadState["body"], speech: NonNullable<SongPerformance["speech"]>, gestures: Gesture[], words: TimedWord[]): void {
  let at = PREROLL;
  for (const line of speech.lines) {
    const segments = tokenizeIpa(line.ipa);
    const plan = planUtterance(segments, {
      body, t0: at, f0: line.pitch, rate: 0.92, accent: 0.13,
      intonation: line.question ? "question" : "statement",
    });
    const breath = plan.gestures.find((gesture) => gesture.targets.breath !== undefined)!;
    const points = [{ time: breath.t0, level: 0.86 }];
    for (const segment of plan.segments) {
      if (segment.kind !== "vowel") continue;
      points.push({ time: (segment.t0 + segment.t1) / 2, level: segment.stress ? 0.98 : 0.84 });
    }
    points.push({ time: breath.t1, level: 0.72 });
    gestures.push(...plan.gestures.filter((gesture) => gesture !== breath), ...breathCurve(points));
    words.push(...wordSpans([{ segments, words: line.text.split(/\s+/) }], plan).map((span) => ({ ...span, spoken: true as const })));
    at = plan.end + 0.24;
  }
}

function voiceScore(notes: Note[], bpm: number, from: number, body: HeadState["body"], head: number,
  performance?: SongPerformance): { gestures: Gesture[]; words: TimedWord[] } {
  const speech = from === 0 && head === 0 ? performance?.speech : undefined;
  const gestures: Gesture[] = [];
  const words: TimedWord[] = [];
  if (speech) addSpeech(body, speech, gestures, words);
  let phrase: PerformedNote[] = [];
  const secondsPerBeat = 60 / bpm;
  const timeAt = (beat: number) => PREROLL + (performance
    ? performance.noteTime(beat, head) - (from ? performance.noteTime(from, head) : 0)
    : (beat - from) * secondsPerBeat);
  const flush = () => {
    if (!phrase.length) return;
    gestures.push(...shapePhrase(phrase, body, bpm, head, performance));
    for (const { note, start, end } of phrase) words.push({ text: note.lyric, t0: start, t1: end });
    phrase = [];
  };
  for (const note of performance?.notes(notes, head) ?? notes) {
    const scoreEnd = note.beat + note.duration;
    if (scoreEnd <= from) continue;
    const at = Math.max(note.beat, from);
    const start = timeAt(at);
    const end = timeAt(scoreEnd);
    const previous = phrase.at(-1);
    const breath = previous && performance?.breathBefore(head, note);
    if (previous && (breath || Math.abs(start - previous.end) > 0.002)) {
      if (breath) {
        previous.end -= Math.min((previous.end - previous.start) * 0.25, 0.14);
        previous.sung.beats = (previous.end - previous.start) / secondsPerBeat;
      }
      flush();
    }
    const syl = readSyllable(note.lyric) ?? readSyllable("ah")!;
    const cents = performance ? [0, 3, -2, 5, -3, -4, 4, -5][head] : 0;
    phrase.push({ note, start, end, sung: {
      midi: note.midi + cents / 100, beats: (end - start) / secondsPerBeat,
      syl: { ...syl, onset: at > note.beat ? [] : syl.onset },
    } });
  }
  flush();
  return { gestures, words };
}

export class EnsembleAudio {
  private ctx?: AudioContext;
  private voices: Voice[] = [];
  private master?: GainNode;
  private loading?: Promise<void>;
  private failure?: Error;
  private serial = 0;
  private base = 0;
  private firstFrame = 0;
  private pausedAt?: number;
  private mode?: Mode;
  private stageVisible = false;
  private directed = false;

  constructor(private readonly headState: (head: number) => HeadState | undefined) {}

  private async prepare(): Promise<void> {
    if (!this.ctx) {
      // Eight physical models share one audio thread. A voice-rate context leaves
      // room for all of them while keeping the standalone instruments unchanged.
      this.ctx = new AudioContext({ latencyHint: "playback", sampleRate: 16000 });
      const ctx = this.ctx;
      this.loading = this.build(ctx).catch((error) => {
        this.failure = undefined;
        void ctx.close().catch(() => {});
        this.ctx = undefined;
        this.voices = [];
        this.master = undefined;
        this.loading = undefined;
        throw error;
      });
    }
    const ctx = this.ctx;
    const loading = this.loading;
    await Promise.all([ctx.resume(), loading]);
    if (this.failure) {
      const error = this.failure;
      this.failure = undefined;
      void ctx.close().catch(() => {});
      this.ctx = undefined;
      this.voices = [];
      this.master = undefined;
      this.loading = undefined;
      throw error;
    }
  }

  private async build(ctx: AudioContext): Promise<void> {
    await ctx.audioWorklet.addModule(workletUrl);
    const master = this.master = ctx.createGain();
    master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 10;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.1;
    master.connect(limiter).connect(ctx.destination);
    await Promise.all(HEADS.map((_, index) => {
      const node = new AudioWorkletNode(ctx, "chimera", {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
        processorOptions: { module: chimeraModule(), ensemble: true },
      });
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      pan.pan.value = [0, -0.43, 0.05, 0.48, -0.63, 0.28, 0.66, -0.23][index];
      node.connect(gain).connect(pan).connect(master);
      const voice: Voice = { node, gain, frames: [], audible: true, words: [] };
      this.voices[index] = voice;
      return new Promise<void>((resolve, reject) => {
        node.port.onmessage = ({ data }: MessageEvent<FromWorklet>) => {
          if (data.type === "ready") resolve();
          if (data.type === "telemetry" && this.stageVisible && this.mode === "songs" &&
              data.frame !== undefined && data.frame >= this.firstFrame) {
            voice.frames.push({ frame: data.frame, telemetry: data });
            if (voice.frames.length > 48) voice.frames.shift();
          }
          if (data.type === "error") {
            this.failure = new Error(data.message);
            reject(this.failure);
          }
        };
        node.onprocessorerror = () => {
          this.failure = new Error("A Chimera voice processor stopped.");
          reject(this.failure);
        };
      });
    }));
  }

  private audibleTime(): number {
    if (this.pausedAt !== undefined) return this.pausedAt;
    const ctx = this.ctx;
    if (!ctx) return -1;
    const stamp = ctx.getOutputTimestamp?.();
    return stamp?.contextTime && stamp.performanceTime !== undefined
      ? Math.min(ctx.currentTime, stamp.contextTime + Math.max(0, (performance.now() - stamp.performanceTime) / 1000))
      : ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  }
  get elapsed(): number { return this.audibleTime() - this.base; }
  get error(): Error | undefined { return this.failure; }

  setStageVisible(visible: boolean): void {
    if (this.stageVisible === visible) return;
    this.stageVisible = visible;
    for (const voice of this.voices) {
      voice.frames.length = 0;
      this.send(voice.node, { type: "telemetry", enabled: visible && this.mode === "songs" });
    }
  }

  stageFrames(showWords: boolean): StageVoice[] {
    if (!this.stageVisible || this.mode !== "songs" || !this.ctx) return [];
    const heardFrame = this.audibleTime() * this.ctx.sampleRate;
    const time = (heardFrame - this.firstFrame) / this.ctx.sampleRate;
    return this.voices.map(({ frames, audible, words }) => {
      while (frames.length > 1 && frames[1].frame <= heardFrame) frames.shift();
      const next = frames[0];
      const tele = audible && next && next.frame <= heardFrame ? next.telemetry : null;
      const word = audible && showWords && this.pausedAt === undefined
        ? words.find(({ t0, t1 }) => time >= t0 && time < t1) : undefined;
      return { tele, word: word ? { key: word, text: word.text, spoken: word.spoken } : null };
    });
  }

  async pause(): Promise<void> {
    if (!this.ctx || this.mode !== "songs" || this.pausedAt !== undefined) return;
    this.pausedAt = this.audibleTime();
    await this.ctx.suspend();
  }

  async resume(): Promise<boolean> {
    if (!this.ctx || this.mode !== "songs" || this.pausedAt === undefined) return false;
    const serial = this.serial;
    await this.ctx.resume();
    if (this.serial !== serial) return false;
    this.pausedAt = undefined;
    return true;
  }

  stop(): void {
    this.serial++;
    this.mode = undefined;
    this.pausedAt = undefined;
    if (this.master && this.ctx) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(0, now);
    }
    for (const voice of this.voices) {
      voice.frames.length = 0;
      voice.words = [];
      this.send(voice.node, { type: "ensembleStop" });
    }
  }

  private send(node: AudioWorkletNode, message: ToWorklet): void { node.port.postMessage(message); }

  setMix(mode: Mode, mix: Mix): void {
    if (this.mode !== mode || !this.ctx) return;
    const levels = mode === "songs"
      ? (this.directed ? [0.79, 0.32, 0.47, 0.38, 0.19, 0.25, 0.25, 0.21] : [0.70, 0.29, 0.52, 0.26, 0.19, 0.30, 0.18, 0.22])
      : [0.85, 0.72, 0.48, 0.55, 0.60, 0.56, 0.43, 0.57];
    const now = this.ctx.currentTime;
    this.voices.forEach((voice, i) => {
      const level = mix.solo !== null ? (mix.solo === i ? levels[i] : 0) : mix.muted[i] ? 0 : levels[i];
      voice.audible = level > 0;
      voice.gain.gain.setTargetAtTime(level, now, 0.012);
    });
  }

  async playSong(tracks: Note[][], bpm: number, from: number, mix: Mix, performance?: SongPerformance): Promise<boolean> {
    const ready = dictionary.load().catch(() => {});
    return this.play("songs", mix, (body, i) => {
      const { gestures, words } = voiceScore(tracks[i], bpm, from, body, i, performance);
      this.voices[i].words = words;
      return { type: "schedule", gestures, segments: [], id: 0, end: 0, replace: true, lead: 0 };
    }, performance?.source, ready);
  }

  async playBeat(pattern: Pattern, bpm: number, swing: number, mix: Mix): Promise<boolean> {
    return this.play("beatbox", mix, (_, i) => ({ type: "beat", steps: pattern[i], bpm, swing, playing: true }));
  }

  setPattern(head: number, steps: (BeatStep | null)[]): void {
    if (this.mode === "beatbox") this.send(this.voices[head].node, { type: "beat", steps });
  }

  private async play(mode: Mode, mix: Mix, command: (body: HeadState["body"], head: number) => Start,
    source?: (head: number) => Partial<VoiceSource>, ready?: Promise<void>): Promise<boolean> {
    this.stop();
    const serial = this.serial;
    await Promise.all([this.prepare(), ready]);
    if (serial !== this.serial) return false;
    const ctx = this.ctx!;
    const parts = this.voices.map(({ node }, i) => {
      const body = this.headState(i)?.body ?? HEADS[i].body;
      this.send(node, { type: "body", body });
      this.send(node, { type: "source", values: source?.(i) ?? DEFAULT_SOURCE });
      this.send(node, { type: "artic", values: mode === "songs" ? NEUTRAL : beatReady(body), tipFree: false });
      return command(body, i);
    });
    // currentFrame is shared across the nodes. Round to the next worklet block and allow
    // enough time for all eight messages to arrive before that block.
    const frame = Math.ceil((ctx.currentTime + 0.12) * ctx.sampleRate / 128) * 128;
    this.firstFrame = frame;
    this.base = frame / ctx.sampleRate + PREROLL;
    this.mode = mode;
    this.directed = source !== undefined;
    this.setMix(mode, mix);
    this.master!.gain.setValueAtTime(mode === "songs" ? 0.85 : 0.95, frame / ctx.sampleRate);
    this.voices.forEach(({ node }, i) => {
      this.send(node, { type: "telemetry", enabled: mode === "songs" && this.stageVisible });
      this.send(node, { type: "ensembleStart", frame, command: parts[i] });
    });
    return true;
  }
}
