import "./style.css";
import { assetURL, disposeModel, json } from "./assets";
import { Engine } from "./engine";
import { Stage } from "./stage";
import { prepareEdition } from "./edition-bank";
import type { EditionBank } from "./edition-bank";
import { installOutfitDrag } from "./outfit-drag";
import {
  exportWave,
  planPerformance,
  scheduleVoice,
  validateSave,
} from "./performance";
import type { PerformancePlan } from "./performance";
import type {
  Catalog,
  Character,
  Command,
  Edition,
  PerformanceSave,
} from "./types";

import playIcon from "@phosphor-icons/core/assets/fill/play-fill.svg?raw";
import pauseIcon from "@phosphor-icons/core/assets/fill/pause-fill.svg?raw";
import previousIcon from "@phosphor-icons/core/assets/bold/caret-left-bold.svg?raw";
import nextIcon from "@phosphor-icons/core/assets/bold/caret-right-bold.svg?raw";
import resetIcon from "@phosphor-icons/core/assets/regular/arrow-counter-clockwise.svg?raw";
import orbitIcon from "@phosphor-icons/core/assets/regular/arrows-clockwise.svg?raw";
import volumeIcon from "@phosphor-icons/core/assets/regular/speaker-high.svg?raw";
import soloIcon from "@phosphor-icons/core/assets/regular/star.svg?raw";
import trashIcon from "@phosphor-icons/core/assets/regular/trash.svg?raw";
import closeIcon from "@phosphor-icons/core/assets/regular/x.svg?raw";
const icons: Record<string, string> = {
  play: playIcon,
  pause: pauseIcon,
  previous: previousIcon,
  next: nextIcon,
  reset: resetIcon,
  orbit: orbitIcon,
  volume: volumeIcon,
  solo: soloIcon,
  trash: trashIcon,
  close: closeIcon,
};
const icon = (key: string) =>
  icons[key].replace("<svg ", '<svg class="icon" aria-hidden="true" ');
const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;
$("app").innerHTML = `
<main inert aria-busy="true">
  <section class="ensemble-layout" aria-label="Musical ensemble">
    <div class="workspace">
      <div id="stage" class="stage">
        <div id="bonus-scene" hidden><video id="bonus-video" playsinline muted preload="metadata"></video><div class="video-caption"><span id="bonus-title"></span><button id="cancel-bonus" class="text-button">${icon("close")}Return to ensemble</button></div></div>
      </div>
      <div class="stage-footer"><p id="hint">Drag outfit to performer to start the music.</p></div>
    </div>
    <aside class="control-rail" aria-label="Ensemble controls">
      <div class="transport" aria-label="Shared musical sequencer">
        <div class="transport-controls"><button id="play" class="play-button" aria-label="Play ensemble">${icon("play")}</button><div class="phase-display"><strong id="tempo">100 <small>BPM</small></strong></div></div>
        <div id="phase-progress" class="phase-sequences" style="--progress:0">
          <div class="phase-counter" data-phase="A" role="progressbar" aria-label="Phase A" aria-valuemin="0" aria-valuenow="0"><b>A</b><div id="beats-a" class="beats" aria-hidden="true"></div></div>
          <div class="phase-counter" data-phase="B" role="progressbar" aria-label="Phase B" aria-valuemin="0" aria-valuenow="0"><b>B</b><div id="beats-b" class="beats" aria-hidden="true"></div></div>
        </div>
        <span id="transport-state">Ready</span>
      </div>
      <div class="view-controls">
        <button id="reset-view" class="text-button">${icon("reset")}<span>Reset view</span></button>
        <button id="slow-orbit" class="text-button" aria-pressed="false">${icon("orbit")}<span>Slow orbit</span></button>
      </div>
      <div id="performer-controls" class="performer-controls" aria-label="Seven performers">
        ${Array.from({ length: 7 }, (_, i) => `<div class="performer-row" data-performer="${i}"><button class="performer-name" data-select="${i}" aria-label="Select performer ${i + 1}"><span class="performer-number">${i + 1}</span><span class="performer-title">—</span></button><div class="performer-actions"><button data-action="mute" data-performer="${i}" class="icon-button" aria-label="Mute performer ${i + 1}" aria-pressed="false" disabled>${icon("volume")}</button><button data-action="solo" data-performer="${i}" class="icon-button" aria-label="Solo performer ${i + 1}" aria-pressed="false" disabled>${icon("solo")}</button><button data-action="remove" data-performer="${i}" class="icon-button" aria-label="Remove performer ${i + 1}" disabled>${icon("trash")}</button></div></div>`).join("")}
      </div>
      <div class="clear-controls"><button id="clear" class="text-button">${icon("trash")}<span>Clear</span></button></div>
    </aside>
  </section>
  <section class="palette-panel" aria-label="Outfits and editions">
    <div class="edition-nav"><button id="previous-edition" class="edition-arrow" aria-label="Previous edition">${icon("previous")}</button><span id="edition-name" aria-live="polite"></span><button id="next-edition" class="edition-arrow" aria-label="Next edition">${icon("next")}</button></div>
    <div class="palette-scroll" tabindex="0" aria-label="Outfit palette, scroll horizontally for more outfits"><div id="palette" class="palette"></div></div>
  </section>
</main>
<section id="edition-loading" class="edition-loading" role="dialog" aria-modal="true" aria-labelledby="loading-title" aria-describedby="loading-detail" tabindex="-1">
  <div class="loading-card"><h1 id="loading-title">Wekiddy</h1><p id="loading-detail" role="status">Loading sounds and animations…</p><progress id="loading-progress" max="1" value="0" aria-label="Edition loading progress"></progress><div class="loading-actions"><button id="retry-edition" class="text-button" hidden>Try again</button><button id="cancel-edition" class="text-button" hidden>Return to current mix</button></div></div>
</section><div id="notice" role="status" aria-live="polite"></div>`;

let catalog: Catalog, engine: Engine, stage: Stage, edition: Edition;
let selectedPart: string | null = null,
  selectedSlot = -1,
  editionToken = 0,
  recording = false,
  recordOrigin = 0,
  save: PerformanceSave | null = null,
  replaying = false;
let transportBusy = false;
let loadingEdition = true, editionBank: EditionBank | null = null;
let replayOrigin = 0,
  replayPlan: PerformancePlan | null = null,
  replaySources: AudioBufferSourceNode[] = [],
  replayTimer = 0,
  replayVoice = 0,
  replayState = -1;
type Prepared = Awaited<ReturnType<Engine["assets"]["performer"]>>;
let prepared = new Map<string, Prepared>(),
  replayToken = 0;
let noticeTimer = 0,
  paletteSignature = "";
const outfitRequests = Array(7).fill(0) as number[];
const pendingOutfits = new Map<number, string>();
function loadingScreen(next: Edition): void {
  loadingEdition = true;
  const main = document.querySelector("main")!;
  main.inert = true;
  main.setAttribute("aria-busy", "true");
  $("app").removeAttribute("data-ready-edition");
  $("edition-loading").hidden = false;
  $("edition-loading").style.setProperty("--world-glow", next.colors[3]);
  $("edition-loading").style.setProperty("--world-color", next.colors[5]);
  $("loading-title").textContent = next.name;
  $("loading-detail").textContent = "Loading sounds and animations…";
  $<HTMLProgressElement>("loading-progress").value = 0;
  $("retry-edition").hidden = $("cancel-edition").hidden = true;
  $("edition-loading").focus();
}
function loadingProgress(done: number, total: number, graphics = false): void {
  const progress = $<HTMLProgressElement>("loading-progress");
  progress.max = total + 1;
  progress.value = done;
  $("loading-detail").textContent = graphics
    ? "Preparing animations…"
    : `Loading sounds and animations · ${done} / ${total}`;
}
function editionReady(): void {
  loadingEdition = false;
  $("edition-loading").hidden = true;
  const main = document.querySelector("main")!;
  main.inert = false;
  main.removeAttribute("aria-busy");
  $("app").dataset.readyEdition = edition.id;
  $("app").dataset.preparedOutfits = String(editionBank?.performers.size ?? 0);
  $("play").focus({ preventScroll: true });
}
function loadingFailed(retry: () => void): void {
  $("loading-detail").textContent = editionBank
    ? "This pack could not finish loading. Your current mix is intact."
    : "This pack could not finish loading. Check your connection and try again.";
  $("retry-edition").hidden = false;
  $("retry-edition").onclick = retry;
  $("cancel-edition").hidden = !editionBank;
  $("cancel-edition").onclick = editionReady;
  $("retry-edition").focus();
}
function notice(message: string): void {
  $("notice").textContent = message;
  $("notice").classList.add("visible");
  clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(
    () => $("notice").classList.remove("visible"),
    5500,
  );
}
function fail(error: unknown): void {
  console.error(error);
  notice(error instanceof Error ? error.message : String(error));
}
function usedPaths(): Set<string> {
  return new Set(
    [...engine.slots, ...[...pendingOutfits.values()].map((part) => ({ part }))]
      .flatMap((s) => {
        const c = catalog.characters.find((c) => c.id === s.part);
        return c ? [c.music.a, c.music.b ?? c.music.a] : [];
      })
      .concat(
        engine.bonus
          ? [
              engine.bonus.bonus.music,
              ...(engine.bonus.bonus.predrop
                ? [engine.bonus.bonus.predrop]
                : []),
            ]
          : [],
      ),
  );
}
function resetSelection(): void {
  selectedPart = null;
  renderPalette();
}
function choose(part: string): void {
  selectedPart = selectedPart === part ? null : part;
  renderPalette();
}
function renderPalette(): void {
  const slots = engine.slots,
    signature =
      edition.id +
      ":" +
      slots.map((s) => s.part).join(",") +
      ":" +
      selectedPart +
      ":" +
      [...pendingOutfits.values()].join(",");
  if (signature === paletteSignature) return;
  paletteSignature = signature;
  const focusedPart = (document.activeElement as HTMLElement)?.dataset?.part;
  $("palette").innerHTML = edition.characterIds
    .map((id) => {
      const c = catalog.characters.find((c) => c.id === id)!,
        used =
          slots.some((s) => s.part === id) ||
          [...pendingOutfits.values()].includes(id),
        i = c.sourceIndex - 1;
      return `<button class="sound ${used ? "used" : ""} ${selectedPart === id ? "chosen" : ""}" data-part="${id}" style="--outfit-color:${c.color}" draggable="false" aria-label="${c.displayName}, ${c.category}${used ? ", already assigned" : ""}" aria-pressed="${selectedPart === id}" ${used ? "disabled" : ""} title="${c.displayName} · ${c.category}"><span class="sound-icon" style="background-image:url('${assetURL(`port/${c.icon.sheet}`)}');background-position:${(i / 19) * 100}% 0%"></span></button>`;
    })
    .join("");
  for (const button of $("palette").querySelectorAll<HTMLButtonElement>(
    "[data-part]",
  )) {
    button.onclick = () => choose(button.dataset.part!);
  }
  if (focusedPart) {
    const target = $("palette").querySelector<HTMLButtonElement>(
      `[data-part="${focusedPart}"]`,
    );
    if (target && !target.disabled) target.focus({ preventScroll: true });
  }
}
function controls(): void {
  for (const slot of engine.slots) {
    const row = document.querySelector<HTMLElement>(
      `.performer-row[data-performer="${slot.index}"]`,
    )!;
    const part = catalog.characters.find((c) => c.id === slot.part);
    const ready = !!part && slot.ready && slot.removing === null;
    row.classList.toggle("selected", selectedSlot === slot.index);
    row.classList.toggle("empty", !part);
    row.querySelector<HTMLElement>(".performer-title")!.textContent =
      part?.displayName ?? "—";
    const select = row.querySelector<HTMLButtonElement>(".performer-name")!;
    select.setAttribute(
      "aria-label",
      `Select performer ${slot.index + 1}${part ? ", " + part.displayName : ", empty"}`,
    );
    select.setAttribute("aria-pressed", String(selectedSlot === slot.index));
    for (const button of row.querySelectorAll<HTMLButtonElement>(
      "[data-action]",
    )) {
      const action = button.dataset.action!;
      button.disabled = !ready;
      button.setAttribute(
        "aria-label",
        `${action === "mute" ? (slot.muted ? "Unmute" : "Mute") : action === "solo" ? "Solo" : "Remove"} performer ${slot.index + 1}${part ? ", " + part.displayName : ""}`,
      );
      if (action !== "remove")
        button.setAttribute(
          "aria-pressed",
          String(action === "mute" ? slot.muted : slot.solo),
        );
    }
  }
}
function performerAction(
  action: "mute" | "solo" | "remove",
  index: number,
): void {
  const slot = engine.slots[index];
  if (!slot?.part || !slot.ready || slot.removing !== null) return;
  if (replaying) stopReplay();
  selectedSlot = index;
  stage.select(index);
  engine[action](index);
}
function editionPresentation(): void {
  $("edition-name").textContent = edition.name;
  $("app").style.setProperty("--world-color", edition.colors[4]);
  $("app").style.setProperty("--world-glow", edition.colors[3]);
  $("app").style.setProperty("--edition-accent", edition.colors[0]);
  stage.setTheme(edition.colors[0]);
  $("tempo").innerHTML = `${edition.timing.bpm} <small>BPM</small>`;
  for (const phase of ["a", "b"]) {
    $("beats-" + phase).innerHTML = Array.from(
      { length: edition.timing.beatsPerPhase },
      () => "<i></i>",
    ).join("");
    $("beats-" + phase).parentElement!.setAttribute(
      "aria-valuemax",
      String(edition.timing.beatsPerPhase),
    );
  }
}
function refresh(): void {
  if (!engine) return;
  renderPalette();
  controls();
  $("play").setAttribute(
    "aria-label",
    engine.running && !engine.paused ? "Pause ensemble" : "Play ensemble",
  );
  $("play").innerHTML = icon(
    engine.running && !engine.paused ? "pause" : "play",
  );
}
async function assign(index: number, part: string): Promise<void> {
  if (loadingEdition) return;
  if (!Number.isInteger(index) || index < 0 || index > 6) return;
  if (replaying) stopReplay();
  const character = catalog.characters.find((c) => c.id === part);
  if (
    !character ||
    character.editionId !== edition.id ||
    engine.slots[index].part === part
  )
    return;
  if (
    engine.slots.some((s) => s.index !== index && s.part === part) ||
    [...pendingOutfits].some(
      ([slot, pending]) => slot !== index && pending === part,
    )
  )
    return;
  const request = ++outfitRequests[index],
    generation = engine.generation;
  let token = -1,
    replacing = false,
    committed = false,
    releaseSounds: (() => void) | undefined;
  try {
    await engine.warm();
    if (generation !== engine.generation || outfitRequests[index] !== request)
      return;
    const slot = engine.slots[index];
    if (engine.bonusPlaying) return;
    if (slot.part && !slot.ready) engine.fail(index, slot.token);
    replacing = !!slot.part && slot.ready;
    const previous = slot.part;
    token = replacing ? slot.token : engine.reserve(index, part);
    pendingOutfits.set(index, part);
    releaseSounds = engine.assets.retainSounds([
      character.music.a,
      character.music.b ?? character.music.a,
    ]);
    renderPalette();
    const valid = () =>
      engine.generation === generation &&
      outfitRequests[index] === request &&
      engine.slots[index].token === token &&
      engine.slots[index].part === (replacing ? previous : part) &&
      !engine.bonusPlaying;
    if (!valid()) return;
    if (!stage.activate(index, part)) throw new Error("The edition’s animations are not ready.");
    if (replacing) engine.replaceReady(index, part);
    else engine.assignReady(index, part);
    committed = true;
    // A completed load must not cancel a newer outfit selection.
    if (selectedPart === part) resetSelection();
    selectedSlot = index;
    stage.select(index);
  } catch (error) {
    if (generation === engine.generation && outfitRequests[index] === request)
      fail(error);
  } finally {
    releaseSounds?.();
    if (outfitRequests[index] === request) {
      pendingOutfits.delete(index);
      if (
        !committed &&
        !replacing &&
        token >= 0 &&
        generation === engine.generation
      )
        engine.fail(index, token);
    }
    engine.assets.prune(usedPaths());
    refresh();
  }
}
async function switchEdition(id: string): Promise<void> {
  const next = catalog.editions.find((e) => e.id === id)!;
  if (!next) return;
  const token = ++editionToken;
  loadingScreen(next);
  $("edition-name").setAttribute("aria-busy", "true");
  let bank: EditionBank | null = null;
  try {
    bank = await prepareEdition(catalog, next, engine, stage, (...args) => {
      if (token === editionToken) loadingProgress(...args);
    });
    if (token !== editionToken) return;
    finishRecording();
    stopReplay();
    engine.clear();
    pendingOutfits.clear();
    for (let i = 0; i < 7; i++) stage.unmount(i, false);
    const video = $<HTMLVideoElement>("bonus-video");
    video.pause();
    video.removeAttribute("src");
    video.load();
    editionBank?.release();
    editionBank = bank;
    stage.useBank(bank.performers);
    bank = null;
    engine.assets.prune(new Set());
    edition = next;
    engine.edition = next;
    selectedSlot = -1;
    stage.select(-1);
    resetSelection();
    editionPresentation();
    refresh();
    editionReady();
  } catch (error) {
    if (token === editionToken) {
      fail(error);
      loadingFailed(() => void switchEdition(id));
    }
  } finally {
    bank?.release();
    engine.assets.prune(usedPaths());
    if (token === editionToken) $("edition-name").removeAttribute("aria-busy");
  }
}
async function play(): Promise<void> {
  if (loadingEdition) return;
  if (transportBusy) return;
  transportBusy = true;
  try {
    if (engine.paused) await engine.resume(!replaying);
    else if (engine.running) await engine.pause();
    else {
      if (replaying) return;
      const generation = engine.generation;
      await engine.warm();
      if (generation !== engine.generation) return;
      engine.start();
      engine.onCommand({ type: "play" });
      if (!engine.running) notice("Give an outfit to a performer first.");
    }
  } finally {
    transportBusy = false;
    refresh();
  }
}
function beginRecording(): void {
  if (recording) {
    finishRecording();
    return;
  }
  if (replaying) stopReplay();
  if (!engine.slots.some((s) => s.part && s.ready)) {
    notice("Add at least one sound before recording.");
    return;
  }
  engine.stop(false);
  recording = true;
  save = {
    format: "bongo-chorus",
    version: 1,
    edition: edition.id,
    duration: 0,
    events: engine.slots
      .filter((s) => s.part && s.ready)
      .map((s) => ({
        time: 0,
        command: { type: "assign" as const, slot: s.index, part: s.part! },
      })),
  };
  // The source snapshot includes current mute and solo state at recording start.
  for (const s of engine.slots)
    if (s.part && s.muted)
      save.events.push({ time: 0, command: { type: "mute", slot: s.index } });
  const solo = engine.slots.find((s) => s.solo);
  if (solo)
    save.events.push({ time: 0, command: { type: "solo", slot: solo.index } });
  engine.start();
  recordOrigin = engine.epoch;
  refresh();
  notice("Recording from A. Every change becomes part of the performance.");
}
async function record(): Promise<void> {
  if (recording) {
    finishRecording();
    return;
  }
  const generation = engine.generation;
  if (engine.paused) await engine.resume(!replaying);
  else await engine.warm();
  if (generation === engine.generation) beginRecording();
}
function finishRecording(): void {
  if (!recording) return;
  recording = false;
  save!.duration = Math.max(0.1, engine.now - recordOrigin);
  save!.events = save!.events.filter((e) => e.time <= save!.duration);
  localStorage.setItem("bongo-chorus:performance", JSON.stringify(save));
  refresh();
  notice("Performance saved.");
}
async function launchBonus(id: string): Promise<void> {
  try {
    const bonus = edition.bonuses.find((b) => b.id === id)!;
    const video = $<HTMLVideoElement>("bonus-video");
    video.src = editionBank?.videos.get(bonus.video) ?? assetURL(bonus.video);
    video.load();
    await engine.requestBonus(bonus);
    refresh();
  } catch (e) {
    fail(e);
  }
}
function stopReplay(): void {
  replayToken++;
  clearInterval(replayTimer);
  for (const s of replaySources)
    try {
      s.stop();
    } catch {}
  replaySources = [];
  if (replaying) {
    replaying = false;
    engine.stop(false);
  }
  if (stage) stage.releaseRetained();
  for (const bundle of prepared.values()) disposeModel(bundle.gltf.scene);
  prepared.clear();
  replayPlan = null;
  replayState = -1;
  if (engine) refresh();
}
async function replay(): Promise<void> {
  if (!save) return;
  finishRecording();
  stopReplay();
  const token = ++replayToken;
  const saved = structuredClone(save);
  notice("Preparing the recorded sounds and choreography…");
  try {
    if (saved.edition !== edition.id) await switchEdition(saved.edition);
    const myToken = replayToken; // edition switching may cancel the previous preview
    engine.stop(false);
    const context = await engine.warm();
    if (myToken !== replayToken) return;
    for (let i = 0; i < 7; i++) stage.unmount(i, false);
    engine.slots = engine.slots.map((s) => ({
      ...s,
      part: null,
      ready: false,
    }));
    replaying = true;
    refresh();
    const plan = planPerformance(saved, catalog),
      parts = [
        ...new Set(
          saved.events.flatMap((e) =>
            e.command.type === "assign" || e.command.type === "replace"
              ? [e.command.part]
              : [],
          ),
        ),
      ];
    for (const path of new Set(plan.voices.map((v) => v.path)))
      await engine.assets.sound(context, path);
    stage.retainForReplay = true;
    for (const part of parts) {
      const bundle = await engine.assets.performer(
        catalog.characters.find((c) => c.id === part)!,
        context,
      );
      if (myToken !== replayToken) {
        disposeModel(bundle.gltf.scene);
        return;
      }
      await stage.mount(
        0,
        part,
        bundle.gltf,
        bundle.poses,
        bundle.states,
        () => myToken === replayToken,
      );
      stage.unmount(0, false);
    }
    if (myToken !== replayToken) return;
    replaying = true;
    replayPlan = plan;
    replayOrigin = context.currentTime + 0.2;
    replayVoice = 0;
    replayState = -1;
    stage.retainForReplay = true;
    replayTimer = window.setInterval(replayPump, 25);
    replayPump();
    refresh();
  } catch (e) {
    stopReplay();
    fail(e);
  }
}
let replayMounting = new Set<number>();
async function replayPump(): Promise<void> {
  if (!replaying || !replayPlan || engine.paused) return;
  const t = engine.now - replayOrigin,
    plan = replayPlan,
    token = replayToken;
  while (
    replayVoice < plan.voices.length &&
    plan.voices[replayVoice].start < t + 1.2
  ) {
    const v = plan.voices[replayVoice++];
    if (v.start < t - 0.05) {
      stopReplay();
      notice("Replay was interrupted. Press Replay to start again.");
      return;
    }
    replaySources.push(
      scheduleVoice(
        engine.context!,
        engine.master!,
        engine.assets,
        v,
        replayOrigin,
      ),
    );
  }
  let index = replayState;
  while (
    index + 1 < plan.states.length &&
    plan.states[index + 1].time <= Math.max(0, t)
  )
    index++;
  if (index !== replayState && index >= 0) {
    replayState = index;
    const state = plan.states[index];
    const bonus = state.bonus
      ? {
          bonus: edition.bonuses.find((b) => b.id === state.bonus!.id)!,
          start: state.bonus.start,
          end: state.bonus.end,
        }
      : null;
    engine.observeReplay(
      state.slots,
      replayOrigin + state.epoch,
      state.running,
      state.shift,
      bonus,
    );
    for (let i = 0; i < 7; i++) {
      const part = state.slots[i].part;
      if (!part) {
        stage.unmount(i, false);
        continue;
      }
      // Reuse active or parked original models. Every needed model was loaded before playback.
      const metrics = stage.metrics().performers as {
        slot: number;
        part: string;
      }[];
      if (
        metrics.some((p) => p.slot === i && p.part === part) ||
        stage.reuse(i, part) ||
        replayMounting.has(i)
      )
        continue;
      const bundle = prepared.get(part);
      if (bundle) {
        prepared.delete(part);
        replayMounting.add(i);
        await stage.mount(
          i,
          part,
          bundle.gltf,
          bundle.poses,
          bundle.states,
          () => token === replayToken,
        );
        replayMounting.delete(i);
      }
    }
    refresh();
  }
  if (t > plan.duration) {
    stopReplay();
    notice("Performance replay finished.");
  }
}
let lastBonus: string | null = null,
  lastBonusEnd = Infinity,
  filmPaused = false;
function frame(): void {
  const parity = engine.parity(engine.displayPhase),
    progress = engine.running
      ? engine.displayProgress * edition.timing.beatsPerPhase
      : 0,
    beat = Math.floor(progress);
  $("phase-progress").style.setProperty(
    "--beat-fill",
    `${(progress - beat) * 100}%`,
  );
  for (const [index, phase] of ["a", "b"].entries()) {
    const ticks = $("beats-" + phase),
      row = ticks.parentElement!,
      complete = engine.running && parity === 1 && index === 0,
      active = engine.running && index === parity,
      value = complete ? edition.timing.beatsPerPhase : active ? progress : 0;
    row.classList.toggle("active", active);
    row.setAttribute("aria-valuenow", String(Math.floor(value)));
    row.setAttribute(
      "aria-valuetext",
      `${Math.floor(value)} of ${edition.timing.beatsPerPhase} beats`,
    );
    [...ticks.children].forEach((el, i) => {
      el.classList.toggle("filled", complete || (active && i < beat));
      el.classList.toggle("on", active && i === beat);
    });
  }
  $("transport-state").textContent = engine.paused
    ? "Paused"
    : replaying
      ? replayPlan
        ? "Playing your performance"
        : "Preparing performance…"
      : engine.running
        ? `Phrase ${engine.displayPhase + 1} · ${engine.parity(engine.displayPhase) ? "B" : "A"}`
        : "Ready";
  if (recording && engine.now - recordOrigin >= 1800) finishRecording();
  const b = engine.bonus,
    playing = engine.bonusVisible,
    video = $<HTMLVideoElement>("bonus-video");
  $("bonus-scene").hidden = !playing;
  if (playing && b) {
    const time = Math.max(0, engine.presentationNow - engine.time(b.start));
    if (lastBonus !== b.bonus.id) {
      lastBonus = b.bonus.id;
      lastBonusEnd = b.end;
      const url = editionBank?.videos.get(b.bonus.video) ?? assetURL(b.bonus.video);
      if (video.src !== url) video.src = url;
      $("bonus-title").textContent = b.bonus.name;
      video.currentTime = time;
      filmPaused = engine.paused;
      if (!engine.paused)
        video
          .play()
          .catch(() =>
            notice(
              "The bonus film needs a tap to play. The original audio continues.",
            ),
          );
    }
    if (engine.paused && !filmPaused) {
      video.pause();
      filmPaused = true;
    } else if (!engine.paused && filmPaused) {
      filmPaused = false;
      void video.play().catch(fail);
    }
    if (Math.abs(video.currentTime - time) > 0.15) video.currentTime = time;
  } else if (lastBonus) {
    video.pause();
    if (b === null && engine.running && engine.phase >= lastBonusEnd) {
      const index = edition.bonuses.findIndex((b) => b.id === lastBonus);
      localStorage.setItem(
        `bongo-chorus:bonus:${edition.id}`,
        String(
          Math.max(
            index + 1,
            Number(
              localStorage.getItem(`bongo-chorus:bonus:${edition.id}`) ?? 0,
            ),
          ),
        ),
      );
      refresh();
    }
    lastBonus = null;
  }
}

async function boot(): Promise<void> {
  catalog = await json<Catalog>("catalog.json");
  edition = catalog.editions.find((entry) => entry.id === "incredibox-v9")!;
  engine = new Engine(catalog, edition);
  stage = new Stage($("stage"), engine);
  loadingScreen(edition);
  await stage.initialize();
  editionPresentation();
  editionBank = await prepareEdition(catalog, edition, engine, stage, loadingProgress);
  stage.useBank(editionBank.performers);
  engine.onChange = refresh;
  engine.onInterrupt = (message) => {
    if (replaying) stopReplay();
    finishRecording();
    notice(message);
  };
  engine.onCommand = (command: Command) => {
    if (recording && save)
      save.events.push({
        time: Math.max(0, engine.now - recordOrigin),
        command: structuredClone(command),
      });
  };
  stage.onSelect = (i) => {
    if (selectedPart) assign(i, selectedPart);
    else {
      selectedSlot = selectedSlot === i ? -1 : i;
      stage.select(selectedSlot);
      refresh();
    }
  };
  stage.onDrop = (i, p) => assign(i, p);
  const moveOutfit = (from: number, to: number): void => {
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from === to ||
      !engine.slots[from]?.ready ||
      !engine.slots[to] ||
      engine.slots[from].removing !== null ||
      engine.bonusPlaying
    )
      return;
    outfitRequests[to]++;
    pendingOutfits.delete(to);
    if (engine.slots[to].part) engine.displace(to);
    stage.unmount(to, false);
    stage.move(from, to);
    selectedSlot = from;
    resetSelection();
    refresh();
  };
  stage.onMove = moveOutfit;
  installOutfitDrag({
    root: $("app"),
    assign: (slot, part) => {
      void assign(slot, part);
    },
    move: moveOutfit,
  });
  stage.onFrame = frame;
  const cycleEdition = (step: number): void => {
    const index = catalog.editions.indexOf(edition);
    void switchEdition(
      catalog.editions[
        (index + step + catalog.editions.length) % catalog.editions.length
      ].id,
    );
  };
  $("previous-edition").onclick = () => cycleEdition(-1);
  $("next-edition").onclick = () => cycleEdition(1);
  for (const button of $(
    "performer-controls",
  ).querySelectorAll<HTMLButtonElement>("[data-select]")) {
    button.onclick = () => stage.onSelect(Number(button.dataset.select));
  }
  for (const button of $(
    "performer-controls",
  ).querySelectorAll<HTMLButtonElement>("[data-action]")) {
    button.onclick = () =>
      performerAction(
        button.dataset.action as "mute" | "solo" | "remove",
        Number(button.dataset.performer),
      );
  }
  $("reset-view").onclick = () => stage.reset();
  $("slow-orbit").onclick = () => {
    stage.slowOrbit = !stage.slowOrbit;
    $("slow-orbit").setAttribute("aria-pressed", String(stage.slowOrbit));
  };
  $("play").onclick = () => play().catch(fail);
  $("clear").onclick = () => {
    finishRecording();
    stopReplay();
    engine.clear();
    pendingOutfits.clear();
    outfitRequests.forEach((_, i) => outfitRequests[i]++);
    selectedSlot = -1;
    stage.select(-1);
    for (let i = 0; i < 7; i++) stage.unmount(i);
    resetSelection();
    refresh();
  };
  $("cancel-bonus").onclick = () => {
    if (replaying) stopReplay();
    else engine.cancelBonus();
  };
  const inspectArt = async (): Promise<void> => {
    const part = engine.slots[selectedSlot]?.part ?? edition.characterIds[0];
    const { inspectArtwork } = await import("./inspector");
    await inspectArtwork(
      catalog.characters.find((c) => c.id === part)!,
      (data) => stage.comparisonStates(data),
    );
  };
  window.addEventListener("keydown", (e) => {
    if (loadingEdition) return;
    if (
      (e.target as HTMLElement).matches("input,select,textarea") ||
      document.querySelector("dialog[open]")
    )
      return;
    if (e.key === "Escape") {
      resetSelection();
      selectedSlot = -1;
      stage.select(-1);
      refresh();
    }
    if (e.code === "Space" && !(e.target as HTMLElement).matches("button")) {
      e.preventDefault();
      play().catch(fail);
    }
    if (/^[1-7]$/.test(e.key)) {
      e.preventDefault();
      stage.onSelect(Number(e.key) - 1);
    }
    if (selectedSlot >= 0) {
      if (e.key.toLowerCase() === "m") performerAction("mute", selectedSlot);
      if (e.key.toLowerCase() === "s") performerAction("solo", selectedSlot);
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        performerAction("remove", selectedSlot);
      }
    }
  });
  // Browser suspension follows an explicit stop-and-restart policy. Inaudible time never advances a private visual clock.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (replaying && !engine.paused) stopReplay();
      else if (engine.running && !engine.paused)
        engine.interrupt(
          "Session paused while away. Press Play to restart together on A.",
        );
    }
  });
  try {
    const saved = localStorage.getItem("bongo-chorus:performance");
    if (saved) save = validateSave(JSON.parse(saved), catalog);
  } catch {
    localStorage.removeItem("bongo-chorus:performance");
  }
  refresh();
  editionReady();
  Object.assign(window, {
    Chorus: {
      ready: true,
      catalog,
      status: () => engine.snapshot(),
      metrics: () => stage.metrics(),
      resetMetrics: () => {
        stage.frameTimes = [];
      },
      trace: () => engine.trace,
      level: () => engine.level(),
      assign,
      switchEdition,
      command: async (c: Command) => {
        if (replaying && c.type !== "assign" && c.type !== "play") stopReplay();
        switch (c.type) {
          case "assign":
          case "replace":
            return assign(c.slot, c.part);
          case "mute":
            engine.mute(c.slot);
            break;
          case "solo":
            engine.solo(c.slot);
            break;
          case "remove":
            engine.remove(c.slot);
            break;
          case "displace":
            engine.displace(c.slot);
            break;
          case "stop":
            stopReplay();
            engine.stop();
            break;
          case "play":
            return play();
          case "bonus":
            return launchBonus(c.id);
          case "cancelBonus":
            engine.cancelBonus();
        }
      },
      record,
      finishRecording,
      performance: () => save,
      replay,
      plan: () => (save ? planPerformance(save, catalog) : null),
      export: () => (save ? exportWave(save, catalog, engine.assets) : null),
      stress: (ms: number) => {
        const start = performance.now();
        while (performance.now() - start < ms) {}
      },
      inspectArt,
      moveOutfit,
      zoom: (factor: number) => stage.zoom(factor),
      slowOrbit: (enabled: boolean) => {
        stage.slowOrbit = enabled;
        $("slow-orbit").setAttribute("aria-pressed", String(enabled));
      },
      resetView: () => stage.reset(),
      view: (azimuth: number, polar: number) => {
        const radius = stage.camera.position.distanceTo(stage.controls.target);
        stage.camera.position.set(
          radius * Math.sin(polar) * Math.sin(azimuth),
          1 + radius * Math.cos(polar),
          radius * Math.sin(polar) * Math.cos(azimuth),
        );
        stage.controls.update();
      },
    },
  });
}
boot().catch((e) => {
  fail(e);
  loadingFailed(() => location.reload());
});
