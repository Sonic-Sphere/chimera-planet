import "../vendor/chimera/src/ui/styles.css";
import { initChimera } from "../vendor/chimera/src/wasm/chimera.ts";
import { HEADS, type InstrumentMessage, type ShellMessage } from "./heads.ts";

const root = document.querySelector<HTMLElement>("#root")!;

async function boot(): Promise<void> {
  try {
    await initChimera();
    const { mount } = await import("../vendor/chimera/src/ui/mount.tsx");
    const head = Number(new URLSearchParams(location.search).get("head")) - 1;
    const preset = Number.isInteger(head) ? HEADS[head] : undefined;
    if (window.parent !== window && preset) {
      const [{ useStore }, { engine }] = await Promise.all([
        import("../vendor/chimera/src/ui/store.ts"),
        import("../vendor/chimera/src/audio/AudioEngine.ts"),
      ]);
      useStore.getState().setBody(preset.body);
      let active = false;
      const syncAudio = () => {
        const context = engine.ctx;
        if (!context || context.state === "closed") return;
        // The worklet can start after a tab switch, so sync again when startup completes.
        void (active ? context.resume() : context.suspend()).catch(() => {});
      };
      window.addEventListener("message", (event: MessageEvent<ShellMessage>) => {
        if (event.source !== window.parent || event.origin !== location.origin || event.data?.type !== "bongo:active") return;
        active = event.data.active;
        syncAudio();
      });
      const send = ({ body, artic }: ReturnType<typeof useStore.getState>, ready?: true) => {
        const message: InstrumentMessage = { type: "bongo:head", state: { body, artic }, ready };
        window.parent.postMessage(message, location.origin);
      };
      useStore.subscribe((state, previous) => {
        if (state.body !== previous.body || state.artic !== previous.artic) send(state);
        if (state.started && !previous.started) syncAudio();
      });
      send(useStore.getState(), true);
    }
    mount(root);
  } catch (error) {
    const box = document.createElement("div");
    box.className = "boot-error";
    const message = document.createElement("p");
    message.textContent = `The voice engine could not load. ${error instanceof Error ? error.message : String(error)}`;
    const retry = document.createElement("button");
    retry.className = "primary";
    retry.textContent = "Try again";
    retry.onclick = () => void boot();
    box.append(message, retry);
    root.replaceChildren(box);
  }
}

void boot();
