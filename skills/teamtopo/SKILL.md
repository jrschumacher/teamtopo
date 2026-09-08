---
name: teamtopo
description: Write and edit Team Topologies diagrams in the teamtopo `.tt` text syntax (stream-aligned, enabling, complicated-subsystem and platform teams; collaboration, X-as-a-Service and facilitating interactions; groups and platform groupings; Team API blocks) and validate them with the teamtopo CLI. Use when the user asks to create, draft, edit, split, merge or evolve a team topology or org topology, mentions a `.tt` file or teamtopo, or wants a Team Topologies diagram rendered to SVG or a Team API document generated.
---

# teamtopo: Team Topologies diagrams as text

A `.tt` file describes a Team Topologies diagram the way a Mermaid file describes a
flowchart. The layout is automatic and follows the book: stream-aligned teams are
horizontal lanes, platforms are bars beneath them, enabling teams are tall bars beside
the lanes they help, and interactions are shapes that overlap teams (not arrows).
Your job is to write or evolve the text; the renderer draws it.

```
teamTopology
  title Checkout domain
  flow

  stream   checkout "Checkout"
  stream   search   "Search"
  enabling devex    "DevEx"
  platform infra    "Infrastructure" {
    stream k8s "Kubernetes"
  }

  k8s   --> checkout, search : runtime
  devex ~~> checkout         : CI coaching
```

## Workflow

1. **Read the whole file** before editing. Ids are referenced from interaction lines
   and `api` blocks anywhere in the file, and declaration order decides the drawing.
2. **Plan the edit** with `references/edits.md` (split a team, add a platform, mark an
   interaction `[soon]`, add an enabling team, group into value streams, add a Team API).
3. **Write the change**, keeping the rules below. Prefer the smallest diff: keep the
   author's indentation, comments and column alignment.
4. **Validate** with the CLI (`references/validate.md`). The parser exits non-zero with
   `file:line: message` on any error; fix and re-run until it exits 0. Render to SVG
   when the user wants to look at it.
5. **Report** the ids you added or renamed and every interaction line you touched.

## Rules the parser and layout enforce

- The first non-comment line is `teamTopology`. Comments start with `%%` or `//`.
  Indentation is ignored, but keep it for readers.
- One declaration per line: `<type> <id> "Label" [attrs]`. Types: `stream`,
  `enabling`, `subsystem`, `platform`, `group`. Ids match `[A-Za-z_][A-Za-z0-9_.]*`.
  **No hyphens in ids** (`a-b` silently parses as id `a` with label `-b`); use
  `payment_checkout` or `paymentCheckout`.
- Labels default to the id. Quote labels with spaces or punctuation. Attributes come
  *after* the label, in square brackets: `[size=7, note="on call weekly"]`.
- Only `platform` and `group` open a block; the `{` goes on the declaration line and
  the `}` on its own line. Teams inside the block are drawn inside that frame.
- Interactions: `provider --> consumer` (X-as-a-Service), `a <--> b` (collaboration),
  `enabler ~~> team` (facilitating); `<--` and `<~~` reverse them. Either side may be a
  comma list. Label after `:`, attributes last: `a ~~> b : coaching [soon, duration="6 weeks"]`.
- Every id in an interaction or `api` block must be declared somewhere in the file
  (order does not matter). A team cannot interact with itself or with a block that
  contains it.
- **Renaming or splitting a team cascades**: update every interaction line and `api`
  block that names the old id, or the file will not parse.
- **Declaration order is the layout order.** Lanes stack top to bottom as declared;
  platforms stack beneath in declared order. There is no other ordering control, so
  place a new team in the list where it should appear.
- **Declare overlays with their lanes.** An enabling or subsystem team belongs in the
  same block as the lanes it facilitates or serves; from outside the block it falls
  back to a dotted band instead of overlapping the lanes.
- Unlabelled `-->` reads "XaaS" and unlabelled `<-->` reads "Collaboration" in the
  drawing, so labels are optional but helpful.

## References

- `references/syntax.md`: the complete grammar, attribute handling, `api` block fields,
  and every parse error with its cause.
- `references/layout.md`: how the renderer places things and what that means for the
  edits you make.
- `references/edits.md`: step-by-step recipes for the common edits.
- `references/validate.md`: CLI invocations (parse, render, Team API) and exit codes.
- `references/examples.md`: one worked prompt and diff per bundled example, all verified
  against the parser.
