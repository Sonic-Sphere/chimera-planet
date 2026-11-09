import { HEADS } from "../heads.ts";

export interface Note {
  id: string;
  beat: number;
  duration: number;
  midi: number;
  lyric: string;
}

export type SongDraft = { tracks: Note[][]; bpm: number };
export const SONG_DRAFT_KEY = "bongo-chimera.song-drafts.v1";

export interface Song {
  id: string;
  title: string;
  kind: string;
  bpm: number;
  bars: number;
  tracks: Note[][];
  credit?: string;
}

export const SONG_ROLES = ["Lead", "Upper", "Bass", "Answer", "Pulse", "Tenor", "Descant", "Low pad"];
export const BEAT_ROLES = ["Kick", "Snare", "Hats", "Clicks", "Hum bass", "Rim", "Open hat", "Fills"];
export const HEAD_COLORS = ["#80e4cb", "#82c3ff", "#f0b877", "#f5a5c1", "#b6dc80", "#b3a9ff", "#f1d57f", "#7bd9ec"];
export const MIN_MIDI = 42;
export const MAX_MIDI = 84;

interface Tune {
  id: string;
  title: string;
  kind: string;
  bpm: number;
  root: number;
  melody: string;
  lyrics: string;
  chords: string;
  credit?: string;
  canon?: boolean;
}

// Chromatic intervals from the tonic, with a beat length after ':'. r is a rest.
const tunes: Tune[] = [
  {
    id: "lion", title: "The Lion Sleeps Tonight", kind: "Wordless refrain", bpm: 108, root: 60,
    melody: "7:.5 4:.5 2:.5 4:2.5 | 7:.5 5:.5 4:.5 2:.5 0:2 | 2:.5 4:.5 2:.5 0:.5 4:1 2:1 | r:4 | 7:.5 4:.5 2:.5 4:2.5 | 7:.5 5:.5 4:.5 2:.5 0:2 | 2:.5 4:.5 2:.5 0:.5 2:1 0:1 | r:4",
    lyrics: "doo ba da ah doo ba da ba oh da da doo ba ah oo doo ba da ah doo ba da ba oh da da doo ba ah oh",
    chords: "I IV I V I IV V I", credit: "Based on Solomon Linda’s Mbube. This short arrangement uses vocal syllables.",
  },
  {
    id: "twinkle", title: "Twinkle, Twinkle, Little Star", kind: "Lullaby", bpm: 92, root: 60,
    melody: "0 0 7 7 | 9 9 7:2 | 5 5 4 4 | 2 2 0:2 | 7 7 5 5 | 4 4 2:2 | 7 7 5 5 | 4 4 2:2 | 0 0 7 7 | 9 9 7:2 | 5 5 4 4 | 2 2 0:2",
    lyrics: "twink- le twink- le lit- tle star how I won- der what you are up a- bove the world so high like a dia- mond in the sky twink- le twink- le lit- tle star how I won- der what you are",
    chords: "I IV IV V I V I V I IV IV V",
  },
  {
    id: "row", title: "Row, Row, Row Your Boat", kind: "Round", bpm: 108, root: 60, canon: true,
    melody: "0 0 0:.5 2:.5 4 | 4:.5 2:.5 4:.5 5:.5 7:2 | 12:.333 12:.333 12:.334 7:.333 7:.333 7:.334 4:.333 4:.333 4:.334 0:.333 0:.333 0:.334 | 7:.5 5:.5 4:.5 2:.5 0:2",
    lyrics: "row row row your boat gent- ly down the stream mer- ri- ly mer- ri- ly mer- ri- ly mer- ri- ly life is but a dream",
    chords: "I I I I I I I I I I",
  },
  {
    id: "joy", title: "Ode to Joy", kind: "Chorale", bpm: 104, root: 60,
    melody: "4 4 5 7 | 7 5 4 2 | 0 0 2 4 | 4:1.5 2:.5 2:2 | 4 4 5 7 | 7 5 4 2 | 0 0 2 4 | 2:1.5 0:.5 0:2",
    lyrics: "joy- ful joy- ful we a- dore thee light of glo- ry voice of song hearts un- fold like flow- ers be- fore thee let morn- ing lead us on",
    chords: "I V I V I V I I",
  },
  {
    id: "frere", title: "Frère Jacques", kind: "Round · wordless", bpm: 112, root: 62, canon: true,
    melody: "0 2 4 0 | 0 2 4 0 | 4 5 7:2 | 4 5 7:2 | 7:.5 9:.5 7:.5 5:.5 4 0 | 7:.5 9:.5 7:.5 5:.5 4 0 | 0 -5 0:2 | 0 -5 0:2",
    lyrics: "da da doo da da da doo da doo da dee doo da dee la la la la doo da la la la la doo da ding dong dum ding dong dum",
    chords: "I I I I I I I I I I I I I I",
  },
  {
    id: "mary", title: "Mary Had a Little Lamb", kind: "Nursery tune", bpm: 116, root: 62,
    melody: "4 2 0 2 | 4 4 4:2 | 2 2 2:2 | 4 7 7:2 | 4 2 0 2 | 4 4 4 4 | 2 2 4 2 | 0:4",
    lyrics: "Mar- y had a lit- tle lamb lit- tle lamb lit- tle lamb Mar- y had a lit- tle lamb its fleece was white as snow",
    chords: "I I V I I I V I",
  },
  {
    id: "bridge", title: "London Bridge", kind: "Playground song", bpm: 118, root: 60,
    melody: "7:1.5 9:.5 7 5 | 4 5 7:2 | 2 4 5:2 | 4 5 7:2 | 7:1.5 9:.5 7 5 | 4 5 7:2 | 2:2 7:2 | 4 0:3",
    lyrics: "Lon- don Bridge is fall- ing down fall- ing down fall- ing down Lon- don Bridge is fall- ing down my fair la- dy",
    chords: "I I V I IV I V I",
  },
  {
    id: "saints", title: "When the Saints Go Marching In", kind: "Processional", bpm: 120, root: 60,
    melody: "0 4 5 7 | r:4 | 0 4 5 7 | r:4 | 0 4 5 7 | 4 0 4 2 | 4 4 2 0 | 0 4 7 7 | 7 5 4 5 | 7:.75 4:.75 2:.5 0:2",
    lyrics: "oh when the saints oh when the saints oh when the saints go march- ing in oh I want to be in that num- ber when the saints go march- ing in",
    chords: "I I I I IV I V I IV V",
  },
  {
    id: "grace", title: "Amazing Grace", kind: "Hymn · wordless", bpm: 76, root: 65,
    melody: "-5 | 0:2 4:.5 0:.5 | 4:2 2 | 0:2 -5 | -5:2 0 | 0:2 4:.5 0:.5 | 4:2 2 | 7:5 4 | 7:1.5 4:.5 7:.5 4:.5 | 0:2 -5 | -3:1 -5:1 -5:1 | 0:2 4:.5 0:.5 | 4:2 2 | 0:5",
    lyrics: "ah ma zii ah gray ah oo ah hmm ah oh ma oh la ah ay ee oh ah oo ah hmm oo hmm ah ma oh la ah oo ah oh",
    chords: "I I IV I I I V I IV I V I",
  },
  {
    id: "jingle", title: "Jingle Bells", kind: "Winter song", bpm: 124, root: 60,
    melody: "4 4 4:2 | 4 4 4:2 | 4 7 0 2 | 4:4 | 5 5 5:1.5 5:.5 | 5 4 4 4:.5 4:.5 | 4 2 2 4 | 2:2 7:2 | 4 4 4:2 | 4 4 4:2 | 4 7 0 2 | 4:4 | 5 5 5:1.5 5:.5 | 5 4 4 4:.5 4:.5 | 7 7 5 2 | 0:4",
    lyrics: "jin- gle bells jin- gle bells jin- gle all the way oh what fun it is to ride in a one horse o- pen sleigh hey jin- gle bells jin- gle bells jin- gle all the way oh what fun it is to ride in a one horse o- pen sleigh",
    chords: "I I I I IV I V V I I I I IV I V I",
  },
  {
    id: "old", title: "Auld Lang Syne", kind: "Folk air · wordless", bpm: 94, root: 65,
    melody: "-5 | 0:1.5 0:.5 0 4 | 2:1.5 0:.5 2 4 | 0:1.5 0:.5 4 7 | 9:3 9 | 7:1.5 4:.5 4 0 | 2:1.5 0:.5 2 4 | 0:1.5 -3:.5 -3 -5 | 0:3",
    lyrics: "ah oh oh oo ah eh ah eh ah oo oo ah oh ah oo oh aa eh ah eh ah oh uh oo ah oh oo oh",
    chords: "I V I IV I V V I",
  },
  {
    id: "bicycle", title: "Bicycle Bell", kind: "Original · syncopated", bpm: 126, root: 62,
    melody: "r:.5 0:.5 4 7:.5 9:1.5 | 7:.5 4:.5 2 4:2 | r:1 5:.5 9:.5 12 9 | 7:.5 5:.5 2 0:2 | r:.5 4:.5 7 9:.5 11:1.5 | 12:.5 9:.5 7 4:2 | 5:.5 4:.5 2 5 7 | 4:.5 2:.5 0:3",
    lyrics: "ring my sil- ver bell turn the cor- ner wheel me down the hill we go qui- et through the square ring it once then let it fade slow- ly a- way",
    chords: "I I IV V vi I IV I",
  },
  {
    id: "signal", title: "Signal at Dawn", kind: "Original · call and answer", bpm: 84, root: 62,
    melody: "0 3 7:2 | r:1 5 3 2 | 0:2 7 10 | 8:2 7 r | 5:1.5 7:.5 8:2 | 7 5 3:2 | 2 3 5 2 | 0:4",
    lyrics: "send one light through the blue let it reach the shore keep it lit till the new morn- ing comes back home",
    chords: "i bVII i bVI iv i v i",
  },
  {
    id: "night", title: "Night Ferry", kind: "Original · slow harmony", bpm: 70, root: 64,
    melody: "0:2 3 7 | 10:3 7 | 8:2 5 3 | 2:3 r | 5:2 7 8 | 12:3 10 | 7:1.5 5:.5 3 2 | 0:4",
    lyrics: "slow boats car- ry lights past the stone pier keep one warm flame till we find the far shore",
    chords: "i bIII bVI v iv bVI i i",
  },
  {
    id: "paper", title: "Paper Kites", kind: "Original · bright close", bpm: 114, root: 60,
    melody: "0:.5 2:.5 4 7:2 | 9:.5 7:.5 4 2:2 | 5:.5 7:.5 9 12:2 | 11:.5 9:.5 7:3 | 12 11 9 7 | 4:2 2 4 | 5 9 7 2 | 0:4",
    lyrics: "pa- per kites rise pull the line tight let them ride high in the blue when the wind falls bring them home let the long day close",
    chords: "I vi IV V vi I IV I",
  },
];

const harmonies: Record<string, [number, number]> = {
  I: [0, 4], i: [0, 3], IV: [5, 4], V: [7, 4], vi: [9, 3],
  iv: [5, 3], v: [7, 3], bIII: [3, 4], bVI: [8, 4], bVII: [10, 4],
};

function arrange(tune: Tune): Song {
  const lyrics = tune.lyrics.split(" ");
  let beat = 0;
  let word = 0;
  const lead: Note[] = [];
  tune.melody.replaceAll("|", "").trim().split(/\s+/).forEach((token) => {
    const [pitch, length = "1"] = token.split(":");
    const duration = Number(length);
    if (pitch !== "r") lead.push({
      id: `lead-${word}`, beat, duration, midi: tune.root + Number(pitch),
      lyric: lyrics[word++] ?? "ah",
    });
    beat += duration;
  });
  const bars = Math.ceil(beat / 4 - 0.001) + (tune.canon ? 6 : 0);
  const chordNames = tune.chords.split(" ");
  const tracks: Note[][] = Array.from({ length: HEADS.length }, () => []);
  tracks[0] = lead;
  const add = (head: number, at: number, duration: number, midi: number, lyric: string) => {
    tracks[head].push({ id: `${head}-${tracks[head].length}`, beat: at, duration, midi, lyric });
  };

  // The hymn's pickup leads into three-beat measures. Leave the opening
  // phrase alone, then let the harmony grow up from the bass.
  if (tune.id === "grace") {
    const hymn = ["I", "I", "IV", "I", "I", "IV", "I", "V", "I", "IV", "I", "V", "I", "I"];
    hymn.forEach((chord, bar) => {
      if (bar < 2) return;
      const at = 1 + bar * 3;
      const last = bar === hymn.length - 1;
      const length = last ? 4.8 : 2.72;
      const [degree, third] = harmonies[chord];
      const root = tune.root + degree - (degree > 4 ? 12 : 0);
      add(2, at, length, root - 12, bar < 4 ? "moo" : "oh");
      if (bar >= 4) add(5, at + 0.1, length - 0.1, root - 12 + third, "oo");
      if (bar >= 5) add(1, at + 0.09, length - 0.12, root + 7, "oo");
      if (bar >= 6 && bar <= 8) {
        add(3, at + 0.22, length - 0.25, root + third, "ah");
        add(6, at + 0.46, length - 0.5, root + 12, "ooh");
      }
      if (bar >= 8) add(7, at + 0.18, length - 0.24, root - 5, "moo");
      if (last) add(4, at + 0.22, length - 0.28, root + third, "ah");
    });
    return { id: tune.id, title: tune.title, kind: tune.kind, bpm: tune.bpm, bars, tracks, credit: tune.credit };
  }

  if (tune.canon) {
    [2, 4, 6].forEach((offset, index) => {
      const head = [1, 3, 6][index];
      lead.forEach((note) => add(head, note.beat + offset * 4, note.duration, note.midi - (index === 1 ? 12 : 0), note.lyric));
    });
  }
  for (let bar = 0; bar < bars; bar++) {
    const [degree, third] = harmonies[chordNames[Math.min(bar, chordNames.length - 1)]];
    const root = tune.root + (degree > 5 ? degree - 12 : degree);
    const at = bar * 4;
    const last = bar === bars - 1;
    const lion = tune.id === "lion";
    if (tune.id === "saints" && (bar === 1 || bar === 3)) {
      lead.slice(0, 4).forEach((note, index) => {
        tracks[3].push({ ...note, id: `answer-${bar}-${index}`, beat: at + note.beat, duration: 0.82 });
        add(1, at + note.beat, 0.73, note.midi - [3, 4, 3, 3][index], index % 2 ? "ba" : "doo");
      });
      add(2, at, 0.8, root - 12, "dum");
      add(2, at + 2, 0.7, root - 5, "dum");
      continue;
    }
    const slow = tune.bpm < 95 && !lion;
    const finalRoot = last ? tune.root : root;
    if (!tune.canon && (bar > 0 || lion)) add(1, at + (slow ? 0 : 0.5), slow ? 3.5 : 3, finalRoot + (last ? 7 : third + 7), "oo");
    add(2, at, slow || (lion && last) ? 3.65 : lion ? 0.85 : 1.55, finalRoot - 12, slow || (lion && last) ? "oh" : lion ? "moo" : "dum");
    if (!slow && !last) add(2, at + 2, lion ? 0.88 : 1.35, root - (lion ? 12 : 5), lion ? "wah" : "dum");
    if (!tune.canon && (bar % 2 === 1 || lion)) {
      add(3, at + 2, slow ? 1.75 : 0.75, finalRoot + 7, lion ? "wah" : "ooh");
      if (!slow) add(3, at + 3, 0.75, finalRoot + (last ? 0 : third), "doo");
    }
    if (!slow && (bar > 0 || lion) && !last) {
      for (const pulse of lion ? [0.5, 1.5, 2.5, 3.5] : [1, 3]) add(4, at + pulse, 0.45, root + third, lion ? "weh" : "ba");
    } else if (slow && bar % 2 === 1) add(4, at + 0.5, 2.75, finalRoot, "ah");
    if (bar > 0) add(5, at + 0.1, slow ? 3.6 : 2.25, finalRoot - (last ? 5 : 12 - third), "oo");
    if (!tune.canon && bar >= 2 && bar % 2 === 0) {
      add(6, at + 1, 1, finalRoot + 12, "ah");
      add(6, at + 2, 1.65, finalRoot + (finalRoot + 12 + third <= MAX_MIDI ? 12 : 0) + third, "oo");
    }
    if (bar % 2 === 0 || last) add(7, at, last ? 3.65 : 2.75, finalRoot - 12, slow ? "mmm" : "oo");
  }
  if (tune.id === "signal") {
    const answer = lead.filter((note) => note.beat >= 5 && note.beat < 8);
    tracks[0] = lead.filter((note) => !answer.includes(note));
    tracks[3] = [
      ...answer.map((note) => ({ ...note, id: `answer-${note.id}` })),
      ...tracks[3].filter((note) => note.beat >= 8),
    ];
  }
  return { id: tune.id, title: tune.title, kind: tune.kind, bpm: tune.bpm, bars, tracks, credit: tune.credit };
}

export const SONGBOOK = tunes.map(arrange);

export function pitchName(midi: number): string {
  return `${["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][midi % 12]}${Math.floor(midi / 12) - 1}`;
}
