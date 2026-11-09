import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { EnsembleAudio, warmDictionary } from "./audio.ts";
import { songPerformance } from "./performance.ts";
import { emptyMix, useDraft, useTransport } from "./shared.tsx";
import { SONGBOOK, SONG_DRAFT_KEY, type SongDraft } from "./songbook.ts";

function SongSelector({ audio }: { audio: EnsembleAudio }) {
  const [drafts] = useDraft<Record<string, SongDraft>>(SONG_DRAFT_KEY, {});
  const [song, setSong] = useState(SONGBOOK[0]);
  const { tracks, bpm } = drafts[song.id] ?? song;
  const performance = useMemo(() => songPerformance(song, bpm, !drafts[song.id]), [song, bpm, drafts]);
  const endBeat = useMemo(() => Math.max(0, ...tracks.flatMap((track) => track.map((note) => note.beat + note.duration))), [tracks]);
  const length = (performance.speech?.seconds ?? 0) + performance.timeAt(endBeat) + 0.25;
  const transport = useTransport(audio, true, length);
  const isPlaying = transport.phase === "playing" || transport.phase === "loading";
  function togglePlayback() {
    if (transport.phase === "playing") void transport.pause();
    else if (transport.phase === "loading") transport.stop();
    else if (transport.phase === "paused") void transport.play(() => audio.resume());
    else void transport.play(() => audio.playSong(tracks, bpm, 0, emptyMix(), performance));
  }

  return <>
    <select aria-label="Performance song" value={song.id} onChange={(event) => {
      const next = SONGBOOK.find((item) => item.id === event.target.value);
      if (!next || next === song) return;
      transport.stop();
      setSong(next);
    }}>
      {SONGBOOK.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
    </select>
    <button type="button" className="chip stage-song-play" onClick={togglePlayback}>
      {isPlaying ? "Pause" : "Play"}
    </button>
    {transport.error && <span className="stage-song-error" role="alert">{transport.error}</span>}
  </>;
}

export function mountSongSelector(controls: HTMLElement) {
  const audio = new EnsembleAudio(() => undefined);
  audio.setStageVisible(true);
  warmDictionary();
  createRoot(controls).render(<SongSelector audio={audio} />);
  return audio;
}
