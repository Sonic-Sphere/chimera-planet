# Chimera Planet

Open [Chimera Planet](https://sonic-sphere.github.io/chimera-planet/). Six heads surround the Bongo Chorus ring, with one at each pole. The opening performance starts automatically when the browser allows audio. If the browser requires an interaction, click the stage or press **Play**. Choose from 15 a cappella arrangements and use **Play** or **Pause**. All eight Chimera voices sing on a shared audio clock. Spoken words and sung syllables float from each voice's mouth by default. Use **Words** to hide or show them.

Move the pointer over the stage to make the eyes follow it. Every face points outward, including the two poles. Drag to see each head straight on, and scroll or pinch to zoom. With the stage focused, the arrow keys orbit and plus or minus zoom. Use **Slow orbit** for a gentle automatic rotation and **Reset view** to stop it and return to the starting angle and zoom.

## Run locally

On this Mac, double-click `Launch Chimera Planet.command` to start or reopen the project at its [permanent local URL](http://127.0.0.1:5431/BongoChimera/).

On a fresh checkout, install Bun 1.4.4 or later and Rust via rustup. Run these commands from the project folder. [Bun](https://bun.sh/) · [rustup](https://rustup.rs/)

```sh
rustup target add wasm32-unknown-unknown
bun install --frozen-lockfile
bun run dev
```

The development server builds the voice engine on first launch. Run `bun run wasm` to rebuild it after editing Rust, `bun run build` for a production build, or `bun run preview` to serve that build on the same local address. Run one server at a time.

## Sources

The local Git history starts from a source snapshot of Bongo Chorus. The fork extends that layout with a second pole and uses its geodesic guide and trackball camera.

The instrument runs locally from Jameson Hodge's Chimera Vocal Synth at revision `092b16ce`. The Hershey and Archivo fonts and CMU Pronouncing Dictionary retain their bundled notices. Fork patches make the dictionary load from the app's base path and let the engine tests run from a folder with spaces. [Chimera source](https://github.com/jamesondh/chimera-vocal-synth/tree/092b16ce12b927d473c884ca2dfae53ce1b995df) · [MIT license](vendor/chimera/LICENSE) · [Sonic Sphere team](https://sonic-sphere.com/)

The Songbook begins with an a cappella arrangement of “The Lion Sleeps Tonight” based on the Tokens' 1961 recording and Solomon Linda's “Mbube.” The lead introduces the synth and counts four beats into the song. The verse melodies use vocal syllables and the sung title line. [The Tokens' recording](https://www.youtube.com/watch?v=OQlByoPdG6c) · [Melody reference](https://pimbapiano.com/sites/default/files/2023-08/The%20Lion%20sleeps%20tonight%20-%20The%20Tokens-rv4.pdf) · [ABC Education: Mbube](https://www.abc.net.au/education/collections/lets-sing/mbube-the-lion-sleeps-tonight/105464332)
