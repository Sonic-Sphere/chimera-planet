import type { BodyMix, HumanArtic } from "../vendor/chimera/src/wasm/types.ts";

// Six voices in the original Bongo Chorus ring, then the two poles.
export const HEADS: readonly { body: BodyMix; pole?: 1 | -1 }[] = [
  { body: { female: 0.12, child: 0 } },
  { body: { female: 0.56, child: 0 } },
  { body: { female: 0, child: 0 } },
  { body: { female: 1, child: 0 } },
  { body: { female: 0.3, child: 0.38 } },
  { body: { female: 0.73, child: 0 } },
  { body: { female: 0.43, child: 0 }, pole: 1 },
  { body: { female: 0.84, child: 0.12 }, pole: -1 },
];

export const headNumber = (index: number) => String(index + 1).padStart(2, "0");

export interface HeadState {
  body: BodyMix;
  artic: HumanArtic;
}

export type InstrumentMessage = { type: "bongo:head"; state: HeadState; ready?: true };
export type ShellMessage = { type: "bongo:active"; active: boolean };
