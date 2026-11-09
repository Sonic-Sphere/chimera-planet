# Bongo Chimera

Open [Bongo Chimera](http://127.0.0.1:5431/BongoChimera/). The Chorus shows six heads around the Bongo Chorus ring and one overhead. Drag the stage to orbit, scroll or pinch to zoom, and select a head number to open its Chimera instrument. The seven Head tabs keep separate instrument settings while the page is open. Body and mouth adjustments carry over to the matching 3D head. An instrument's audio is paused when you leave its tab. Songs is reserved for shared playback.

## Run locally

On this Mac, double-click `Launch Bongo Chimera.command` to start or reopen the project.

On a fresh checkout, install Bun 1.4.4 or later and Rust via rustup. Run these commands from the project folder. [Bun](https://bun.sh/) · [rustup](https://rustup.rs/)

```sh
rustup target add wasm32-unknown-unknown
bun install --frozen-lockfile
bun run dev
```

The development server builds the voice engine on first launch. Run `bun run wasm` to rebuild it after editing Rust, `bun run build` for a production build, or `bun run preview` to serve that build on the same local address. Run one server at a time.

## Sources

The local Git history starts from a source snapshot of Bongo Chorus. The fork uses its seven-position layout, geodesic guide and trackball camera.

The instrument runs locally from Jameson Hodge's Chimera Vocal Synth at revision `092b16ce`. The Hershey and Archivo fonts and CMU Pronouncing Dictionary retain their bundled notices. Fork patches make the dictionary load from the app's base path and let the engine tests run from a folder with spaces. [Chimera source](https://github.com/jamesondh/chimera-vocal-synth/tree/092b16ce12b927d473c884ca2dfae53ce1b995df) · [MIT license](vendor/chimera/LICENSE)
