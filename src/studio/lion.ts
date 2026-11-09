import { HEADS } from "../heads.ts";
import type { Note, Song } from "./songbook.ts";

const bpm = 122;
const tonic = 65;
// Bass, low, middle and high voicings for I, IV, I, V.
const chords = [[-12, 0, 4, 7], [-19, 0, 5, 9], [-12, 0, 4, 7], [-17, -1, 2, 7]];
const chant = [
  [0, 0.58, "wee"], [0.625, 0.33, "ma"], [1, 0.58, "weh"], [1.625, 0.33, "ah"],
] as const;
const call = "0 2 4:.5 2:.5 4 | 5 4 2:.5 0:.5 2 | 4 -5 -5:1.5 -5:.5 | -5:4";
const answer = "7:4 | 5 7 5:2 | 4 -5 -5:1.5 -5:.5 | -5:4";
const verseTail = "5 4 2:.5 0:.5 2 | 4 2 0 4 | 2:4";
const verse = `0 2 4:.5 2:.5 4 | ${verseTail}`;
const verseAnswer = `7 4 2:.5 4:.5 7 | ${verseTail}`;
const callSyllables = "wee ee ee ee ee ee ee ee ee ee ee oo mm oh weh";
const answerSyllables = "wee ee ee ee ee oo mm oh weh";
const titleLine = "the li-/lye- on/uhn sleeps to-/tuh- night";
const verseSyllables = `doo da ba da doo ba da ba da ${titleLine}`;

export function lionSong(): Song {
  const tracks: Note[][] = HEADS.map(() => []);
  const sections = [
    { kind: "opening", bars: 8 },
    { kind: "chorus", bars: 8 },
    { kind: "verse", bars: 8 },
    { kind: "chorus", bars: 8 },
    { kind: "verse", bars: 8 },
    { kind: "break", bars: 16 },
    { kind: "verse", bars: 8 },
    { kind: "outro", bars: 16 },
  ] as const;
  const bars = sections.reduce((sum, section) => sum + section.bars, 0);
  function add(head: number, beat: number, duration: number, interval: number, lyric: string, pronunciation?: string) {
    const track = tracks[head];
    track.push({ id: `lion-${head}-${track.length}`, beat, duration, midi: tonic + interval, lyric, pronunciation });
  }
  function phrase(head: number, bar: number, pitches: string, lyrics: string, octave = 0) {
    let beat = bar * 4;
    const syllables = lyrics.split(" ");
    pitches.replaceAll("|", "").trim().split(/\s+/).forEach((token, index) => {
      const [pitch, length = "1"] = token.split(":");
      const duration = Number(length);
      const [lyric, pronunciation] = syllables[index].split("/");
      add(head, beat, duration, Number(pitch) + octave, lyric, pronunciation);
      beat += duration;
    });
  }

  let firstBar = 0;
  for (const { kind, bars: sectionBars } of sections) {
    if (kind === "verse") {
      phrase(0, firstBar, verse, verseSyllables);
      phrase(0, firstBar + 4, verseAnswer, verseSyllables);
    } else if (kind === "opening" || kind === "break" || kind === "outro") {
      const head = kind === "break" ? 6 : 0;
      phrase(head, firstBar, call, callSyllables, 12);
      phrase(head, firstBar + 4, answer, answerSyllables, 12);
      if (kind === "break") {
        phrase(3, firstBar + 8, call, callSyllables);
        phrase(6, firstBar + 12, answer, answerSyllables, 12);
      }
    }

    for (let bar = 0; bar < sectionBars; bar++) {
      const absoluteBar = firstBar + bar;
      if (kind === "opening" && bar < 4) continue;
      const at = absoluteBar * 4;
      const last = absoluteBar === bars - 1;
      const [bass, low, middle, high] = chords[last ? 0 : absoluteBar % 4];
      add(2, at, last ? 3.65 : 1.1, bass, last ? "oh" : "dum");
      if (last) {
        add(1, at, 3.65, middle, "oo");
        add(5, at, 3.65, high, "oo");
        add(7, at, 3.65, low, "mmm");
        continue;
      }
      add(2, at + 2, 1.08, bass, "dum");
      add(7, at + 0.08, 3.55, bass + 12, "oo");
      if (kind === "verse") {
        add(5, at + 0.5, 3.1, middle, "oo");
        add(1, at + 2.5, 1.05, high, "ah");
        continue;
      }
      for (const [offset, duration, lyric] of chant) {
        add(4, at + offset, duration, middle, lyric);
        if (kind !== "opening") add(5, at + offset + 0.02, duration, low, lyric);
        if (kind === "chorus" || kind === "outro") add(1, at + 2 + offset, duration, high, lyric);
      }
    }
    firstBar += sectionBars;
  }
  return {
    id: "lion", title: "The Lion Sleeps Tonight", kind: "A cappella", bpm, bars, tracks,
    credit: "After the Tokens’ 1961 recording and Solomon Linda’s Mbube.",
  };
}
