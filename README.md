# teamtopo

A Mermaid-like text syntax for [Team Topologies](https://teamtopologies.com/key-concepts)
diagrams, and a zero-dependency renderer that turns it into SVG.

```
teamTopology
  title Checkout domain
  flow

  stream   checkout "Checkout"
  enabling devex    "DevEx"
  platform infra    "Infrastructure" {
    stream k8s "Kubernetes"
  }

  k8s   --> checkout : runtime
  devex ~~> checkout : CI coaching
```

Try it in the [playground](public/index.html) (open the file, or serve `public/`),
or from the command line:

```bash
node src/cli.js examples/ecommerce.tt > ecommerce.svg
cat diagram.tt | node src/cli.js --theme dark > dark.svg
node src/cli.js --json examples/ecommerce.tt     # the parsed model
```

![Product organisation example](examples/org-groups.svg)

## Why

Team Topologies has a small, precise visual vocabulary: four team types, three
interaction modes, and a handful of conventions (platforms at the bottom, flow of
change left to right, enabling teams drawn tall beside the streams they help).
Drawing those by hand in a diagramming tool is slow and the results drift from the
book's shapes. Mermaid showed that a small text language plus an opinionated
layout gets most people most of the way. This project applies the same idea
to team topologies.

## Hypothesis

A team-topology diagram can be described in a dozen lines of text and laid out
automatically well enough to be useful, because the domain constrains the layout
far more than a general graph does: team type decides the shape and the row, and
interactions are shapes that overlap teams rather than connectors between them.

## Syntax

The first non-comment line must be `teamTopology`. Comments start with `%%` or `//`.
Indentation is ignored.

### Teams

```
<type> <id> ["Label" | unquoted label] [attrs] [{]
```

| Keyword | Aliases | Team type | Shape |
|---|---|---|---|
| `stream` | `stream-aligned`, `sa` | Stream-aligned | full-width yellow lane, stacked in declaration order |
| `enabling` | `en` | Enabling | tall purple bar crossing the lanes it facilitates |
| `subsystem` | `complicated-subsystem`, `cs` | Complicated subsystem | orange octagon embedded on the lane it serves |
| `platform` | `pf` | Platform | full-width blue bar beneath the lanes |
| `group` | | Any other boundary | dashed frame, name on the bottom edge |

- `id` is `[A-Za-z_][A-Za-z0-9_.]*`. The label defaults to the id.
- Attributes are `key=value` pairs in square brackets: `[size=7, note="on call weekly"]`.
  `note` renders under the team name; `kind` labels a group's corner
  (e.g. `[kind="value stream"]`); everything else goes into the tooltip.
- `platform` and `group` may open a block with `{` and close it with `}` on its own line.
  Teams declared inside are laid out inside the container. A platform block is the
  book's *platform grouping*: a platform that is itself a topology of teams.

### Interactions

| Syntax | Mode | Meaning |
|---|---|---|
| `a <--> b` (or `<->`) | Collaboration | purple parallelogram bridging the two teams |
| `provider --> consumer` | X-as-a-Service | grey wedge, wide at the provider, pointed at the consumer |
| `consumer <-- provider` | X-as-a-Service | same, reversed |
| `enabler ~~> team` | Facilitating | dotted patch where the enabling bar crosses the team |
| `team <~~ enabler` | Facilitating | same, reversed |

The glyphs follow the book: the XaaS triangle, the collaboration parallelogram, the dotted
facilitating overlap. Unlabelled wedges read "XaaS" and unlabelled parallelograms read
"Collaboration", as they do in the reference diagrams.

Either side may be a comma-separated list: `infra --> checkout, search, accounts`.
A label follows a colon: `infra --> checkout : Kubernetes API`.

### Directives

| Directive | Effect |
|---|---|
| `title Text` | diagram title |
| `flow [Text]` | flow-of-change arrow across the top (default text "Flow of change") |
| `legend` | key for shapes and interaction modes |

### Errors

Parse errors carry a line number and a message. The playground highlights the line.

```
Line 12: unknown team "infra"
Line 20: "k8s" and "cloud" are nested; a team cannot interact with its own container
```

## Layout

The layout is not a general graph layout. It reproduces the conventions of the
Team Topologies book, so the domain does most of the work:

1. **Lanes.** Stream-aligned teams are full-width lanes stacked top to bottom in
   declaration order. Platform teams are full-width bars beneath them. Declaration
   order is the only ordering control, on purpose: it is predictable.
2. **Overlays.** Enabling teams are tall bars placed in their own column on the right,
   spanning from the first to the last team they facilitate and overlapping each one;
   the overlap is drawn as a dotted patch. Complicated-subsystem teams are octagons
   embedded on the top edge of the first lane they provide a service to, in their own
   column; that embedding *is* the X-as-a-Service relationship, so no wedge is drawn
   for it.
3. **Wedges.** Every other X-as-a-Service is a grey wedge with its wide base on the
   provider and its point reaching the far edge of the consumer, so the wedge covers
   it. A fan-out (`infra --> a, b, c`) is one wedge that reaches the farthest consumer
   and covers the ones between, with a wider base, as in the book. Wedges from a
   platform to lanes get a reserved column on the left of the lane labels, so they can
   pass through intermediate lanes. Wedges between frames pick a free
   column in the horizontal overlap of the two boxes.
4. **Frames.** Groups and platform groupings are dashed frames laid out with the same
   rules, recursively. Frames of streams sit side by side; platform groupings stretch
   to full width beneath. Overlays declared at a level with no lanes of their own get a
   column beside the frames, and facilitating that cannot cross a team is drawn as a
   dotted band to it.
5. **Canvas.** Anything that overflows the structural content grows the canvas.

To keep a subsystem or enabling team on the lanes it belongs with, declare it in the
same block as those lanes.

## API

```js
import { parse, layout, render } from './src/teamtopo.js';

const model = parse(source);              // { title, flow, legend, nodes, teams, interactions, index }
const lay = layout(model);                // { width, height, boxes, edges, ... }
const svg = render(source, { theme: 'dark' });   // or render(model, opts)
```

`render` options: `theme` (`'light'`, `'dark'`, or a theme object), `legend` (override the
directive), `idPrefix` (when several diagrams share a page), `fontFamily`.

`layout` returns absolute boxes per team plus one geometry per interaction
(`wedge`, `bridge`, `patch` or `band`), which is what the tests assert against.

## Files

```
teamtopo/
├── src/teamtopo.js        parser, layout, renderer (single ES module, no deps)
├── src/teamtopo.test.js   node --test
├── src/cli.js             file or stdin → SVG
├── src/playground.html    playground template (library inlined at build time)
├── build.js               → public/index.html, public/teamtopo.js, examples/*.svg
├── examples/*.tt          sample diagrams (+ rendered .svg)
└── public/                static playground, self-contained
```

```bash
npm test          # run the tests
npm run build     # rebuild public/ from src/
npm run examples  # rebuild public/ and re-render examples/*.svg
```

## Findings

- The first version treated this as a graph layout problem (nodes in rows, edges
  routed between them) and produced tidy diagrams that did not look like Team
  Topologies diagrams at all. The book's visual language is a *lane* language:
  interactions are drawn as shapes that overlap the teams, not as connectors. Once
  the layout was rebuilt around lanes and overlays, a dozen lines of syntax
  reproduced the canonical organisation diagram closely (see `examples/org-groups.tt`).
- With lanes, ordering stops being a search problem. Declaration order is enough and
  is easier to reason about than any automatic reordering.
- The hard cases are cross-frame interactions: a wedge from one group's platform to
  another group, or an enabling team declared outside the lanes it helps. Those fall
  back to geometry between the two boxes and are legible but not pretty.
- Text width is estimated per character class since there is no canvas in Node.
  Labels stay inside their shapes at the default fonts but the estimate is not exact.
- The largest example renders in well under 50 ms in Node.

## Limitations and ideas

- No `direction LR` yet; the book's convention is lanes with flow left to right, and
  that is all this does.
- Wedges pass through intermediate lanes rather than around them, as in the book.
  Very tall stacks with many platform-to-top-lane wedges get busy.
- Enabling bars cannot cross lanes in a different frame; those facilitations become
  dotted bands.
- Possible next steps: team-size and cognitive-load annotations, "as-is / to-be"
  pairs rendered side by side, a Mermaid plugin so this can live in Markdown fences,
  and a Graphviz-quality crossing reduction for larger organisations.

The shapes and colours follow the Team Topologies
[team shape templates](https://github.com/TeamTopologies/Team-Shape-Templates)
(CC BY-SA 4.0), approximated rather than copied.
