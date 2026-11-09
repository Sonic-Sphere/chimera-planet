import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { headNumber } from "../heads.ts";
import { readSyllable, type EnsembleAudio } from "./audio.ts";
import { MAX_MIDI, MIN_MIDI, pitchName, SONG_ROLES, SONGBOOK, SONG_DRAFT_KEY, type Note, type Song, type SongDraft } from "./songbook.ts";
import { BeatCounter, BlockTitle, colorStyle, emptyMix, MixButtons, PlayButton, useDraft, useTransport, VoiceStrip } from "./shared.tsx";

const black = new Set([1, 3, 6, 8, 10]);
const beatWidth = 50;
const rowHeight = 23;

function Arrangement({ song, tracks, head, select, beat, cue, setCue }: {
  song: Song; tracks: Note[][]; head: number; select: (head: number) => void;
  beat: number; cue: number; setCue: (beat: number) => void;
}) {
  const end = song.bars * 4;
  return <div className="studio-arr-scroll">
    <div className="studio-arrangement" style={{ "--bars": song.bars, minWidth: `${118 + song.bars * 34}px` } as CSSProperties}>
      <span className="studio-ruler-label">BAR</span>
      <div className="studio-arr-ruler">
        {Array.from({ length: song.bars }, (_, bar) => <button type="button" key={bar} aria-label={`Cue bar ${bar + 1}`} aria-pressed={cue === bar * 4}
          onClick={() => setCue(bar * 4)}>{String(bar + 1).padStart(2, "0")}</button>)}
      </div>
      {tracks.map((notes, i) => <div className="studio-arr-row" key={i} style={colorStyle(i)}>
        <button type="button" className="studio-arr-name" aria-pressed={head === i} onClick={() => select(i)} aria-label={`Edit head ${headNumber(i)} ${SONG_ROLES[i]}`}>
          <span>{headNumber(i)}</span>{SONG_ROLES[i]}
        </button>
        <div className="studio-arr-lane" data-selected={head === i} aria-hidden="true" onClick={() => select(i)}>
          {notes.map((note) => <i key={note.id} style={{ left: `${note.beat / end * 100}%`, width: `${note.duration / end * 100}%` }} />)}
          <div className={`studio-cursor${beat >= 0 ? " moving" : ""}`} style={{ left: `${(beat >= 0 ? beat : cue) / end * 100}%` }} />
        </div>
      </div>)}
    </div>
  </div>;
}

function PianoRoll({ notes, bars, head, beat, cue, selected, select, add }: {
  notes: Note[]; bars: number; head: number; beat: number; cue: number; selected?: Note;
  select: (id: string) => void; add: (beat: number, midi: number) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const pitches = notes.map((note) => note.midi);
  const min = pitches.length ? Math.min(...pitches) : 60;
  const max = pitches.length ? Math.max(...pitches) : 60;
  const low = Math.max(MIN_MIDI, Math.min(min - 2, max - 12));
  const high = Math.min(MAX_MIDI, Math.max(max + 2, low + 12));
  const keys = Array.from({ length: high - low + 1 }, (_, i) => high - i);

  useEffect(() => {
    if (viewport.current) viewport.current.scrollLeft = Math.max(0, cue * beatWidth - beatWidth);
  }, [cue]);
  useEffect(() => {
    const pane = viewport.current;
    if (!pane || beat < 0) return;
    const x = beat * beatWidth;
    if (x < pane.scrollLeft || x > pane.scrollLeft + pane.clientWidth - 90) pane.scrollLeft = Math.max(0, x - beatWidth * 2);
  }, [beat]);

  function gridClick(event: MouseEvent<HTMLDivElement>) {
    const { left, top } = event.currentTarget.getBoundingClientRect();
    const at = Math.floor((event.clientX - left) / beatWidth * 2) / 2;
    const midi = high - Math.floor((event.clientY - top) / rowHeight);
    if (at >= 0 && at < bars * 4 && midi >= low && midi <= high) add(at, midi);
  }

  return <div className="studio-roll-scroll" ref={viewport} tabIndex={0} aria-label="Piano roll, scroll for more bars">
    <div className="studio-roll" style={{ ...colorStyle(head), "--beat-width": `${beatWidth}px`, "--row-height": `${rowHeight}px`, "--roll-width": `${bars * 4 * beatWidth}px` } as CSSProperties}>
      <span className="studio-roll-corner">PITCH</span>
      <div className="studio-roll-ruler" aria-hidden="true">
        {Array.from({ length: bars }, (_, bar) => <span key={bar}><b>{String(bar + 1).padStart(2, "0")}</b><i>2</i><i>3</i><i>4</i></span>)}
      </div>
      <div className="studio-keys" aria-hidden="true">
        {keys.map((midi) => <div key={midi} className={black.has(midi % 12) ? "dark" : ""}>{pitchName(midi)}</div>)}
      </div>
      <div className="studio-roll-grid" onClick={gridClick} aria-label="Notes for the selected head">
        {keys.map((midi) => <div aria-hidden="true" key={midi} className={`studio-pitch-row${black.has(midi % 12) ? " dark" : ""}${midi % 12 === 0 ? " octave" : ""}`} />)}
        {notes.map((note) => {
          const sounding = beat >= note.beat && beat < note.beat + note.duration;
          return <button type="button" className={`studio-note${sounding ? " sounding" : ""}`} key={note.id} aria-pressed={selected?.id === note.id}
            title={`${note.lyric} · ${pitchName(note.midi)}`}
            aria-label={`${note.lyric}, ${pitchName(note.midi)}, bar ${Math.floor(note.beat / 4) + 1} beat ${note.beat % 4 + 1}`}
            style={{ top: (high - note.midi) * rowHeight + 2, left: note.beat * beatWidth, width: note.duration * beatWidth }}
            onClick={(event) => { event.stopPropagation(); select(note.id); }}>{note.lyric}</button>;
        })}
        <div className={`studio-cursor${beat >= 0 ? " moving" : ""}`} style={{ left: (beat >= 0 ? beat : cue) * beatWidth }} />
      </div>
    </div>
  </div>;
}

function NoteEditor({ note, bars, onApply, onDelete }: {
  note: Note; bars: number; onApply: (note: Note) => string | undefined; onDelete?: () => void;
}) {
  const [error, setError] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const beat = (Number(data.get("bar")) - 1) * 4 + Number(data.get("beat")) - 1;
    const lyric = String(data.get("lyric")).trim();
    const pronunciation = lyric === note.lyric ? note.pronunciation : undefined;
    setError(onApply({ ...note, beat, midi: Number(data.get("pitch")), duration: Number(data.get("duration")), lyric, pronunciation }) ?? "");
  }
  return <form className="studio-note-form" onSubmit={submit}>
    <label>Syllable<input name="lyric" defaultValue={note.lyric} placeholder="ah" required maxLength={28} /></label>
    <label>Pitch<select name="pitch" defaultValue={note.midi}>
      {Array.from({ length: MAX_MIDI - MIN_MIDI + 1 }, (_, i) => MAX_MIDI - i).map((midi) => <option key={midi} value={midi}>{pitchName(midi)}</option>)}
    </select></label>
    <label>Bar<input type="number" name="bar" min={1} max={bars} defaultValue={Math.floor(note.beat / 4) + 1} required /></label>
    <label>Beat<input type="number" name="beat" min={1} max={4.875} step="any" defaultValue={Number((note.beat % 4 + 1).toFixed(3))} required /></label>
    <label>Length<input type="number" name="duration" min={0.25} max={bars * 4} step="any" defaultValue={note.duration} required /></label>
    <button type="submit">Apply note</button>
    {onDelete && <button type="button" className="studio-delete" onClick={onDelete}>Delete note</button>}
    {error && <p className="studio-error" role="alert">{error}</p>}
  </form>;
}

export function Songs({ audio, active, stageControls, watch }: {
  audio: EnsembleAudio; active: boolean; stageControls: HTMLElement; watch: () => void;
}) {
  const [drafts, saveDrafts] = useDraft<Record<string, SongDraft>>(SONG_DRAFT_KEY, {});
  const [song, setSong] = useState(SONGBOOK[0]);
  const { tracks, bpm } = drafts[song.id] ?? song;
  const [head, setHead] = useState(0);
  const [mix, setMix] = useState(emptyMix);
  const [cue, setCue] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [newNote, setNewNote] = useState<Note>();
  const [notice, setNotice] = useState("");
  const transport = useTransport(audio, active, (song.bars * 4 - cue) * 60 / bpm + 0.18);
  const beat = transport.elapsed >= 0 ? Math.min(song.bars * 4, cue + transport.elapsed * bpm / 60) : -1;
  const bar = Math.min(song.bars, Math.floor((beat >= 0 ? beat : cue) / 4) + 1);
  const now = tracks.map((notes) => notes.find((n) => beat >= n.beat && beat < n.beat + n.duration));
  const notes = tracks[head];
  const selectedNote = notes.find((note) => note.id === selected);
  const editor = selectedNote ?? newNote;
  useEffect(() => {
    if (transport.phase === "playing") audio.setMix("songs", mix);
  }, [audio, mix, transport.phase]);

  function choose(next: Song) {
    if (next === song) return;
    transport.stop();
    setSong(next);
    setCue(0);
    setHead(0);
    setMix(emptyMix());
    setSelected(undefined);
    setNewNote(undefined);
    setNotice("");
  }
  function chooseHead(next: number) {
    if (head === next) return;
    setHead(next);
    setSelected(undefined);
    setNewNote(undefined);
    setNotice("");
  }
  function selectNote(id: string) { setNewNote(undefined); setSelected(id); setNotice(""); }
  function writeTrack(next: Note[]) {
    if (transport.phase !== "idle") transport.stop();
    saveDrafts({ ...drafts, [song.id]: { bpm, tracks: tracks.map((track, i) => i === head ? next : track) } });
  }
  function apply(note: Note): string | undefined {
    if (!readSyllable(note.pronunciation ?? note.lyric)) return "Enter one singable syllable, such as “ah” or “light”. Split longer words across notes.";
    const end = note.beat + note.duration;
    if (end > song.bars * 4 + 0.00001) return "This note ends beyond the arrangement.";
    if (notes.some((n) => n.id !== note.id && note.beat < n.beat + n.duration - 0.00001 && end > n.beat + 0.00001)) {
      return "A head can sing one note at a time. Choose a free beat or shorten the note.";
    }
    writeTrack([...notes.filter((n) => n.id !== note.id), note].sort((a, b) => a.beat - b.beat));
    selectNote(note.id);
  }
  function addNote(at: number, midi: number, immediate: boolean) {
    const next = notes.find((n) => n.beat > at);
    const note = { id: crypto.randomUUID(), beat: at, duration: Math.max(0.25, Math.min(0.5, (next?.beat ?? song.bars * 4) - at)), midi, lyric: "ah" };
    setNotice("");
    if (immediate) setNotice(apply(note) ?? "");
    else { setSelected(undefined); setNewNote(note); }
  }
  function newAtGap() {
    let at = cue;
    for (const note of notes) {
      if (note.beat + note.duration <= at) continue;
      if (note.beat >= at + 0.25) break;
      at = note.beat + note.duration;
    }
    if (at + 0.25 > song.bars * 4) { setNotice("No space after this cue. Try an earlier bar."); return; }
    addNote(at, notes[0]?.midi ?? 60, false);
  }

  const play = () => void transport.play(() => audio.playSong(tracks, bpm, cue, mix));
  const chooseSong = (id: string) => choose(SONGBOOK.find((item) => item.id === id)!);

  return <div className="studio studio-song">
    {createPortal(<>
      <select aria-label="Performance song" value={song.id} onChange={(event) => chooseSong(event.target.value)}>
        {SONGBOOK.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
      <button type="button" className="chip stage-song-play" onClick={transport.phase === "idle" ? play : transport.stop}>
        <span aria-hidden="true">{transport.phase === "idle" ? "▶ " : "■ "}</span>
        {transport.phase === "idle" ? "Play song" : transport.phase === "loading" ? "Cancel" : "Stop"}
      </button>
      <span className="stage-song-bar">Bar {bar} / {song.bars}</span>
      {transport.error && <span className="stage-song-error" role="alert">{transport.error}</span>}
    </>, stageControls)}
    <aside className="studio-library" aria-label="Song library">
      <div className="studio-library-title"><span className="studio-tag">MIKA / 01</span><h2>Songbook</h2><span>15 a cappella arrangements</span></div>
      <label className="studio-mobile-library">Choose a song
        <select value={song.id} onChange={(e) => chooseSong(e.target.value)}>{SONGBOOK.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {s.title}</option>)}</select>
      </label>
      <ol className="studio-song-list">{SONGBOOK.map((s, i) => <li key={s.id}><button type="button" aria-current={song === s ? "true" : undefined} onClick={() => choose(s)}>
        <span>{String(i + 1).padStart(2, "0")}</span><strong>{s.title}</strong>{drafts[s.id] && <i aria-label="Edited" />}
      </button></li>)}</ol>
      <p className="studio-library-foot">Vocal synthesis · No backing tracks</p>
    </aside>
    <div className="studio-desk">
      <header className="studio-project">
        <div>
          <p className="studio-tag">SONGS / {song.kind}</p>
          <h2>{song.title}</h2>
          <p>{song.bars} bars <span>·</span> {tracks.filter((track) => track.length > 0).length} vocal parts{song.credit && <> <span>·</span> {song.credit}</>}</p>
        </div>
        <div className="studio-controls">
          <PlayButton phase={transport.phase} play={play} stop={transport.stop} label="Play song" />
          <button type="button" className="studio-watch" onClick={watch}>Watch on Chorus</button>
          <label className="studio-knob">BPM<input key={`${song.id}:${bpm}`} type="number" aria-label="Song tempo" min={50} max={180} defaultValue={bpm} disabled={transport.phase !== "idle"}
            onBlur={(e) => {
              const n = e.target.valueAsNumber;
              if (n >= 50 && n <= 180 && n !== bpm) saveDrafts({ ...drafts, [song.id]: { tracks, bpm: n } });
              else e.target.value = String(bpm);
            }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} /></label>
          <BeatCounter measure={bar} total={song.bars} unit="BAR" />
        </div>
      </header>
      {transport.error && <p className="studio-error" role="alert">{transport.error}</p>}
      <VoiceStrip head={head} select={chooseHead} roles={SONG_ROLES} mix={mix} playing={now.map((note) => note?.lyric)} />
      <section className="studio-block">
        <BlockTitle index="01" title="Arrangement"><span>Choose a bar to cue playback</span></BlockTitle>
        <Arrangement song={song} tracks={tracks} head={head} select={chooseHead} beat={beat} cue={cue}
          setCue={(next) => { if (transport.phase !== "idle") transport.stop(); setCue(next); }} />
      </section>
      <section className="studio-block studio-roll-block" style={colorStyle(head)}>
        <BlockTitle index="02" title="Piano roll">
          <strong className="studio-selected-head">HEAD {headNumber(head)} / {SONG_ROLES[head]}</strong>
          <MixButtons head={head} mix={mix} change={setMix} />
        </BlockTitle>
        <PianoRoll key={`${song.id}:${head}`} bars={song.bars} head={head} beat={beat} cue={cue} notes={notes} selected={selectedNote} select={selectNote}
          add={(at, pitch) => addNote(at, pitch, true)} />
        <div className="studio-editor">
          <div className="studio-editor-top"><span>Click a note to edit. Click empty space to add an “ah”.</span>
            <button type="button" onClick={newAtGap}>+ New note</button>
          </div>
          {notice && <p className="studio-error" role="alert">{notice}</p>}
          {editor && <NoteEditor key={JSON.stringify(editor)} note={editor} bars={song.bars} onApply={apply}
            onDelete={selectedNote && (() => { writeTrack(notes.filter((n) => n.id !== selectedNote.id)); setSelected(undefined); })} />}
        </div>
      </section>
      <footer className="studio-footer"><span>Edits are saved in this browser.</span>{drafts[song.id] && <button type="button" onClick={() => {
        transport.stop();
        const next = { ...drafts };
        delete next[song.id];
        saveDrafts(next);
        setSelected(undefined);
        setNewNote(undefined);
        setNotice("");
      }}>Restore song preset</button>}</footer>
    </div>
  </div>;
}
