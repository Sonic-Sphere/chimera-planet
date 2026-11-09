import { planUtterance, tokenizeIpa } from "../../vendor/chimera/src/wasm/engine.ts";
import { HEADS } from "../heads.ts";
import type { Note, Song } from "./songbook.ts";

export const PREROLL = 0.2; // Chimera's beat player also starts its first acoustic hit after 200 ms.

type Style = "lullaby" | "round" | "groove" | "chorale" | "ballad";
type Cue = [beat: number, lead: number, choir: number, stretch?: number];
type Line = { text: string; ipa: string; pitch: number; question?: boolean; pauseAfter?: number };
type Direction = {
  style: Style;
  cues: Cue[];
  breaths: number[];
  entrances?: [head: number, beat: number][];
  speech?: { seconds?: number; lines: Line[]; countIn?: Line[] };
};

// Cue positions are score beats. Stretch is seconds per beat relative to the written tempo.
// Lead and choir dynamics scale the physical breath drive.
const directions: Record<string, Direction> = {
  lion: { style: "groove", cues: [[0, 0.98, 0.82], [32, 1.02, 0.95], [64, 1.07, 0.82], [96, 1, 1.02], [128, 1.08, 0.87], [160, 1, 1.09], [224, 1.07, 0.89], [256, 1.12, 1.03], [304, 0.94, 0.92], [320, 0.76, 0.75, 1.10]],
    breaths: [16, 64, 80, 128, 144, 160, 176, 192, 208, 224, 240, 256, 272],
    speech: {
      lines: [
        { text: "Hello, hello.", ipa: "həlˈoʊ həlˈoʊ", pitch: 169, pauseAfter: 1 },
        { text: "This is a spatial vocal synth for Sonic Sphere.", ipa: "ðɪs ɪz ə spˈeɪʃəl vˈoʊkəl sˈɪnθ fɚ sˈɑnɪk sfˈɪɹ", pitch: 164 },
        { text: "It places voices around you to sing as a chorus.", ipa: "ɪt plˈeɪsɪz vˈɔɪsɪz əɹˈaʊnd ju tə sˈɪŋ æz ə kˈɔɹəs", pitch: 156, pauseAfter: 1 },
        { text: "Here's a spatial robot chorus of The Lion Sleeps Tonight.", ipa: "hˈɪɹz ə spˈeɪʃəl ɹˈoʊbɑt kˈɔɹəs əv ðə lˈaɪən slˈips tənˈaɪt", pitch: 162, pauseAfter: 2 },
      ],
      countIn: [
        { text: "One", ipa: "wˈʌn", pitch: 153 },
        { text: "Two", ipa: "tˈu", pitch: 158 },
        { text: "Three", ipa: "θɹˈi", pitch: 164 },
        { text: "Four", ipa: "fˈɔɹ", pitch: 170 },
      ],
    },
  },
  twinkle: { style: "lullaby", cues: [[0, 0.84, 0.63], [6, 0.93, 0.74], [16, 0.94, 0.75], [22, 1.02, 0.92], [32, 0.87, 0.71], [46, 0.83, 0.65, 1.12], [48, 0.73, 0.61, 1.25]],
    breaths: [8, 16, 24, 32, 40], entrances: [[2, 4], [4, 16], [5, 8], [6, 16], [7, 8]] },
  row: { style: "round", cues: [[0, 0.97, 0.74], [8, 1.07, 0.89], [16, 1, 0.95], [28, 1.06, 0.92], [40, 0.88, 0.70, 1.15]],
    breaths: [8, 16, 24, 32], entrances: [[2, 8], [4, 16], [5, 16], [7, 24]] },
  joy: { style: "chorale", cues: [[0, 0.83, 0.65], [8, 0.94, 0.75], [16, 1.02, 0.94], [25, 1.13, 1.15], [30, 1.18, 1.17, 1.15], [32, 1.01, 1.05, 1.27]],
    breaths: [8, 16, 24], entrances: [[1, 8], [2, 4], [3, 16], [4, 16], [5, 8], [6, 16], [7, 8]] },
  frere: { style: "round", cues: [[0, 0.94, 0.75], [16, 1.02, 0.85], [24, 1.1, 0.97], [40, 0.98, 0.87], [56, 0.81, 0.72, 1.17]],
    breaths: [8, 16, 24, 32, 40, 48], entrances: [[2, 8], [4, 16], [5, 24], [7, 16]] },
  mary: { style: "groove", cues: [[0, 1, 0.72], [8, 0.88, 0.82], [16, 1.06, 0.96], [27, 1.04, 0.87], [32, 0.83, 0.70, 1.17]],
    breaths: [8, 12, 16, 24], entrances: [[1, 8], [5, 12], [6, 16], [7, 8]] },
  bridge: { style: "groove", cues: [[0, 1, 0.80], [8, 0.94, 0.95], [16, 1.12, 1.01], [24, 0.98, 0.79], [32, 0.86, 0.74, 1.17]],
    breaths: [8, 12, 16, 24], entrances: [[5, 8], [6, 16], [7, 8]] },
  saints: { style: "groove", cues: [[0, 1.02, 0.89], [8, 1.06, 0.95], [16, 1.14, 1.04, 0.96], [28, 1.17, 1.17, 0.97], [36, 1.19, 1.18], [40, 1.05, 1.04, 1.15]],
    breaths: [24, 32, 36], entrances: [[4, 8], [5, 16], [6, 16], [7, 8]],
    speech: { seconds: 2.30, lines: [
      { text: "Listen.", ipa: "lˈɪsən", pitch: 158 },
      { text: "Here they come.", ipa: "hˈɪɹ ðeɪ kˈʌm", pitch: 172 },
    ] } },
  grace: { style: "ballad", cues: [[0, 0.84, 0.65, 1.06], [9, 0.94, 0.68], [16, 1.04, 0.91], [21, 1.19, 1.08, 1.08], [27, 0.92, 0.80], [36, 0.98, 0.87], [45, 0.78, 0.63, 1.32]],
    breaths: [7, 13, 19, 25, 34, 40] },
  jingle: { style: "groove", cues: [[0, 1.02, 0.87], [12, 1.11, 0.98], [16, 0.96, 0.87], [32, 1.14, 1.08, 0.97], [56, 1.18, 1.16], [64, 1.02, 0.91, 1.14]],
    breaths: [8, 16, 24, 32, 40, 48, 56], entrances: [[5, 8], [6, 32], [7, 16]] },
  old: { style: "chorale", cues: [[0, 0.87, 0.70, 1.06], [9, 1.02, 0.84], [13, 1.10, 0.98], [17, 1.03, 0.94], [25, 1.11, 1.06], [32, 0.85, 0.78, 1.30]],
    breaths: [9, 17, 25], entrances: [[2, 5], [3, 8], [4, 16], [5, 8], [6, 16], [7, 12]] },
  bicycle: { style: "groove", cues: [[0, 1, 0.76], [9, 1.10, 0.96, 0.97], [16, 0.83, 0.66, 1.03], [22, 1.09, 1.04, 0.98], [32, 0.77, 0.66, 1.19]],
    breaths: [9, 16.5, 24], entrances: [[5, 8], [6, 8], [7, 8]] },
  signal: { style: "ballad", cues: [[0, 0.94, 0.66, 1.05], [8, 0.98, 0.77], [16, 1.08, 0.97], [22, 1.15, 1.12], [28, 1.02, 0.85, 1.12], [32, 0.82, 0.69, 1.22]],
    breaths: [8, 16, 24, 28], entrances: [[1, 8], [2, 8], [4, 12], [5, 8], [6, 16], [7, 8]],
    speech: { seconds: 3.70, lines: [
      { text: "A light across the water.", ipa: "ə lˈaɪt əkɹˈɔs ðə wˈɔtɚ", pitch: 148 },
      { text: "Do you see it?", ipa: "du ju sˈi ɪt", pitch: 159, question: true },
    ] } },
  night: { style: "ballad", cues: [[0, 0.86, 0.65, 1.04], [8, 0.97, 0.79], [15, 0.82, 0.67], [22, 1.15, 1.04], [28, 0.96, 0.82, 1.08], [32, 0.75, 0.64, 1.28]],
    breaths: [8, 16, 24], entrances: [[1, 4], [2, 4], [4, 16], [5, 8], [6, 16], [7, 8]],
    speech: { seconds: 2.80, lines: [
      { text: "Easy now.", ipa: "ˈizi nˈaʊ", pitch: 140 },
      { text: "The shore is close.", ipa: "ðə ʃˈɔɹ ɪz klˈoʊs", pitch: 151 },
    ] } },
  paper: { style: "chorale", cues: [[0, 0.97, 0.73], [8, 1.06, 0.96, 0.98], [12, 1.15, 1.06], [20, 1.01, 0.91], [26, 1.11, 1.01], [32, 0.81, 0.73, 1.24]],
    breaths: [8, 16, 24, 28], entrances: [[5, 4], [6, 8], [7, 8]] },
};

const style = {
  lullaby: { swing: 0, lift: 0.05, vibrato: 18, brightness: 0.19, breathiness: 0.22, scoop: 24 },
  round: { swing: 0, lift: 0.11, vibrato: 13, brightness: 0.31, breathiness: 0.14, scoop: 0 },
  groove: { swing: 0.09, lift: 0.16, vibrato: 22, brightness: 0.37, breathiness: 0.14, scoop: 66 },
  chorale: { swing: 0, lift: 0.07, vibrato: 25, brightness: 0.28, breathiness: 0.14, scoop: 32 },
  ballad: { swing: 0, lift: 0.05, vibrato: 36, brightness: 0.23, breathiness: 0.19, scoop: 72 },
} satisfies Record<Style, { swing: number; lift: number; vibrato: number; brightness: number; breathiness: number; scoop: number }>;

function planSpeech(speech: NonNullable<Direction["speech"]>, bpm: number) {
  function planLine(line: Line, t0: number, rate: number) {
    const segments = tokenizeIpa(line.ipa);
    const plan = planUtterance(segments, {
      body: HEADS[0].body, t0, f0: line.pitch, rate, accent: 0.13,
      intonation: line.question ? "question" : "statement",
    });
    return { text: line.text, segments, plan };
  }

  let at = PREROLL;
  const lines = speech.lines.map((line) => {
    const planned = planLine(line, at, 0.92);
    at = planned.plan.end + (line.pauseAfter ?? 0.24);
    return planned;
  });
  const seconds = speech.seconds ?? at - PREROLL;
  const beatSeconds = 60 / bpm;
  speech.countIn?.forEach((line, beat) => {
    lines.push(planLine(line, PREROLL + seconds + beat * beatSeconds, Math.max(1.45, bpm / 70)));
  });
  return { lines, pitch: speech.lines[0].pitch, seconds: seconds + (speech.countIn?.length ?? 0) * beatSeconds };
}

export function songPerformance(song: Song, bpm: number, preset: boolean) {
  const direction = directions[song.id];
  const color = style[direction.style];
  const cues = direction.cues.map(([beat, lead, choir, stretch = 1]) => ({ beat, lead, choir, stretch }));
  const beatSeconds = 60 / bpm;
  const speech = direction.speech && planSpeech(direction.speech, bpm);
  const introSeconds = speech?.seconds ?? 0;
  const entrances = new Map(preset ? direction.entrances : undefined);
  const canonOffsets = direction.style === "round" ? [0, 8, 0, 16, 0, 0, 24, 0] : undefined;

  function timeAt(beat: number): number {
    let beats = 0;
    for (let i = 0; i < cues.length; i++) {
      const a = cues[i];
      const b = cues[i + 1];
      if (!b) return (beats + (beat - a.beat) * a.stretch) * beatSeconds;
      const span = b.beat - a.beat;
      const used = Math.min(beat - a.beat, span);
      const stretchAtEnd = a.stretch + (b.stretch - a.stretch) * used / span;
      beats += used * (a.stretch + stretchAtEnd) / 2;
      if (used < span) break;
    }
    return beats * beatSeconds;
  }

  function melody(head: number, note: Note): boolean {
    return head === 0 || !!canonOffsets?.[head] || note.id.startsWith("answer-");
  }

  function emphasis(beat: number, lead: boolean): number {
    const i = cues.findIndex((cue) => cue.beat > beat);
    const key = lead ? "lead" : "choir";
    if (i <= 0) return cues.at(i === -1 ? -1 : 0)![key];
    const a = cues[i - 1], b = cues[i];
    return a[key] + (b[key] - a[key]) * (beat - a.beat) / (b.beat - a.beat);
  }

  return {
    color, speech, introSeconds, timeAt, melody,
    notes: (notes: Note[], head: number) => notes.filter((note) => note.beat >= (entrances.get(head) ?? 0)),
    noteTime(beat: number, head: number): number {
      // Breathe around a shared pulse. The bass stays on it and the choir enters a hair apart.
      const delay = [0.012, 0.023, 0, 0.029, 0.009, 0.033, 0.018, 0.027][head];
      const lift = color.swing * Math.sin(Math.PI * beat) ** 2;
      return introSeconds + timeAt(beat + lift) + delay;
    },
    breathBefore(head: number, note: Note): boolean {
      if (!melody(head, note)) return false;
      const beat = note.beat - (canonOffsets?.[head] ?? 0);
      return direction.breaths.some((cue) => Math.abs(cue - beat) < 0.002);
    },
    drive(head: number, note: Note): number {
      const beat = note.beat;
      const lead = melody(head, note);
      const unit = song.id === "grace" && preset ? (beat - 1) / 3 : beat / 2;
      const onPulse = Math.abs(unit - Math.round(unit)) < 0.045;
      const accent = onPulse ? color.lift : 0;
      return Math.min(1.26, emphasis(beat, lead) + accent);
    },
    source(head: number) {
      return {
        brightness: color.brightness + [0.045, 0.025, -0.08, 0.04, 0.035, -0.025, 0.055, -0.065][head],
        breathiness: color.breathiness + [0.025, 0.015, -0.04, 0.01, 0.015, 0, 0.045, 0.02][head],
        tension: [0.55, 0.51, 0.45, 0.52, 0.49, 0.49, 0.51, 0.45][head],
        vibratoRate: [5.5, 5.8, 4.8, 5.9, 5.3, 5.2, 6.1, 4.9][head],
        drift: head === 0 ? 4 : 6,
        f0: head === 0 && speech ? speech.pitch : 110,
      };
    },
  };
}
export type SongPerformance = ReturnType<typeof songPerformance>;
