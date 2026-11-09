import { parseBeat } from "../../vendor/chimera/src/wasm/engine.ts";
import { HEADS } from "../heads.ts";
import { BEAT_STEPS, type Pattern } from "./audio.ts";

interface Preset {
  name: string;
  bpm: number;
  swing: number;
  rows: string[];
}

export const PRESETS: Preset[] = [
  { name: "Pocket", bpm: 96, swing: 0.16, rows: [
    "B . . . . . B . B . . B . . . .",
    ". . . . Pf . . . . . . . Pf . . .",
    "t . t . t . t . t . t . t . t t",
    ". . . ! . . . . . . ! . . . . !",
    "m:43 . . . . . m:43 . m:46 . . . . . m:41 .",
    ". . . . . . . K . . . . . K . .",
    ". . . . . . . . . . . . . . tss .",
    ". . . . . P! . . . . . . . . . ^K",
  ] },
  { name: "Half Time", bpm: 77, swing: 0.24, rows: [
    "B . . . . . B . . . B . . . . .",
    ". . . . . . . . Pf . . . . . . .",
    "t . t . . t t . t . . t t . t .",
    ". ! . . . . . ! . . . . . ! . .",
    "m:40 . . . m:43 . . . m:40 . . . m:38 . . .",
    ". . . . K . . . . . . . K . . .",
    ". . . . . . . . . . tss . . . . .",
    ". . . . . . . . . . . P! . . ^K .",
  ] },
  { name: "Fast Lane", bpm: 138, swing: 0.04, rows: [
    "B . . . B . . B B . . . B . . .",
    ". . . . Pf . . . . . . . Pf . . .",
    ". t t . . t t . . t t . . t t t",
    ". . ! . . . ! . . . ! . . . ! .",
    "m:45 . . . m:45 . . . m:48 . . . m:43 . . .",
    ". . . K . . . . . . . K . . . .",
    ". . tss . . . . . . . tss . . . . .",
    "kch . . . . . . . . . . . . P! ^K .",
  ] },
  { name: "Empty", bpm: 96, swing: 0, rows: [] },
];

export function patternFor(preset: Preset): Pattern {
  return HEADS.map((_, head) => {
    const steps = preset.rows[head] ? parseBeat(preset.rows[head]) : [];
    return Array.from({ length: BEAT_STEPS }, (_, step) => steps[step] ?? null);
  });
}
