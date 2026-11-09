import "../vendor/chimera/src/ui/styles.css";
import "./style.css";
import { initChimera } from "../vendor/chimera/src/wasm/chimera.ts";
import type { mountSongSelector } from "./studio/index.tsx";

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `
  <header class="bongo-bar">
    <h1 class="wordmark">Chimera Planet</h1>
    <div class="stage-controls">
      <div class="stage-view-tools" role="group" aria-label="View controls">
        <button type="button" class="chip" id="reset-view" disabled>Reset view</button>
        <button type="button" class="chip" id="slow-orbit" aria-pressed="false" disabled>Slow orbit</button>
        <button type="button" class="chip" id="stage-words" aria-pressed="true" title="Show or hide words and syllables at each mouth" disabled>Words</button>
      </div>
      <div class="stage-song" id="stage-song" role="group" aria-label="Song transport"><span role="status">Loading songs…</span></div>
    </div>
  </header>
  <section class="chorus-panel screen focus" aria-label="Ensemble">
    <div class="chorus-viewport" id="chorus-stage">
      <p class="stage-status" id="stage-status" role="status">Loading the chorus…</p>
    </div>
  </section>`;

const controls = document.getElementById("stage-song")!;
const stageElement = document.getElementById("chorus-stage")!;
const stageStatus = document.getElementById("stage-status")!;
const resetButton = document.querySelector<HTMLButtonElement>("#reset-view")!;
const orbitButton = document.querySelector<HTMLButtonElement>("#slow-orbit")!;
const wordsButton = document.querySelector<HTMLButtonElement>("#stage-words")!;
let songs: ReturnType<typeof mountSongSelector> | undefined;

function showRetry(status: HTMLElement, message: string, retry: () => Promise<void>): void {
  status.textContent = message + " ";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chip";
  button.textContent = "Try again";
  button.onclick = () => {
    button.disabled = true;
    void retry();
  };
  status.append(button);
}

async function loadSongs(): Promise<void> {
  try {
    await initChimera();
    const { mountSongSelector } = await import("./studio/index.tsx");
    controls.replaceChildren();
    songs = mountSongSelector(controls);
  } catch (error) {
    console.error(error);
    showRetry(controls, "Songs could not load.", loadSongs);
  }
}

async function loadStage(): Promise<void> {
  stageStatus.textContent = "Loading the chorus…";
  try {
    await initChimera();
    const { ChorusStage } = await import("./stage.ts");
    const stage = new ChorusStage(stageElement, (words) => songs?.stageFrames(words) ?? [],
      wordsButton.getAttribute("aria-pressed") === "true");
    resetButton.onclick = () => {
      stage.reset();
      orbitButton.setAttribute("aria-pressed", "false");
    };
    orbitButton.onclick = () => orbitButton.setAttribute("aria-pressed", String(stage.toggleOrbit()));
    wordsButton.onclick = () => wordsButton.setAttribute("aria-pressed", String(stage.toggleWords()));
    resetButton.disabled = orbitButton.disabled = wordsButton.disabled = false;
    stageStatus.hidden = true;
  } catch (error) {
    console.error(error);
    showRetry(stageStatus, "The 3D chorus could not start. Check WebGL support and try again.", loadStage);
  }
}

void loadSongs();
void loadStage();
