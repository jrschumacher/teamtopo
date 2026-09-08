# Editor (and viewer): design contract

The editor in `app/src/views/editor.ts` and the viewer in `app/src/views/viewer.ts` ship the
visual design from the Claude Design artboard (header shell, source pane, Diagram/Team APIs
tabs). Styles live in `app/src/views/editor.css`, imported by both views. Keep the ids and
classes in the contract section stable — tests, and the header the viewer shares with the
editor, depend on them.

## Brief

Fonts are system-ui only (no webfonts); theme follows `prefers-color-scheme` only — there is
no theme toggle. The editor's header carries the brand, the document title (read-only, derived
from the source's `title` directive), a save-state pill, and popovers for Examples (new
documents only), History and Share, ending in a primary Save button. The workspace below splits
into a source pane (line gutter, syntax-highlighted overlay, a plain textarea underneath with a
transparent fill and an accent caret) and a right pane with a Diagram / Team APIs tab bar.

The viewer reuses the same header shell — brand, title, History, a view-only Share popover —
with none of the editor's controls (no state pill, no Examples, no tab bar, no Save).

## Integration contract (ids and classes the design must preserve)

### Header (`editor.ts` and `viewer.ts`)

- `.ed-bar` the header bar; `.ed-brand` (links `/`, four-square wordmark via
  `lib/brand.ts#brandMarkHtml`); `.ed-divider`.
- `#doc-title` (`.ed-title`) — read-only text, the parsed model's `title` or "Untitled
  diagram", updated on every successful parse.
- Editor only: `#state-pill` (`.ed-state`) containing `#state-dot` (`.ed-state-dot`,
  `data-tone="accent"` while saving, `data-tone="ok"` once saved, no attribute while dirty)
  and `#state-text` ("Unsaved changes" / "Saving…" / "Saved · encrypted").
- Popovers, each `.ed-pop-wrap` > button (`aria-haspopup`, `aria-expanded`) + `.ed-popover`
  panel (`hidden` when closed):
  - `#examples-btn` / `#examples-pop` (`#examples-list`) — editor only, and only when
    `doc === null` (the `/new` route). Items are `[data-example-index]` buttons; selecting one
    replaces the source and re-renders.
  - `#history-btn` / `#history-pop` — a `.ed-pop-list` `#versions` of `<a>` version links
    (`.ed-pop-item`, `.current` on the version currently open), newest first, no diff counts.
  - `#share-btn` / `#share-pop` — `.ed-share` containing a view pill (`#view-link` readonly
    input + `#copy-view` button) and, when the doc has an edit link, an edit pill
    (`.ed-share-pill.edit`, `#edit-link` + `#copy-edit`) and the `.ed-share-warn` write-access
    note. Viewer only ever shows the view pill.
  - `#backdrop` (`.ed-backdrop`) is the fixed, transparent, full-viewport element that closes
    every open popover on click; Escape closes them too. Exactly one popover is open at a time
    (`lib/popover.ts#setupPopovers`).
  - Copy buttons show "Copied" for 1.4 s (`COPY_FEEDBACK_MS` in `editor.ts`) before reverting.
- Editor only: `#save` (`.ed-btn.ed-btn-primary`), disabled while saving or unchanged.
- Viewer only: `#open-editor` when `doc.canEdit && doc.links.edit`.
- `#banner` (stale-409 reload/save-anyway flow) sits under the header; `button.link` for its
  `#reload` / `#save-anyway` actions (styles.css).

### Source pane (editor only)

- `.ed-pane-source` > `.ed-pane-head` ("Source" … `.ed-pane-ext` = `.tt`).
- `.ed-code` (single scrolling region) > `#gutter` (`.ed-gutter`, `aria-hidden`, one `<span>`
  per line, `.err` on the line with a parse error) and `.ed-code-main` > `#highlight`
  (`.ed-highlight`, `aria-hidden`, built by `lib/highlight.ts#highlight` — shared with the
  landing hero demo) under `#src` (`.ed-src`, transparent text/background, `caret-color:
  var(--accent)`), kept in visual registration by identical font/line-height/padding rather
  than JS scroll-sync.
- `#status` (`.ed-status`, `.error` on a parse error) > `#status-text` — "N teams, M
  interactions · no errors", or the parse error message with the gutter line highlighted.
- Tab in `#src` inserts two spaces at the caret; Shift+Tab removes up to two leading spaces
  from the current line. Neither moves focus out of the textarea.

### Right pane (editor only)

- `.ed-tabbar[role=tablist]` > `#tab-diagram` / `#tab-api` (`.ed-tab[role=tab]
  [aria-selected]`), `#export-svg` ("Export SVG", downloads `<title>.svg`), `#export-md`
  ("Markdown", downloads `<title>-team-apis.md`, every team's Team API joined with `---`),
  `#fit` (existing behaviour: toggles `aria-pressed` and the `.fit` class on `#canvas`).
- `#panel-diagram` (`.ed-panel[role=tabpanel]`, `hidden` when the API tab is active) >
  `#canvas` (`.ed-canvas.fit`) and a foot with `#render-status` ("rendered in N ms") and
  `#dims`.
- `#panel-api` (hidden when the Diagram tab is active) > `#api-grid` (`.ed-api-grid`) of
  `.ed-api-card` — an `<a>` to `teamLink()` when a doc is open, else a `<div>` — each with a
  `.ed-api-chip` in the team's colour (`stream`/`enabling`/`subsystem`/`platform`), an `<h3>`
  name, the type in mono, a `<dl>` of `api` block fields or the italic `.ed-api-empty` "No api
  block yet" line; a foot with `#api-status` ("N Team API pages generated") and the CC BY-SA
  attribution.

### Viewer body (unchanged besides the header)

- `.viewer-body` > `#canvas` (`.ed-canvas.fit`) and `.side` with `.team-list` and `.versions`
  (`.tag` marks the version being viewed). `.version-bar` shows when viewing `/d/:id/v/:vid`.

## Tokens

All colours, including the diagram palette (`--stream`/`--enabling`/`--subsystem`/
`--platform` and their `-edge` variants, `--kw-stream`/`--kw-en`/`--kw-cs`/`--kw-pf`, `--str`,
the `--term-*` set), live in `app/src/styles.css` `:root` — lifted there from the landing page
so the editor and the landing hero demo share one palette. `app/src/lib/highlight.ts` is the
single syntax highlighter, used by both the landing hero source pane and the editor's overlay.

## Deviations from the artboard

- The Share pills render an `<input readonly>` rather than a plain `<span>`, so the existing
  `#view-link` / `#edit-link` value contract (and easy manual copy) survives.
- Team API cards link to the team page only when a document is open (`/new`, before the first
  save, renders them as plain `<div>`s — there is nowhere to link to yet).
- No PNG export and no theme toggle, per product decision — the artboard's PNG button and
  theme-toggle control are omitted.
