import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { EnsembleAudio, warmDictionary } from "./audio.ts";
import { songPerformance } from "./performance.ts";
import { emptyMix, useDraft, useTransport } from "./shared.tsx";
import { SONGBOOK, SONG_DRAFT_KEY, type SongDraft } from "./songbook.ts";

function SongSelector({ audio, controls }: { audio: EnsembleAudio; controls: HTMLElement }) {
  const [drafts] = useDraft<Record<string, SongDraft>>(SONG_DRAFT_KEY, {});
  const [song, setSong] = useState(SONGBOOK[0]);
  const [opening, setOpening] = useState(true);
  const { tracks, bpm } = drafts[song.id] ?? song;
  const performance = useMemo(() => songPerformance(song, bpm, !drafts[song.id]), [song, bpm, drafts]);
  const endBeat = useMemo(() => Math.max(0, ...tracks.flatMap((track) => track.map((note) => note.beat + note.duration))), [tracks]);
  const length = performance.introSeconds + performance.timeAt(endBeat) + 0.25;
  const transport = useTransport(audio, true, length);
  const isPlaying = transport.phase === "playing" || (transport.phase === "loading" && !opening);

  useEffect(() => {
    // Start the initially selected song once when the stage opens.
    void transport.play(async () => {
      try { return await audio.playSong(tracks, bpm, 0, emptyMix(), performance); }
      finally { setOpening(false); }
    });
  }, []);

  useEffect(() => {
    if (!opening) return;
    function unlock(event: MouseEvent) {
      if (event.isTrusted && event.target instanceof Node && !controls.contains(event.target)) audio.unlock();
    }
    document.addEventListener("click", unlock);
    return () => document.removeEventListener("click", unlock);
  }, [audio, controls, opening]);

  function togglePlayback() {
    if (opening && transport.phase === "loading") audio.unlock();
    else if (transport.phase === "playing") void transport.pause();
    else if (transport.phase === "loading") transport.stop();
    else if (transport.phase === "paused") void transport.play(() => audio.resume());
    else void transport.play(() => audio.playSong(tracks, bpm, 0, emptyMix(), performance));
  }

  return <>
    <select aria-label="Performance song" value={song.id} onChange={(event) => {
      const next = SONGBOOK.find((item) => item.id === event.target.value);
      if (!next || next === song) return;
      setOpening(false);
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
  createRoot(controls).render(<SongSelector audio={audio} controls={controls} />);
  return audio;
}
