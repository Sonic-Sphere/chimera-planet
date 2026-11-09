import type { BodyMix, HumanArtic } from "../vendor/chimera/src/wasm/types.ts";

// Six voices in the original Bongo Chorus ring, then the voice overhead.
export const HEADS: readonly { body: BodyMix; yaw: number }[] = [
  { body: { female: 0.12, child: 0 }, yaw: -135 },
  { body: { female: 0.56, child: 0 }, yaw: -47 },
  { body: { female: 0, child: 0 }, yaw: -39 },
  { body: { female: 1, child: 0 }, yaw: -53 },
  { body: { female: 0.3, child: 0.38 }, yaw: -131 },
  { body: { female: 0.73, child: 0 }, yaw: -143 },
  { body: { female: 0.43, child: 0 }, yaw: -52 },
];

export const headNumber = (index: number) => String(index + 1).padStart(2, "0");

export interface HeadState {
  body: BodyMix;
  artic: HumanArtic;
}

export type InstrumentMessage = { type: "bongo:head"; state: HeadState; ready?: true };
export type ShellMessage = { type: "bongo:active"; active: boolean };
