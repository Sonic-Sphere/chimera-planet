export interface Timing {
  bpm: number;
  sourcePhaseDurationMs: number;
  sourceSilentClockFramesPerPhase: number;
  sourceSilentClockSampleRateHz: number;
  animationFramesPerFullCycle: number;
  animationFramesPerPhase: number;
  idealPhaseDurationFromBpmMs: number;
  beatsPerPhase: number;
}
export interface Bonus {
  id: string;
  name: string;
  code: number[];
  phases: number;
  music: string;
  predrop: string | null;
  video: string;
  svg: string;
}
export interface Edition {
  id: string;
  name: string;
  version: number;
  year: string;
  folder: string;
  characterIds: string[];
  timing: Timing;
  colors: string[];
  bonuses: Bonus[];
  bonusloopA: boolean;
  bonusendloopA: boolean;
}
export interface Character {
  id: string;
  editionId: string;
  sourceIndex: number;
  sourceName: string;
  displayName: string;
  category: string;
  color: string;
  sprites: { full: string };
  animation: string;
  music: { a: string; b?: string };
  icon: { sheet: string; columnIndex: number; columnCount: number };
  extrusion: { model: string; source: string; durationSeconds: number };
}
export interface Catalog {
  version: number;
  editions: Edition[];
  characters: Character[];
}
export interface Slot {
  index: number;
  part: string | null;
  token: number;
  ready: boolean;
  joined: number;
  muted: boolean;
  solo: boolean;
  removing: number | null;
  assignedAt: number;
}
export type Command =
  | { type: "assign" | "replace"; slot: number; part: string }
  | { type: "remove" | "displace" | "mute" | "solo"; slot: number }
  | { type: "bonus"; id: string }
  | { type: "stop" | "play" | "cancelBonus" };
export interface PerformanceEvent {
  time: number;
  command: Command;
}
export interface PerformanceSave {
  format: "bongo-chorus";
  version: 1;
  edition: string;
  duration: number;
  events: PerformanceEvent[];
}
export interface PoseSource {
  sourceCanvas: [number, number];
  unitsPerPixel: number;
  headLayerOffset: number;
  heads: { renderHeight: number }[];
  frames: { sourceFrame: number; head: number; offset: [number, number] }[];
  durationSeconds: number;
}
export interface StatePart {
  crop: [number, number, number, number];
  width: number;
  height: number;
  renderHeight: number;
  shapes: { outer: [number, number][]; holes: [number, number][][] }[];
}
export interface StateSource {
  sheet: string;
  sheetSize: [number, number];
  unitsPerPixel: number;
  depth: number;
  parts: Record<string, StatePart>;
}
