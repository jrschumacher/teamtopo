# Team identity and Team API binding

Design spec for [#24](https://github.com/jrschumacher/teamtopo/issues/24) (model actual teams
separately from streams/capabilities) folded with [#9](https://github.com/jrschumacher/teamtopo/issues/9)
(`apiFields` document-level schema). Both change what the Team API is keyed on and what fields it
carries, so they are decided together and sequenced together. Status: decided (§4), not implemented.

**The feature is a diagnostic, not an accommodation.** The owner's framing: "the reality is that we
have multiple streams owned by a single team. I can't change that right now and want to support this
showing the inefficiency as a tool." One team spread across many streams is extra cognitive load in
the book's terms, so the design surfaces that everywhere — a stream count in the diagram legend and
the Team API, a warning diagnostic, a note naming the streams as split candidates — rather than
tidying the split away into one clean team box.

Visual evidence: the shape gallery on `spike/shape-gallery`, `docs/shapes/README.md` finding 5
(`team-owns-streams`), renders this shape with today's syntax and confirms it reads as three
independent stream-aligned teams; its two acceptance criteria constrain §4's badge design.

## 1. Problem

The parser has one identifier namespace and one node record, and both the topology lane and the real
team are forced through it: `parse()` builds every declaration into a single flat list and index
(`src/teamtopo.js:208-211`), where `type` is a Team Topologies *shape* (`src/teamtopo.js:20-26`) and
`id` is at once the layout key, the interaction endpoint (`src/teamtopo.js:234`), and the Team API
key — `api` blocks resolve against that index (`src/teamtopo.js:226-229`), `teamApi()` reads
`node.type`, `node.parent` and every interaction touching `node.id` (`src/teamtopo.js:966-1020`), and
`teamApis()` emits one document per non-group node (`src/teamtopo.js:1025`). So when one real team
owns two streams — the motivating fixture splits one team across two lanes in one `group` — the
identity exists nowhere in the model: it survives only in prose inside the two labels, the team gets
two Team API documents with duplicated `focus`/`chat`/`sle`, and an interaction between the two lanes
is reported to both as an inter-team interaction (`src/teamtopo.js:984-986`) — the exact false signal
the diagram exists to catch. Nothing counts the split, so the cost is invisible. The conflation
reaches the app too: the Team API route is keyed on the node id (`app/src/router.ts:18`), the page
and the round-tripping editor resolve through `model.index` (`app/src/views/team.ts:338,361`,
`app/src/lib/apiblock.ts:133,155`), and the sidebar lists topology nodes as if they were the teams
(`app/src/views/team.ts:285`).

## 2. Syntax options

All three are additive: `team` is not a keyword today, so a line starting with `team ` falls through
`RE_NODE` and `RE_INTERACTION` and dies at `src/teamtopo.js:216`. Every existing `.tt` parses
unchanged under any of them; the differences are ergonomics and blast radius.

### Option A — `team` declaration plus an `owns` line (the issue's sketch)

```tt
team alpha "Alpha"
alpha owns desktop, sharepoint
api alpha { focus: … }
```

- **Parse rules.** Two new statement forms, both handled in the directive section of the loop
  (before `RE_NODE` at `src/teamtopo.js:178`): `^team\s+(ID)(rest)$` reusing the existing label and
  `[attrs]` scanners (`src/teamtopo.js:188-199`), and `^(ID)\s+owns\s+(ID(,ID)*)$`. `owns` is
  resolved *after* the file is read, in the same pass that resolves `api` blocks
  (`src/teamtopo.js:226-229`), so ownership may be declared before or after the streams and may name
  streams nested inside a `group`/`platform` block. Repeated `owns` lines for one team accumulate.
  Team ids join the existing identifier namespace; the `team` branch repeats the duplicate check of
  `src/teamtopo.js:182` against `model.index` so team-vs-node and team-vs-team collisions error the
  same way. Both keywords match case-insensitively, and `owns` is tried after the type keywords (d12).
- **`api` blocks.** No syntax change at `src/teamtopo.js:154-157`; `api alpha {}` is the team's. An
  `api` block on an *owned* node is a `ParseError` (d9) — fields live on the team, no inheritance.
- **Cardinality.** One-to-many is the base case; many-to-many is free, since `owners` is a list and
  nothing forbids two `owns` lines naming the same stream. Its cost lands in §4's badge design.
- **SVG.** A corner chip on each owned box (§4). Chips reserve width, so a document that declares
  teams changes geometry; one that declares none is byte-identical to today.
- **Backward compatibility.** Total. New keywords, new statements, no attribute reinterpreted.
- **Cost.** Parser ~35 lines plus the diagnostics rule; model gains `orgTeams`, `node.owners`,
  `diagnostics`; JSON additive (`src/cli.js:41`); one chip helper; the Team API rewrite is the real
  work; app route/sidebar/`apiblock.ts`; README, `syntax.md`, `modeling.md`.

### Option B — attribute form `[team=alpha]` on the stream

```tt
stream desktop "Desktop" [team=alpha]
```

- **Parse rules.** Zero new grammar — `parseAttrs()` already yields `{team: 'alpha'}`
  (`src/teamtopo.js:92-99`). But it still needs a `team alpha "Alpha"` declaration to hold the label
  and be the `api` target, so it is Option A *plus* a second way to say ownership, not a replacement.
  One owner per stream; many-to-many only via `[team="alpha,bravo"]`, a list in an attribute value.
- **Backward compatibility.** The one real risk in this document. Unrecognised attributes currently
  fall through to the tooltip (README:69-71). Nothing in `examples/`, `skills/` or `README.md` uses
  `team=` today (grepped), but hosted user documents cannot be grepped, and any that used `[team=…]`
  as a note would silently change meaning rather than error.
- **Cost.** Lower in the parser, higher everywhere else: ownership scatters across the file, so "what
  does Alpha own" becomes a grep — and there is no one line to hang the stream count on.

### Option C — block form

```tt
team alpha "Alpha" {
  stream desktop "Desktop"
  stream sharepoint "SharePoint Proxy"
}
```

- **Parse rules.** Reuses the container stack (`src/teamtopo.js:207,212`), exempted from the "only
  platform and group can open a block" guard (`src/teamtopo.js:203-205`). Backward compatible.
- **Cardinality.** Strictly one-to-many; many-to-many is unrepresentable — a node has one parent.
- **SVG / cost.** A `{ }` block means spatial containment everywhere else in the language (it becomes
  a `frame`), but a real team's streams are frequently *not* contiguous — one stream in a product
  group, one component in the platform group is the common shape — so this either draws a false
  boundary or forces declarations to move for the renderer's sake. Cheapest parser, most expensive
  semantics: it collapses the two things #24 exists to separate.

## 3. How `apiFields` (#9) composes

`apiFields` is a document-level *presentation* schema — order, labels, optional choice lists, no
validation — orthogonal to what an `api` block is attached to: #24 changes the *key*, #9 the *field
list and order*. `teamApi()` hardcodes both order and labels in one array literal
(`src/teamtopo.js:989-1019`) against the field set at `src/teamtopo.js:925-938`; #9 replaces the
order, #24 the lookup. Different halves of the same function; no conflict.

Decision d9 removes the coupling an earlier draft worried about: an owned node cannot carry an `api`
block at all, so no field ever has two sources — #9's "Other" bucket needs no provenance marker and
`writeApiBlock` (`app/src/lib/apiblock.ts:171-175`) has no inherited values to freeze. One block, one
owner, one schema. d9's diagram-derived lines are not `apiFields` entries, so they sit above the
schema block the way "Team type" does today.

**Decided: #9 ships next release, #24 this one.** #24 parses `apiFields` into `model.apiFields` and
nothing more — ~15 lines in the same block-parsing region (`src/teamtopo.js:127-134,154-157`), which
lets `teamApi()` be written against a schema from the start rather than reordered twice. #9's real
weight is the app form, and it should not be rewritten in the same release as the binding change.

## 4. Recommendation

**Take Option A: `team <id> "Label"` plus standalone `<id> owns a, b` lines. Team API fields live on
the team and only on the team.** Model many-to-many as a list from day one because the grammar gets
it for free.

**Decisions** (d1-d8 answer the questions this spec opened; d9-d13 resolve plan-review; d14-d15 are
the owner's addendum, his D9 and D10, renumbered here to avoid colliding with d9/d10 above)

1. Real teams live in a new `model.orgTeams` collection; `model.teams` keeps its current meaning and
   contents (`src/teamtopo.js:210`) — no rename, no break for `--json` or the app. `node.owners`
   holds team **ids**, never object references, so `--json` (`src/cli.js:41`) stays acyclic. The
   `team` branch runs its own duplicate check against `model.index`, covering team-vs-node and
   team-vs-team collisions with the message shape at `src/teamtopo.js:182`.
2. An owned node gets **no** Team API document of its own. As an API contract: `teamApis()`
   (`src/teamtopo.js:1025`) emits one document per `orgTeams` entry plus one per non-group node with
   an empty `owners`, never one per owned node; `teamApi(source, id)` accepts an owned node's id and
   **returns its owning team's document**, so `src/cli.js --team` and the app resolve rather than
   throwing (`src/teamtopo.js:969`). Two owners: resolves to the first in declaration order, and both
   teams' documents list the node.
3. An interaction is **Internal** to team T when T appears in the owner sets of *both* endpoints,
   listed in T's Team API under a new "Internal" heading — not dropped, not mixed into "Teams we
   currently interact with". Under many-to-many the same edge can be Internal for one team and
   external for another; each document decides independently.
4. v1: a team may own **leaf nodes only** — streams, subsystems, enabling teams, platform leaves.
   Owning a `group` or `platform` container is a parse error naming the container.
5. "Team type" (`src/teamtopo.js:995`) is the **union of the owned nodes' type names** — taken from
   `API_TYPE_NAMES` (`src/teamtopo.js:922`) so casing matches the rest of the document, deduped, in
   `owns`-line order. A placeholder team with no owned nodes renders `Team`.
6. Corner badge for v1 — design below. Band/overlay stays deferred.
7. `team alpha "Alpha"` with no `owns` line is **valid**: a placeholder team. It gets a Team API
   document (type `Team`, empty interaction tables, whatever its `api` block holds) and draws nothing.
8. `apiFields` ships next release; #24 parses it into `model.apiFields` and stops there (§3).
9. **An `api` block on an owned node is a `ParseError` on that line**, naming the owner: ``api
   desktop belongs to team alpha, which owns desktop; move these fields into `api alpha` ``. There is
   no inheritance, no override, and no merge in either direction. In exchange the Team API gains two
   diagnostic lines below "Team type", both rendered from d15's diagnostic rather than recomputed:
   `* Owns N streams: desktop, sharepoint` and, when N > 1, `* A team aligned to more than one stream
   carries the cognitive load of all of them; the streams above are split candidates.` The team
   legend row carries the same count — `Alpha (3 streams)` — so it doubles as an overload table.
10. **A team id as an interaction endpoint is a `ParseError`** at `src/teamtopo.js:234`, naming the
    team and pointing at an owned node: `` "alpha" is a team, not a node; use one of the nodes it
    owns (desktop, sharepoint) ``. Interactions stay between topology nodes; teams aggregate them.
11. Team API rows resolve the **other** endpoint to its owning team when that endpoint is owned:
    the row shows the owning team's label and the team's `focus`, not the node's
    (`src/teamtopo.js:946-956`). The from/to checks in `apiRow`/`teamApi` become set membership over
    the team's owned ids rather than `=== node.id` (`src/teamtopo.js:984-986`). Duplicate rows
    collapse where two owned nodes face the same external team, keeping each distinct purpose label.
    "Part of a Platform?" is `y` only when *every* owned node sits inside the same platform;
    otherwise the line is omitted rather than guessed.
12. Parse order: `owns` is tried **after** the type-keyword check (`src/teamtopo.js:178`), so
    `stream owns "Owns"` stays a node declaration and only a bare id followed by `owns` is ownership.
    `team` and `owns` match case-insensitively, like every other keyword (`src/teamtopo.js:66,73`).
13. The app's team sidebar (`app/src/views/team.ts:285`) lists **teams first, each with its owned
    nodes indented beneath it as non-links, then unowned nodes**. The indent is what makes a
    three-stream team visible in the app the way the legend makes it visible in the diagram.
14. **An owned node is a stream of work, not a team.** The owner's objection is the right one — "then
    I have to model something that doesn't truly exist" — so the model states the reading rule rather
    than letting a reader infer four teams from four lanes. In the README, the Skill and `--json`:
    *a node whose `owners` list is non-empty is not a team; it is work owned by the teams named
    there.* Every node carries `owners: string[]` (ids, d1); every `model.orgTeams` entry carries
    `owns: string[]` and a derived `load: { streams: N }` counting its stream-aligned nodes, so the
    CLI, the app and the Team API read one number instead of each recomputing it. That `load` is what
    the legend, the Team API line and d15's diagnostic all render.
15. **A diagnostics channel.** `parse()` attaches `model.diagnostics: [{ level: 'warning', code,
    line, message }]`, **never fatal** — `ParseError` stays the only fatal path. The tool must accept
    the org as it is and make the cost visible, not refuse the document. First rule,
    `team-multi-stream`: a team whose owned nodes include more than one stream-aligned node, in the
    book's terms — `team alpha is aligned to 2 streams: desktop, sharepoint; a team aligned to more
    than one stream carries extra cognitive load` — with `line` set to the `owns` line that completed
    the count. Only stream-aligned nodes count, so a team owning one stream plus a subsystem does not
    trigger it. Surfaces: the CLI writes diagnostics to **stderr**, never mixed into SVG or JSON on
    stdout, and `--json` carries them as a `diagnostics` key (`src/cli.js:39-42`); the Team API's
    "Owns N streams" line and load note (d9) render *from* this diagnostic; the app editor marks the
    gutter line in a warning colour, reusing PR #26 (`feat/editor-error-line`) — an app follow-up
    phase (P7), not part of the P1-P4 release.

**Badge design — staying legible at scale**

Constraints: a real org puts many teams across many lanes, and gallery finding 5 adds two criteria —
shared ownership readable from shape or colour *without* reading notes, and no repeating the team
name on every owned lane. A per-lane text pill fails both once a diagram has eight teams.

- *Option 1 — name on first, colour thereafter.* A colour per team by index in `model.orgTeams`; a
  full pill (chip + label) on the **first** owned node in layout order, a bare chip on the rest,
  `<title>` for hover. Weakness: "first in layout order" is arbitrary — the lane carrying the name
  moves when lanes are reordered, and a reader at the bottom of a tall diagram sees only chips.
- *Option 2 — chips everywhere plus a team legend.* Every owned node gets a compact chip: team colour
  plus a short code (first two characters of the id, uppercased, digit-disambiguated on collision),
  `<title>` carrying the full label. Beneath the diagram, reusing `legendSVG`
  (`src/teamtopo.js:847-869`), a **team legend** lists colour + code → team name **and owned-stream
  count**, `Alpha (3 streams)`, once per team.

**Recommend Option 2.** Its per-lane footprint does not grow with the team label, it meets both
gallery criteria without depending on layout order, it degrades predictably (one legend row per team,
lanes unchanged), and it is the only option with a natural home for the count that makes the
inefficiency legible.

- *Geometry.* Chips are **not free**: the strip reserves width in `structure()`
  (`src/teamtopo.js:348`, feeding `labelW` at `:378`), so a team-declaring document lays out
  differently from today while a team-free one reserves nothing and stays byte-identical — the
  compatibility boundary the corpus test asserts.
- *Drawing.* Chips are a separate helper called from `teamSVG` (`src/teamtopo.js:768`), never inline
  in its body — `teamSVG` is already the busiest function in the renderer and PR #34
  (`feat/stacked-platform-edge`) is changing layout concurrently.
- *Legend stacking.* The team legend is its own band with its own height term, stacked **below** the
  type legend when both are present. The two are independently gated: `legend` / `opts.legend=false`
  suppresses the **type** legend only, while the team legend appears whenever the document declares
  a team. A document with teams and no `legend` directive gets the team legend alone.
- *Cap rule.* Palette is 8 distinct hues. Past 8 teams, hues cycle and the short code becomes the
  disambiguator — teams 1 and 9 share a hue but never a code, and the legend always shows both. Past
  20 teams the chip layer is suppressed entirely and the renderer emits a single note in the legend
  ("21 teams — ownership shown in the Team APIs"), because 20+ chip colours is noise, not signal.
  20 is a guess, not a measurement; see §5.
- *Many-to-many.* A node with two owners gets two chips side by side, in owner-declaration order. A
  node with more than three owners renders three chips plus a `+N` chip whose `<title>` lists the
  rest. Both owners' Team APIs list the node; d3 decides Internal per team, not per edge.

**Alternatives rejected**

- *Option B, `[team=alpha]`* (§2) — adds a second syntax without retiring the first, and is the only
  option that can silently change the meaning of an existing hosted document.
- *Option C, block form* (§2) — collapses ownership into containment, the two things #24 separates.
- *Reuse `group` as team identity* — the current workaround. A group is a frame, excluded from
  `teamApis()` (`src/teamtopo.js:1025`); making it the identity means either a Team API per group (a
  breaking output change) or an opt-in attribute, i.e. Option B with worse ergonomics.
- *Do nothing, keep identity in labels* — what the motivating fixture does. Costs stand: duplicated
  Team API content per lane, no way to answer "who owns this", intra-team interactions reported as
  inter-team, and no number anywhere saying one team carries three streams.

**Consequences — what gets worse**

- `model.index` becomes heterogeneous — every consumer must tolerate a record with no
  `type`/`children`/`parent`, and the cast at `app/src/views/team.ts:361` (`as Node`) becomes unsound.
  `model.teams` (`src/teamtopo.js:210`) is a permanent misnomer under d1, with `model.orgTeams`
  beside it — accepted to avoid breaking `--json` (`src/cli.js:41`), `teamApis()` and
  `app/src/views/team.ts:80,285`.
- Under d2 an owned node's Team API **disappears** from `teamApis()`. Deep links survive only because
  `teamApi()` resolves an owned id to its team and the app redirects; both must land in the same
  release. Adding one `owns` line silently removes documents from the output set.
- Under d9, an author with an existing `api desktop { … }` who writes `alpha owns desktop` gets a
  **hard parse error**, not a migration — deliberate, since merging two blocks would hide which
  fields came from where, but it can break a document that parsed a minute ago, so the error text has
  to be the whole migration guide.
- Error messages get vaguer: "unknown team" (`src/teamtopo.js:227,234,969`) spans two kinds of thing,
  and two new error classes (d9, d10) exist only to say "you meant the other id".
- d4 makes the natural shorthand — "this team owns that whole group" — a parse error in v1; an author
  with a 6-stream group lists all six ids.
- Chips reserve layout width, so **every diagram that declares a team re-flows**: lanes narrow and a
  label that fitted on one line may wrap. The team legend adds a band. Team-free diagrams untouched.
- d15 adds a second, softer failure channel. Warnings that nobody surfaces are warnings nobody reads:
  until P7 lands, an app user sees the count in the Team API but no gutter mark. And a diagnostic
  that fires on a shape the org cannot change today is nagging unless the message stays descriptive.
- `apiblock.ts` derives a new block's indentation from `node.line` (`app/src/lib/apiblock.ts:177`),
  so team records must carry `line`.

**Phased plan**

**P1-P4 are ONE release** — one PR, or a stacked set merged together. They are not independently
shippable: the app bundles `src/teamtopo.js` directly (`app/vite.config.ts:10` aliases `@lib/teamtopo`
to it), so a build with P1's model but not P4's narrowing has an unsound `as Node` cast
(`app/src/views/team.ts:361`), and one with P2 but not P4 links to documents `teamApis()` no longer
emits. The narrowing and the owned-node redirect land *with* the parser change, not after it.

| Phase | Lands | Could break |
|---|---|---|
| P1 | Parser: `team` decl (d7), `owns` with the leaf-only guard (d4) and the parse-order rule (d12), `model.orgTeams` with `owns` + derived `load` and `node.owners` as ids (d1, d14), `model.diagnostics` with the `team-multi-stream` rule and `--json`/stderr surfaces (d15), the two new errors (d9, d10), `model.apiFields` parsed and otherwise unused (d8) | a document with an `api` block on a node it then declares owned (d9) |
| P2 | Team API: `api <teamId>` binding, owned-set membership and cross-owner row resolution (d11), union type line (d5), "Internal" heading (d3), `teamApis()` = teams + unowned (d2), `teamApi()` resolves an owned id to its team, "Owns N streams" + load note (d9) | owned nodes lose their own document |
| P3 | SVG: deterministic palette, chip helper called from `teamSVG`, width reserved in `structure()`, `+N` for >3 owners, team legend band with counts and its own gating, 8-hue cycle, 20-team suppression | geometry of any diagram that declares a team |
| P4 | App: route resolves both namespaces and redirects an owned node's URL to its team, sidebar per d13, `apiblock.ts` team-aware, `teamtopo.d.ts` types incl. `orgTeams`/`owners` | the `as Node` cast at `team.ts:361`; existing team-page deep links |
| P5 | Docs: README §Teams/§Team API blocks/§Team API, `skills/teamtopo/references/syntax.md` + `modeling.md`, **one new example file** (do not edit existing examples) | skill fence test if a new fence is malformed |
| P6 | *Next release* — #9: `teamApi()` order from schema, app form with selects and "Other" | field order in exports once a doc declares `apiFields` |
| P7 | *App follow-up, after the release* — editor gutter marks `model.diagnostics` lines in a warning colour, reusing PR #26 (`feat/editor-error-line`) | nothing; warnings are advisory |

*Ordering against work in flight.* P3 must land **after** PRs #28 (`feat/edge-labels`) and #30
(`feat/enabling-rail`), both of which change the same layout and legend code; PR #34
(`feat/stacked-platform-edge`) is a concurrent layout change to rebase against, not a dependency.

*Rollback.* Revert the single P1-P4 release. Documents that adopted `team`/`owns` then fail to parse
with "cannot understand" (`src/teamtopo.js:216`) — the pre-feature behaviour for that syntax, not a
new failure mode. No data migration to undo: the `.tt` source is the only store, and hosted documents
are unchanged bytes either way.

**Tests to add**

- *Backward-compat corpus.* For every `examples/*.tt`, assert `render()` equals the checked-in
  `examples/<name>.svg` byte for byte — generated by `build.js:49-52`, a real golden corpus nothing
  currently asserts against (`src/teamtopo.test.js:276` only checks rendering does not throw). Same
  for `teamApis()`, with `opts.date` pinned so the golden is stable. Freeze both before P1. This is
  the compatibility boundary: team-free documents byte-identical, team-declaring ones free to re-flow.
- *Skill fences.* `src/skill.test.js:21` parses all 18 ```tt fences. Extend it to assert that a
  fence declaring no `team` yields an empty `orgTeams` and that every fence still renders.
- *One case per rule.* d1: `--json` round-trips (`node.owners` are id strings, no cycle); a team id
  colliding with a node id errors. d2: a team owning two streams yields one document and the streams
  none; `teamApi(src, 'desktop')` returns Alpha's document. d3: an edge between two Alpha-owned
  streams is Internal for Alpha; under two owners it is Internal for one team and external for the
  other. d4: `alpha owns pep_group` is a `ParseError` naming the container. d5: a team owning a
  stream and a subsystem renders `Stream-Aligned, Complicated Subsystem`. d7: a placeholder team
  parses, gets a document, adds no SVG element. d9: `api desktop` on an owned node errors naming
  alpha; a 3-stream team's document carries "Owns 3 streams" and the load note; a 1-stream team's
  does not. d10: `alpha --> foo` errors naming an owned node. d11: a row for an owned counterpart
  shows the owning team's label and focus; "Part of a Platform?" is omitted when owned nodes sit in
  different platforms. d12: `stream owns "Owns"` parses as a node; `TEAM Alpha` / `OWNS x` parse.
  d14: `--json` shows `owners` on the node and `owns` + `load.streams` on the team, and the numbers
  agree. d15: a 2-stream team yields one `team-multi-stream` warning whose `line` is the `owns` line;
  a 1-stream team yields none; a team owning a stream **plus a subsystem** yields none (only
  stream-aligned nodes count); `--json` output includes a `diagnostics` key; diagnostics never make
  `parse()` throw; the CLI writes them to stderr and leaves stdout byte-identical.
- *SVG.* Palette assignment is deterministic across two renders; a node with four owners renders
  three chips and a `+1`; a 21-team document emits no chips and the suppression note; the legend row
  shows the stream count; `legend:false` with teams present emits the team legend and no type legend.
- *App.* `apiblock.test.ts` round-trips a team-bound block; a route test asserts an owned node's URL
  redirects to its team's page; a sidebar test asserts the d13 order.

This revision answers `plan-review`'s three blockers (d9/d2+d10/one-release sequencing) and its six
risks. Re-run `plan-review` before implementation starts.

## 5. Still open

The eight questions this spec opened, and plan-review's three blockers and six risks, are answered in
§4. Two implementation choices remain:

1. The 20-team chip-suppression cap is a guess, not a measurement — keep 20, or set it after
   rendering the gallery's largest fixture with chips on?
2. Where does the 8-hue team palette come from — a new entry in `THEMES` (`src/teamtopo.js:698`
   onward, needing light and dark variants), or a fixed hue-rotation computed from the team index?
