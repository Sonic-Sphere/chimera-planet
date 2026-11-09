import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { BASS_NOTE, BEAT_SOUNDS } from "../../vendor/chimera/src/wasm/engine.ts";
import type { BeatStep } from "../../vendor/chimera/src/wasm/types.ts";
import { HEADS, headNumber } from "../heads.ts";
import { BEAT_STEPS, type EnsembleAudio, type Pattern } from "./audio.ts";
import { patternFor, PRESETS } from "./patterns.ts";
import { BEAT_ROLES, pitchName } from "./songbook.ts";
import { BeatCounter, BlockTitle, colorStyle, emptyMix, MixButtons, PlayButton, useDraft, useTransport, VoiceStrip } from "./shared.tsx";

const steps = Array.from({ length: BEAT_STEPS }, (_, i) => i);
const beatClass = (i: number, step: number) => `${i % 4 === 0 ? " downbeat" : ""}${step === i ? " now" : ""}`;
type Project = { name: string; bpm: number; swing: number; pattern: Pattern };
const presets = PRESETS.map((preset) => ({ ...preset, pattern: patternFor(preset) }));

function BeatOverview({ pattern, head, select, step }: {
  pattern: Pattern; head: number; select: (head: number) => void; step: number;
}) {
  return <div className="studio-beat-scroll"><div className="studio-beat-overview">
    {pattern.map((part, i) => <button type="button" className="studio-beat-track" key={i} aria-pressed={head === i}
      aria-label={`Edit head ${headNumber(i)} ${BEAT_ROLES[i]}, ${part.filter(Boolean).length} hits`} style={colorStyle(i)} onClick={() => select(i)}>
      <span className="studio-beat-track-name"><b>{headNumber(i)}</b>{BEAT_ROLES[i]}</span>
      {part.map((hit, j) => <span key={j} aria-hidden="true" className={`studio-mini-step${hit ? " hit" : ""}${beatClass(j, step)}`}>{hit?.id ?? "·"}</span>)}
    </button>)}
  </div></div>;
}

function StepGrid({ part, head, step, toggle, locked }: {
  part: (BeatStep | null)[]; head: number; step: number; toggle: (i: number, sound: string) => void; locked: boolean;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(0);
  function move(event: KeyboardEvent<HTMLButtonElement>, row: number, col: number) {
    const delta = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[event.key];
    if (!delta) return;
    event.preventDefault();
    const r = Math.min(BEAT_SOUNDS.length - 1, Math.max(0, row + delta[0]));
    const c = Math.min(BEAT_STEPS - 1, Math.max(0, col + delta[1]));
    grid.current?.querySelector<HTMLButtonElement>(`[data-cell="${r * BEAT_STEPS + c}"]`)?.focus();
  }
  return <div className="studio-beat-scroll" tabIndex={0} aria-label="Step sequencer, scroll for more steps">
    <div className="studio-step-grid" style={colorStyle(head)} ref={grid}>
      <div className="studio-step-row studio-step-ruler" aria-hidden="true"><span>SOUND</span>
        {steps.map((i) => <b key={i} className={beatClass(i, step)}>{String(i + 1).padStart(2, "0")}</b>)}
      </div>
      {BEAT_SOUNDS.map((sound, row) => <div className="studio-step-row" key={sound.id}>
        <span className="studio-sound-name" title={sound.hint}><b>{sound.id}</b>{sound.name}</span>
        {steps.map((i) => {
          const hit = part[i];
          const on = hit?.id === sound.id;
          const cell = row * BEAT_STEPS + i;
          return <button type="button" className={`studio-step${beatClass(i, step)}`} key={i} aria-pressed={on}
            aria-label={`${sound.name}, step ${i + 1}`} disabled={locked} data-cell={cell} tabIndex={cursor === cell ? 0 : -1}
            onFocus={() => setCursor(cell)} onKeyDown={(event) => move(event, row, i)}
            onClick={() => toggle(i, sound.id)}>
            {on ? (hit.note === undefined ? "●" : pitchName(hit.note)) : <span aria-hidden="true">·</span>}
          </button>;
        })}
      </div>)}
    </div>
  </div>;
}

export function Beatbox({ audio, active }: { audio: EnsembleAudio; active: boolean }) {
  const [project, saveProject] = useDraft<Project>("bongo-chimera.beat-draft.v1", presets[0]);
  const [head, setHead] = useState(0);
  const [mix, setMix] = useState(emptyMix);
  const [hum, setHum] = useState(BASS_NOTE);
  const { name, bpm, swing, pattern } = project;
  const transport = useTransport(audio, active, Infinity);
  const sixteenth = 60 / bpm / 4;
  const position = transport.elapsed / sixteenth;
  const flatStep = Math.floor(position);
  const step = position >= 0 ? (flatStep - (flatStep % 2 === 1 && position - flatStep < swing * 0.5 ? 1 : 0)) % BEAT_STEPS : -1;
  useEffect(() => {
    if (transport.phase === "playing") audio.setMix("beatbox", mix);
  }, [audio, mix, transport.phase]);

  function loadPreset(next: Project) {
    if (transport.phase !== "idle") transport.stop();
    setMix(emptyMix());
    saveProject(next);
  }
  function writePart(next: (BeatStep | null)[]) {
    saveProject({ ...project, pattern: pattern.map((part, i) => i === head ? next : part) });
    audio.setPattern(head, next);
  }
  function toggle(at: number, id: string) {
    writePart(pattern[head].map((hit, i) => i !== at ? hit : hit?.id === id ? null : id === "m" ? { id, note: hum } : { id }));
  }

  return <div className="studio studio-beat" style={{ "--steps": BEAT_STEPS } as CSSProperties}>
    <aside className="studio-library studio-grooves" aria-label="Groove presets">
      <div className="studio-library-title"><span className="studio-tag">MIKA / 02</span><h2>Grooves</h2><span>One loop, eight mouths</span></div>
      <div className="studio-groove-list">
        {presets.map((preset, i) => <button type="button" key={preset.name} aria-current={name === preset.name ? "true" : undefined}
          onClick={() => loadPreset(preset)}><span>{String(i + 1).padStart(2, "0")}</span><strong>{preset.name}</strong><small>{preset.rows.length ? `${preset.bpm} BPM` : "BLANK"}</small></button>)}
      </div>
      <p className="studio-library-foot">All hits are made by Chimera’s vocal tract.</p>
    </aside>
    <div className="studio-desk">
      <header className="studio-project">
        <div><p className="studio-tag">RHYTHM STUDIO</p><h2>Beatbox Chorus</h2><p>{name} <span>·</span> 16 steps <span>·</span> eight voices</p></div>
        <div className="studio-controls">
          <PlayButton phase={transport.phase} play={() => void transport.play(() => audio.playBeat(pattern, bpm, swing, mix))} stop={transport.stop} label="Play loop" />
          <label className="studio-knob">BPM<input key={bpm} type="number" aria-label="Beatbox tempo" min={50} max={180} defaultValue={bpm} disabled={transport.phase !== "idle"}
            onBlur={(e) => {
              const next = e.target.valueAsNumber;
              if (next >= 50 && next <= 180 && next !== bpm) saveProject({ ...project, bpm: next });
              else e.target.value = String(bpm);
            }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} /></label>
          <label className="studio-knob">SWING <output>{Math.round(swing * 100)}%</output><input type="range" aria-label="Swing" min={0} max={60} step={1}
            value={Math.round(swing * 100)} disabled={transport.phase !== "idle"} onChange={(e) => saveProject({ ...project, swing: Number(e.target.value) / 100 })} /></label>
          <BeatCounter measure={step < 0 ? 1 : step + 1} total={BEAT_STEPS} unit="STEP" />
        </div>
      </header>
      {transport.error && <p className="studio-error" role="alert">{transport.error}</p>}
      <VoiceStrip head={head} select={setHead} roles={BEAT_ROLES} mix={mix} playing={pattern.map((part) => part[step]?.id)} />
      <section className="studio-block">
        <BlockTitle index="01" title="Ensemble pattern"><span>Choose a row to edit its head</span></BlockTitle>
        <BeatOverview pattern={pattern} head={head} select={setHead} step={step} />
      </section>
      <section className="studio-block studio-step-block" style={colorStyle(head)}>
        <BlockTitle index="02" title="Step sequencer">
          <div className="studio-head-step">
            <button type="button" aria-label="Previous head" onClick={() => setHead((head + HEADS.length - 1) % HEADS.length)}>‹</button>
            <strong className="studio-selected-head">HEAD {headNumber(head)} / {BEAT_ROLES[head]}</strong>
            <button type="button" aria-label="Next head" onClick={() => setHead((head + 1) % HEADS.length)}>›</button>
          </div>
          <MixButtons head={head} mix={mix} change={setMix} />
        </BlockTitle>
        <StepGrid part={pattern[head]} head={head} step={step} toggle={toggle} locked={transport.phase === "loading"} />
        <div className="studio-editor studio-beat-editor">
          <span>One sound per head per step. Click a lit cell to erase it.</span>
          <label>New hum pitch <select value={hum} onChange={(e) => setHum(Number(e.target.value))}>
            {Array.from({ length: 25 }, (_, i) => i + 36).map((midi) => <option value={midi} key={midi}>{pitchName(midi)}</option>)}
          </select></label>
          <button type="button" disabled={!pattern[head].some(Boolean) || transport.phase === "loading"}
            onClick={() => writePart(steps.map(() => null))}>Clear head {headNumber(head)}</button>
        </div>
      </section>
      <footer className="studio-footer"><span>The loop repeats until you stop it. Edits are saved in this browser.</span></footer>
    </div>
  </div>;
}
