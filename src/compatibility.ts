import type { Edition, Slot } from "./types";
export const GAIN_CONSTANT = 0.015;
export const RELEASE = GAIN_CONSTANT * 6;
export const GUARD = 0.5;
export const newSlots = (): Slot[] =>
  Array.from({ length: 7 }, (_, index) => ({
    index,
    part: null,
    token: 0,
    ready: false,
    joined: Infinity,
    muted: false,
    solo: false,
    removing: null,
    assignedAt: 0,
  }));
// Web Audio truncates the original silent buffer's length to whole frames.
export function phaseDuration(edition: Edition): number {
  return edition.timing.sourceSilentClockFramesPerPhase / 44100;
}
export function boundaryTime(
  epoch: number,
  phase: number,
  duration: number,
  rate: number,
): number {
  return Math.round((epoch + phase * duration) * rate) / rate;
}
export function phaseAt(time: number, epoch: number, duration: number): number {
  return Math.max(0, Math.floor((time - epoch + 1e-9) / duration));
}
export function animationFrame(elapsed: number, edition: Edition): number {
  const half = edition.timing.animationFramesPerPhase;
  return Math.max(
    0,
    Math.min(
      half - 1,
      Math.floor(
        (elapsed * 1000 * half) / edition.timing.sourcePhaseDurationMs,
      ),
    ),
  );
}
export function sourceFrame(
  frameInPhase: number,
  phase: number,
  length: number,
  total: number,
): number {
  return Math.max(
    0,
    Math.min(
      length - 1,
      frameInPhase + (phase % 2 === 1 && length === total ? total / 2 : 0),
    ),
  );
}
export function canAssign(slots: Slot[], slot: number, part: string): boolean {
  return (
    Number.isInteger(slot) &&
    slot >= 0 &&
    slot < 7 &&
    !slots[slot].part &&
    !slots.some((s) => s.part === part)
  );
}
export function guardedRemoval(remaining: number): boolean {
  return remaining < GUARD;
}
export function guardedRestore(remaining: number): boolean {
  return remaining <= GUARD;
}
export function bonusBoundary(next: number, onlyA: boolean, shift = 0): number {
  return onlyA && (next + shift) % 2 ? next + 1 : next;
}
