---
name: teamtopo
description: Model, evolve and review Team Topologies diagrams written in the teamtopo `.tt` text syntax (stream-aligned, enabling, complicated-subsystem and platform teams; collaboration, X-as-a-Service and facilitating interactions; groups, platform groupings, Team API blocks). Use when the user wants to create a team topology or org topology from a description or from a repo, edit a `.tt` file (split, merge, rename, add a platform or enabling team, mark an interaction soon), review a topology for cognitive load or team health, write or fill in a Team API for a team, or render a Team Topologies diagram to SVG.
---

# teamtopo: Team Topologies diagrams as text

A `.tt` file describes a Team Topologies diagram the way a Mermaid file describes a
flowchart. The layout is automatic and follows the book: stream-aligned teams are
lanes, platforms are bars beneath, enabling teams are tall bars beside the lanes they
help, and interactions are shapes overlapping teams. You write and evolve the text;
the renderer draws it. Keep the file at `docs/org.tt` in the user's repo unless they
say otherwise.

```tt
teamTopology
  title Checkout domain
  flow

  stream   checkout "Checkout"
  stream   search   "Search"
  enabling devex    "DevEx"
  platform infra    "Infrastructure"

  infra --> checkout, search : hosting & CI
  devex ~~> checkout         : CI coaching [duration="until Q3"]
```

## Entry points

**A. Model an organisation** (from a description, or from the repo)
1. Discover first: `CODEOWNERS`, Backstage `catalog-info.yaml`, ownership files, ADRs,
   README org sections, an existing `.tt` (`references/discovery.md` §1). Infer team
   names and ownership; never infer team types or interaction modes without asking.
   If people can be mapped to teams, git history can suggest as-is interactions
   (`references/discovery.md`, "If you can map people to teams"); optional, never default.
2. Ask the minimum questions in one round (`references/discovery.md` §2): which teams,
   what each owns, who depends on whom and whether it is a service, joint work or
   coaching, rough sizes.
3. Translate org language into types and modes with `references/modeling.md`
   (vocabulary table, patterns, guardrails: never invent a team, labels are teams not
   people, not a service catalog).
4. Write the file, validate, show it, state your assumptions.
5. Optional: the Team API conversation, one team at a time
   (`references/discovery.md` §3).

**B. Evolve an existing file**
1. Read the whole file: ids are referenced from interaction lines and `api` blocks
   anywhere, and declaration order is the drawing order.
2. Pick the recipe in `references/edits.md` (split, merge, rename, add platform or
   enabling or subsystem, mark `[soon]`, group into value streams, Team API block) and
   the pattern in `references/modeling.md` if the change is structural.
3. Make the smallest diff; keep indentation, comments and alignment. Renames and
   splits cascade to every line naming the old id.
4. Validate, then report the ids added or renamed and every interaction touched.
5. Optional: the Team API conversation for new or changed teams.

**C. Review a file for health**
Run the smell checklist in `references/review.md` (overloaded streams, permanent
enabling, platforms with no consumers, teams everyone collaborates with, `size` over
nine, orphans, subsystems that are platforms, unlabelled interactions). Report by
team, worst first; propose structural changes as `docs/org-target.tt`.

## Rules the parser and layout enforce

- First non-comment line is `teamTopology`. Comments: `%%` or `//`. Indentation ignored.
- One declaration per line: `<type> <id> "Label" [attrs]`; types `stream`, `enabling`,
  `subsystem`, `platform`, `group`. Ids match `[A-Za-z_][A-Za-z0-9_.]*`; **no
  hyphens** (`a-b` silently becomes id `a`, label `-b`). Attributes come after the label.
- Only `platform` and `group` open a block: `{` on the declaration line, `}` alone.
- Interactions: `provider --> consumer`, `a <--> b`, `enabler ~~> team` (`<--`, `<~~`
  reverse). Comma lists on either side. Label after `:`, attributes last:
  `a ~~> b : coaching [soon, duration="6 weeks"]`. Quote a label containing `[`.
- Every id used must be declared somewhere; no self-interaction; no interaction with a
  containing block.
- Declaration order is the layout order. Declare enabling and subsystem teams in the
  same block as the lanes they touch (`references/layout.md`).

## Validate loop

Run the parser after every edit; exit 0 is the definition of valid
(`references/validate.md`): `node src/cli.js --json docs/org.tt` inside the teamtopo
repo, `npx --yes github:jrschumacher/teamtopo --json docs/org.tt` elsewhere, and
`npx teamtopo --json docs/org.tt` once the package is on npm. Errors are
`file:line: message`; fix and re-run. Render with the same command minus `--json`
(SVG on stdout), Team API documents with `--api [--team id]`. The file can also be
pasted into the hosted editor at https://teamtopo.dev/new to render and share.

## References

- `references/modeling.md`: vocabulary translation, patterns by org shape,
  interaction evolution (as-is / to-be), guardrails, one end-to-end worked example.
- `references/discovery.md`: repo sources to draft from, the question script, the
  Team API conversation.
- `references/review.md`: the smell checklist with signal, reason and edit.
- `references/edits.md`: step-by-step recipes for common edits.
- `references/syntax.md`: complete grammar, `api` fields, every parse error.
- `references/layout.md`: how things are placed and what that means for edits.
- `references/validate.md`: CLI forms, exit codes, post-edit checklist.
