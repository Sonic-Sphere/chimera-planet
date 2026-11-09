import { assetURL } from "./assets";
import type { Engine } from "./engine";
import type { Performer, Stage } from "./stage";
import type { Catalog, Edition } from "./types";

// A failed bank never replaces the current edition. Let in-flight work settle
// before releasing it, so late decodes/models cannot leak into the next bank.
export async function loadTasks(tasks: (() => Promise<void>)[], progress: (done: number, total: number) => void, concurrency = 3): Promise<void> {
  let next = 0, done = 0;
  const errors: unknown[] = [];
  progress(0, tasks.length);
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (next < tasks.length && !errors.length) {
      const task = tasks[next++];
      try { await task(); progress(++done, tasks.length); }
      catch (error) { errors.push(error); }
    }
  }));
  if (errors.length) throw errors[0];
}

export interface EditionBank {
  performers: Map<string, Performer>;
  videos: Map<string, string>;
  images: HTMLImageElement[];
  release(): void;
}

export async function prepareEdition(catalog: Catalog, edition: Edition, engine: Engine, stage: Stage, progress: (done: number, total: number, graphics?: boolean) => void): Promise<EditionBank> {
  const characters = edition.characterIds.map((id) => catalog.characters.find((c) => c.id === id)!);
  const sounds = [...new Set([
    ...characters.flatMap((c) => [c.music.a, c.music.b ?? c.music.a]),
    ...edition.bonuses.flatMap((b) => b.predrop ? [b.music, b.predrop] : [b.music]),
  ])];
  const releaseSounds = engine.assets.retainSounds(sounds);
  const performers = new Map<string, Performer>(), videos = new Map<string, string>(), images: HTMLImageElement[] = [];
  let released = false;
  const bank: EditionBank = {
    performers, videos, images,
    release() {
      if (released) return;
      released = true;
      stage.disposeBank(performers);
      for (const url of videos.values()) URL.revokeObjectURL(url);
      videos.clear();
      images.length = 0;
      releaseSounds();
    },
  };
  try {
    // Creating/decoding on a suspended context does not start playback.
    const context = engine.prepareAudio();
    const tasks: (() => Promise<void>)[] = characters.map((c) => async () => {
      const bundle = await engine.assets.performer(c, context);
      // Stage.prepare owns the model, including cleanup if state imagery fails.
      const performer = await stage.prepare(c.id, bundle.gltf, bundle.poses, bundle.states);
      performers.set(c.id, performer);
    });
    for (const sheet of new Set(characters.map((c) => c.icon.sheet))) tasks.push(async () => {
      const image = new Image();
      image.src = assetURL(`port/${sheet}`);
      await image.decode();
      images.push(image);
    });
    for (const b of edition.bonuses) {
      tasks.push(async () => {
        await engine.assets.sound(context, b.music);
        if (b.predrop) await engine.assets.sound(context, b.predrop);
      });
      tasks.push(async () => {
        const response = await fetch(assetURL(b.video));
        if (!response.ok) throw new Error(`Film unavailable: ${b.name}`);
        videos.set(b.video, URL.createObjectURL(await response.blob()));
      });
    }
    await loadTasks(tasks, progress);
    progress(tasks.length, tasks.length, true);
    // Give the loading label a paint before warming every pose on the GPU.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await stage.warmGraphics(performers);
    return bank;
  } catch (error) {
    bank.release();
    engine.assets.prune(new Set(engine.slots.flatMap((s) => {
      const c = characters.find((c) => c.id === s.part);
      return c ? [c.music.a, c.music.b ?? c.music.a] : [];
    })));
    throw error;
  }
}
