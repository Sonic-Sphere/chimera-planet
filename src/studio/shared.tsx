import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { HEADS, headNumber } from "../heads.ts";
import type { EnsembleAudio, Mix } from "./audio.ts";
import { HEAD_COLORS } from "./songbook.ts";

export function colorStyle(head: number): CSSProperties {
  return { "--voice": HEAD_COLORS[head] } as CSSProperties;
}

export function useDraft<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? initial; }
    catch { return initial; }
  });
  return [value, (next) => {
    setValue(next);
    try { localStorage.setItem(key, JSON.stringify(next)); }
    catch { /* The draft remains editable in this tab when storage is unavailable. */ }
  }];
}

export const emptyMix = (): Mix => ({ muted: HEADS.map(() => false), solo: null });

export function useTransport(audio: EnsembleAudio, active: boolean, length: number) {
  const [phase, setPhase] = useState<"idle" | "loading" | "playing" | "paused">("idle");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(-1);
  const sequence = useRef(0);
  const stop = () => {
    sequence.current++;
    audio.stop();
    setPhase("idle");
    setElapsed(-1);
  };

  useEffect(() => {
    if (!active) {
      sequence.current++;
      setPhase("idle");
      setElapsed(-1);
    }
  }, [active]);

  useEffect(() => {
    if (phase !== "playing" || !active) return;
    let request = 0;
    const update = () => {
      if (audio.error) {
        stop();
        setError("Audio stopped. Play again to restart the voice engine.");
        return;
      }
      if (audio.elapsed >= length) { stop(); return; }
      setElapsed(audio.elapsed);
      request = requestAnimationFrame(update);
    };
    request = requestAnimationFrame(update);
    return () => cancelAnimationFrame(request);
  }, [phase, active, audio, length]);

  async function play(run: () => Promise<boolean>) {
    const token = ++sequence.current;
    setPhase("loading");
    setError("");
    try {
      const started = await run();
      if (token === sequence.current) setPhase(started ? "playing" : "idle");
    } catch (error) {
      if (token !== sequence.current) return;
      console.error(error);
      stop();
      setError("Audio could not start. Check your browser audio and try again.");
    }
  }

  async function pause() {
    const token = ++sequence.current;
    setPhase("paused");
    try {
      await audio.pause();
    } catch (error) {
      if (token !== sequence.current) return;
      console.error(error);
      stop();
      setError("Audio could not pause. Play again to restart the song.");
    }
  }
  return { phase, elapsed, error, play, pause, stop };
}

export function PlayButton({ phase, play, stop, label }: {
  phase: ReturnType<typeof useTransport>["phase"]; play: () => void; stop: () => void; label: string;
}) {
  return <button type="button" className="studio-play" onClick={phase === "idle" ? play : stop}>
    <span aria-hidden="true">{phase === "idle" ? "▶" : "■"}</span>
    {phase === "idle" ? label : phase === "loading" ? "Cancel" : "Stop"}
  </button>;
}

export function VoiceStrip({ head, select, roles, mix, playing }: {
  head: number; select: (head: number) => void; roles: string[]; mix: Mix; playing: (string | undefined)[];
}) {
  return <div className="studio-voices" role="group" aria-label="Choose a head">
    {roles.map((role, i) => <button type="button" key={role} style={colorStyle(i)} aria-pressed={head === i}
      className={`studio-voice${playing[i] ? " sounding" : ""}${(mix.solo !== null ? mix.solo !== i : mix.muted[i]) ? " muted" : ""}`}
      onClick={() => select(i)} aria-label={`Head ${headNumber(i)} · ${role}`}>
      <span className="voice-number"><i aria-hidden="true" />{headNumber(i)}<em aria-hidden="true">{playing[i]}</em></span><strong>{role}</strong>
    </button>)}
  </div>;
}

export function MixButtons({ head, mix, change }: { head: number; mix: Mix; change: (mix: Mix) => void }) {
  return <div className="studio-mix" role="group" aria-label={`Mix head ${headNumber(head)}`}>
    <button type="button" aria-pressed={mix.muted[head]} onClick={() => change({
      ...mix, muted: mix.muted.map((value, i) => i === head ? !value : value),
      solo: mix.solo === head ? null : mix.solo,
    })}>Mute</button>
    <button type="button" aria-pressed={mix.solo === head} onClick={() => change({
      ...mix, solo: mix.solo === head ? null : head,
      muted: mix.muted.map((value, i) => i === head && mix.solo !== head ? false : value),
    })}>Solo</button>
  </div>;
}

export function BlockTitle({ index, title, children }: { index: string; title: string; children?: ReactNode }) {
  return <div className="studio-block-title">
    <h3><span>{index}</span>{title}</h3>{children}
  </div>;
}

export function BeatCounter({ measure, total, unit }: { measure: number; total: number; unit: string }) {
  const padded = (n: number) => String(n).padStart(2, "0");
  return <div className="studio-counter"><span>{unit}</span><strong>{padded(measure)}<small> / {padded(total)}</small></strong></div>;
}
