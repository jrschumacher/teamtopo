# Landing page: design brief and integration contract

The landing page in `app/src/views/landing.ts` is functional but plainly styled. Its
visual design is being produced separately (Claude Design) from the brief below. When the
design comes back, keep the ids and classes in the contract section so the live catalog
demo, tests, and signup widget keep working.

## Brief given to the designer

Design a landing page for teamtopo, a free web tool that turns a few lines of text into a
Team Topologies diagram and generates a Team API document for every team in it. Think
"Mermaid for org design". Audience: engineering managers, staff engineers, and consultants
who already know Team Topologies.

Hero: headline about describing your team topology in text and getting the book's diagrams
and Team APIs for free. Below it, the product itself, live: a source pane on the left showing
the text syntax, a rendered diagram on the right, cycling through a catalog of example
topologies we ship (never customer data). The source types itself in and the diagram updates
as it does. Two calls to action: "Open the editor" (primary) and "Browse examples". A trust
note: free, no account, diagrams are encrypted in the browser and we never see them.

The visual language comes from the diagrams: stream-aligned teams are yellow lanes, enabling
teams purple bars, complicated subsystems orange octagons, platforms blue bars; interactions
are shapes that overlap teams. No stock illustrations, no fake customer logos, no gradient
blobs.

Features (seven cards): text syntax; layout that follows the book; a Team API page for every
team, generated and always in sync (show the Markdown); share with a link, view vs edit;
private by default, we store ciphertext; version history, compare as-is and to-be; CLI and
zero-dependency MIT library.

Free section: plain statement that it is free, why, no paid tier planned; optional email
field with a one-sentence privacy note and double opt-in mentioned.

Footer: attribution "Shapes and Team API template are from Team Topologies (CC BY-SA 4.0);
not affiliated with or endorsed by Team Topologies." GitHub link, license, privacy.

Constraints: light and dark themes; responsive, hero stacks on mobile; the rendered diagram
is the hero and everything else recedes; deliver as HTML and CSS with the stable ids below.

## Integration contract (ids and classes the design must preserve)

- Hero: `#hero`, `.hero-copy`, `.hero-title`, `.hero-lede`, `.hero-ctas`, `#cta-editor`
  (`.cta.cta-primary`, links to `/new`), `#cta-examples` (`.cta.cta-secondary`, links to
  `#examples`), `#trust-note`.
- Demo: `#hero-demo` (`data-motion="animated|reduced"`), `.hero-demo-bar`, `#hero-catalog`
  (`role=tablist`) containing `.hero-tab[role=tab][data-index][data-name][aria-selected]`,
  `#hero-pause` (`aria-pressed`; hidden under reduced motion), `.hero-panes`, `#hero-source`
  (a `pre`), `#hero-diagram` (`data-state="empty|ok|stale|error"`).
- Examples: `#examples`, `#examples-title`, `#examples-list` > `.example[data-name]` >
  `.example-title`, `.example-diagram`, `.example-open` (links to `/new?example=<name>`).
- Features: `#features`, `#features-title`, `#features-list` > `.feature` with ids
  `#feature-syntax`, `#feature-layout`, `#feature-team-api`, `#feature-share`,
  `#feature-private`, `#feature-history`, `#feature-library`, each with `.feature-title`
  and `.feature-body`; `#feature-team-api-snippet` (a `pre` filled at runtime).
- Free and footer: `#free`, `#free-title`, `#signup` (the signup widget mounts here),
  `#site-footer`, `#attribution`, `.footer-links`, `#footer-github`. Page wrapper
  `.landing`, section headings `.section-title`.

Behaviour that lives in the TypeScript, not the design: the catalog is fetched from
`/catalog.json`; typing runs at 3 characters per 24 ms with a 5 s hold per example and
re-renders on newline boundaries, keeping the last good render on parse errors; hover, focus
and `prefers-reduced-motion` pause it; rendered SVGs use `idPrefix` so several diagrams can
share the page.
