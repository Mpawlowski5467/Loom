# Loom trailer

`loom-trailer.mp4` is a 30-second, 1280×720, 50 fps H.264/AAC product trailer
assembled from the current application on 2026-07-30.

## Storyboard

| Time | Scene |
|---|---|
| 0:00–0:02.5 | Loom identity and product promise |
| 0:02–0:05.5 | What Loom is: a local-first AI memory system |
| 0:05–0:11.5 | Brief graph interaction: focus, drag, zoom, and spatial views |
| 0:11–0:16 | Open and scroll a connected Markdown note |
| 0:16–0:20.5 | Agent Board in cards and live pulse modes |
| 0:20–0:27.5 | Human-controlled Inbox review |
| 0:27–0:30 | Local-first closing card |

Every application scene is one continuous capture of the current app, produced
by `record_dynamic_demo.mjs`. The brick cursor is part of the capture and makes
the real graph drag visible. `render_header_cards.mjs` creates the transparent
on-screen headers used by the build.

There is no narration. `synthesize_music.mjs` produces the changing eight-chord
ambient bed and light arpeggio without external audio assets. No private
provider keys or connector secrets are shown.

The 50 fps export preserves the capture's native 25 fps cadence with even 2×
frame pacing. The headers explain Loom's capabilities—local Markdown storage,
automatic connection discovery, five cooperating agents, and human review—
rather than narrating the visible clicks.

With Loom running at `http://localhost:5173`, rebuild the capture and trailer:

```bash
node docs/trailer/record_dynamic_demo.mjs
./docs/trailer/build_trailer.sh
```

Before publishing a future release, recapture the live segments from that exact
tag and verify every title, version, and connector state against the release
build.
