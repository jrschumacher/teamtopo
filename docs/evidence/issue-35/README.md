# Evidence for #35 — one interaction mode per pair

Rendered with the repository's own renderer and screenshotted with the preinstalled
Chromium at `--force-device-scale-factor=2`.

| Image | Source | Renderer |
|---|---|---|
| `reproducer-before.png` | `docs/shapes/collab-xaas-same-pair.tt` on the unmerged `spike/shape-gallery` branch | `src/teamtopo.js` at `main` (5f6ee9b) |
| `ecommerce-before.png` | `examples/ecommerce.tt` at `main` (5f6ee9b) | same |
| `ecommerce-after.png` | `examples/ecommerce.tt` on this branch | `src/teamtopo.js` on this branch |

`reproducer-before.png` is the bug: the file declares `analytics_team <--> growth_team`
and `analytics_team --> growth_team`, and the collaboration parallelogram is painted over
the XaaS wedge's label, so `event pipeline` is in the SVG DOM and invisible in every
pixel. That input no longer renders at all — it is a `ParseError` on the second line.

The two `ecommerce` images are the only rendered output in the repository that this
change alters, and only because the example itself declared both modes for
`ranking`/`search`. The renderer is untouched: the sole difference is the removed
`new signals` parallelogram.
