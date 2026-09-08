# Landing page: design contract

The landing page in `app/src/views/landing.ts` ships the visual design from the Claude Design
artboard (nav, hero demo panel, feature cards, free section, footer). Keep the ids and classes
in the contract section stable so the live catalog demo, tests, and signup widget keep working.

## Brief

Design a landing page for teamtopo, a free web tool that turns a few lines of text into a
Team Topologies diagram and generates a Team API document for every team in it. Think
"Mermaid for org design". Audience: engineering managers, staff engineers, and consultants
who already know Team Topologies.

Nav: a four-square wordmark (stream yellow, enabling purple, subsystem orange, platform blue)
linking home, a "Free" pill, links to Features and GitHub, and a primary "Open the editor"
button. No theme toggle — the page follows `prefers-color-scheme` only.

Hero: centred headline about describing your team topology in text and getting the book's
diagrams and Team APIs for free, two CTAs ("Open the editor" primary, "Browse examples"
secondary — both point at the live demo below), and a trust note: free, no account, diagrams
are encrypted in the browser and we never see them. Below the copy, full width, the product
itself, live: a source pane on the left with a line-number gutter and syntax highlighting
showing the text syntax, a status bar with a dot and a team/interaction count, and a rendered
diagram pane on the right that reveals bottom-up as the source types in — cycling through a
catalog of example topologies we ship (never customer data).

The visual language comes from the diagrams: stream-aligned teams are yellow lanes, enabling
teams purple bars, complicated subsystems orange octagons, platforms blue bars; interactions
are shapes that overlap teams. No stock illustrations, no fake customer logos, no gradient
blobs.

Features (seven cards, each with a small illustration — a code snippet or a CSS-shape mini
diagram): text syntax; layout that follows the book; a Team API page for every team, generated
and always in sync (show the Markdown, capped to a few lines); share with a link, view vs
edit; private by default, we store ciphertext; version history, go back to any earlier
version; also a CLI and a zero-dependency MIT library.

Free section: plain statement that it is free, why, no paid tier planned; the email signup
widget with a one-sentence privacy note and double opt-in mentioned.

Footer: wordmark, attribution "Team shapes and the Team API template are from Team Topologies
(CC BY-SA 4.0); not affiliated with or endorsed by Team Topologies." Links to GitHub, the MIT
license, privacy (`/privacy`) and terms (`/terms`). "Made with [squares] at aboldnewlook.com".
The nav and footer are shared with the legal pages (`app/src/views/chrome.ts`).

Constraints: light and dark themes via `prefers-color-scheme` only; responsive — the demo
panes stack under ~56rem, the nav wraps, the page body never scrolls horizontally; the
rendered diagram is the hero and everything else recedes; fonts are the shared `system-ui`
stack (`--font` / `--mono` in `styles.css`) — no webfonts.

## Integration contract (ids and classes the design must preserve)

- Nav: `.landing-nav`, `.nav-brand` (links `/`), `.free-pill`, `.nav-link` (`#features`,
  GitHub), `.nav-cta` (links `/new`).
- Hero: `#hero`, `.hero-copy`, `.hero-title`, `.hero-lede`, `.hero-ctas`, `#cta-editor`
  (`.cta.cta-primary`, links to `/new`), `#cta-examples` (`.cta.cta-secondary`, links to
  `#hero-demo`), `#trust-note`.
- Demo: `#hero-demo` (`data-motion="animated|reduced"`), `.hero-demo-bar`, `#hero-catalog`
  (`role=tablist`) containing `.hero-tab[role=tab][data-index][data-name][aria-selected]`
  (each with a `.tab-track`/`.tab-progress` fill), `#hero-pause` (`aria-pressed`; hidden under
  reduced motion), `.hero-panes` > `.hero-pane.hero-pane-source` (pane head, `#hero-gutter`,
  `#hero-source` — a `pre` whose `textContent` is always exactly the typed source, `#hero-status`
  with `#hero-status-dot` and `#hero-status-text`) and `.hero-pane.hero-pane-diagram` (pane
  head with `#hero-dims`, `#hero-diagram` with `data-state="empty|ok|stale|error"` — its
  `innerHTML` is the rendered `<svg>` directly, no wrapper).
- Features: `#features`, `#features-title`, `#features-list` > `.feature` with ids
  `#feature-syntax`, `#feature-layout`, `#feature-team-api`, `#feature-share`,
  `#feature-private`, `#feature-history`, `#feature-library`, each with `.feature-title`
  and `.feature-body`; `#feature-team-api-snippet` (a `pre` filled at runtime, capped to ~4
  lines visually).
- Free and footer: `#free`, `#free-title`, `#signup` (the signup widget mounts here),
  `#site-footer`, `#attribution`, `.footer-links`, `#footer-github`. Page wrapper
  `.landing`, section headings `.section-title`.

Behaviour that lives in the TypeScript, not the design: the catalog is fetched from
`/catalog.json`; typing runs at 3 characters per 24 ms with a 5 s hold per example and
re-renders on newline boundaries, keeping the last good render on parse errors; hover, focus
and `prefers-reduced-motion` pause it; rendered SVGs use `idPrefix` so several diagrams can
share the page. The status line and diagram reveal use team/interaction counts computed from
the typed source with the same team-type and arrow-token regexes as the parser
(`src/teamtopo.js`).
