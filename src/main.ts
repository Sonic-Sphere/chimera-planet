import "../vendor/chimera/src/ui/styles.css";
import "./style.css";
import { initChimera } from "../vendor/chimera/src/wasm/chimera.ts";
import { HEADS, headNumber, type HeadState, type InstrumentMessage, type ShellMessage } from "./heads.ts";
import type { ChorusStage } from "./stage.ts";

const views = [
  { id: "chorus", label: "Chorus" },
  ...HEADS.map((_, index) => ({ id: `head-${index + 1}`, label: `Head ${headNumber(index)}`, head: index })),
  { id: "songs", label: "Songs" },
];
const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `
  <header class="bongo-bar">
    <h1 class="wordmark">Bongo Chimera</h1>
    <div class="bongo-tabs" role="tablist" aria-label="Bongo Chimera views">
      ${views.map(({ id, label }) => `<button type="button" class="chip" role="tab" id="tab-${id}" aria-controls="panel-${id}" aria-selected="false" tabindex="-1">${label}</button>`).join("")}
    </div>
  </header>
  <section class="bongo-panel chorus-panel screen focus" id="panel-chorus" role="tabpanel" aria-labelledby="tab-chorus">
    <header class="screen-head">
      <h2 class="screen-title">Ensemble</h2>
      <span class="screen-sub">${headNumber(HEADS.length - 1)} heads / 3D</span>
      <div class="screen-tools">
        <button type="button" class="chip" id="slow-orbit" aria-pressed="false" disabled>Slow orbit</button>
        <button type="button" class="chip" id="reset-view" disabled>Reset view</button>
      </div>
    </header>
    <div class="chorus-viewport" id="chorus-stage">
      <p class="stage-status" id="stage-status" role="status">Loading the chorus…</p>
    </div>
    <footer class="stage-footer">
      <span>Drag to orbit <span class="stage-divider">/</span> Scroll or pinch to zoom</span>
      <span>Select a head number to open its controls</span>
    </footer>
  </section>
  ${views.filter((view) => "head" in view).map(({ id }) => `<section class="bongo-panel instrument-panel" id="panel-${id}" role="tabpanel" aria-labelledby="tab-${id}" hidden></section>`).join("")}
  <section class="bongo-panel songs-panel screen focus" id="panel-songs" role="tabpanel" aria-labelledby="tab-songs" tabindex="0" hidden>
    <header class="screen-head">
      <h2 class="screen-title">Songs</h2>
      <span class="screen-sub">Ensemble playback</span>
    </header>
    <div class="song-placeholder">
      <svg viewBox="0 0 180 100" width="180" height="100" aria-hidden="true" fill="none">
        <path d="M18 14h36l38 36h70M18 26h36l32 24m-68-12h36l23 12M18 50h59m-59 12h36l23-12m-59 24h36l32-24M18 86h36l38-36" stroke="var(--blue-dim)"/>
        <path d="M12 14h6m-6 12h6m-6 12h6m-6 12h6m-6 12h6m-6 12h6m-6 12h6m144-36h6" stroke="var(--blue)" stroke-width="2"/>
        <circle cx="92" cy="50" r="4" fill="black" stroke="var(--amber)"/>
      </svg>
      <p class="songs-status">Coming later</p>
      <p>This is where the seven voices will play songs together.</p>
    </div>
  </section>`;

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const tabs = views.map(({ id }) => element<HTMLButtonElement>(`tab-${id}`));
const panels = views.map(({ id }) => element(`panel-${id}`));
const stageElement = element("chorus-stage");
const stageStatus = element("stage-status");
const orbitButton = element<HTMLButtonElement>("slow-orbit");
const resetButton = element<HTMLButtonElement>("reset-view");
const frames = new Map<number, HTMLIFrameElement>();
const headStates = new Map<number, HeadState>();
let stage: ChorusStage | undefined;
let loadingStage = false;
let selected = -1;

function activate(index: number, updateUrl = true): void {
  if (index === selected) return;
  const previous = views[selected];
  const view = views[index];
  if (previous && "head" in previous) setInstrumentActive(previous.head, false);
  selected = index;
  tabs.forEach((tab, i) => {
    tab.setAttribute("aria-selected", String(i === index));
    tab.tabIndex = i === index ? 0 : -1;
    tab.classList.toggle("on", i === index);
    panels[i].hidden = i !== index;
  });

  if (view.id === "chorus") {
    if (stage) stage.setActive(true);
    else void loadStage();
  } else {
    stage?.setActive(false);
    if ("head" in view) {
      if (frames.has(view.head)) setInstrumentActive(view.head, true);
      else openInstrument(view.head, view.label, panels[index]);
    }
  }
  if (updateUrl) history.pushState(null, "", view.id === "chorus" ? location.pathname + location.search : `#${view.id}`);
}

async function loadStage(): Promise<void> {
  if (loadingStage) return;
  loadingStage = true;
  stageStatus.textContent = "Loading the chorus…";
  try {
    await initChimera();
    const { ChorusStage } = await import("./stage.ts");
    stage = new ChorusStage(stageElement, (head) => {
      activate(head + 1);
      tabs[head + 1].focus();
    });
    for (const [head, state] of headStates) stage.setHead(head, state);
    stage.setActive(views[selected].id === "chorus");
    stageStatus.hidden = true;
    orbitButton.disabled = false;
    resetButton.disabled = false;
  } catch (error) {
    console.error(error);
    stageStatus.textContent = "The 3D chorus could not start. Check WebGL support and try again. ";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "chip";
    retry.textContent = "Try again";
    retry.onclick = () => void loadStage();
    stageStatus.append(retry);
  } finally {
    loadingStage = false;
  }
}

function openInstrument(head: number, label: string, panel: HTMLElement): void {
  const frame = document.createElement("iframe");
  frame.title = `${label} · Chimera vocal synth`;
  frame.allow = "autoplay; midi";
  frame.src = `${import.meta.env.BASE_URL}chimera.html?head=${head + 1}`;
  frames.set(head, frame);
  panel.append(frame);
}

function setInstrumentActive(head: number, active: boolean): void {
  const message: ShellMessage = { type: "bongo:active", active };
  frames.get(head)?.contentWindow?.postMessage(message, location.origin);
}

window.addEventListener("message", (event: MessageEvent<InstrumentMessage>) => {
  if (event.origin !== location.origin || event.data?.type !== "bongo:head") return;
  for (const [head, frame] of frames) {
    if (event.source !== frame.contentWindow) continue;
    const { state, ready } = event.data;
    headStates.set(head, state);
    stage?.setHead(head, state);
    if (ready) setInstrumentActive(head, views[selected].id === `head-${head + 1}`);
    break;
  }
});

orbitButton.onclick = () => {
  if (stage) orbitButton.setAttribute("aria-pressed", String(stage.toggleOrbit()));
};
resetButton.onclick = () => {
  stage?.reset();
  orbitButton.setAttribute("aria-pressed", "false");
};
tabs.forEach((tab, index) => {
  tab.onclick = () => activate(index);
  tab.onkeydown = (event) => {
    const last = tabs.length - 1;
    const next = { ArrowLeft: (index + last) % tabs.length, ArrowRight: (index + 1) % tabs.length, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    tabs[next].focus();
  };
});

function selectFromHash(): void {
  const index = views.findIndex(({ id }) => id === location.hash.slice(1));
  activate(Math.max(0, index), false);
}
window.addEventListener("hashchange", selectFromHash);
selectFromHash();
