# Team identity and Team API binding

Design spec for [#24](https://github.com/jrschumacher/teamtopo/issues/24) (model actual teams
separately from streams/capabilities) folded with [#9](https://github.com/jrschumacher/teamtopo/issues/9)
(`apiFields` document-level schema). Both change what the Team API is keyed on and what fields it
carries, so they are decided together and sequenced together. Status: decided (§4), not implemented.

Visual evidence: the shape gallery on branch `spike/shape-gallery`, `docs/shapes/README.md`
finding 5 (`team-owns-streams`), renders this exact shape with today's syntax and confirms it reads
as three independent stream-aligned teams; its two acceptance criteria constrain §4's badge design.

## 1. Problem

The parser has exactly one identifier namespace and one node record, and both the topology lane and
the real team are forced through it: `parse()` builds every declaration into a single flat list and
index (`src/teamtopo.js:208-211`), where `type` is a Team Topologies *shape* (`stream`, `platform`,
`enabling`, …, `src/teamtopo.js:20-26`) and `id` is simultaneously the layout key, the interaction
endpoint (`src/teamtopo.js:234`), and the Team API key. An `api` block is resolved against that same
index (`src/teamtopo.js:226-229`), `teamApi()` looks the id up there and reads `node.type`,
`node.parent`, and every interaction touching `node.id` (`src/teamtopo.js:966-1020`), and
`teamApis()` emits exactly one document per non-group node (`src/teamtopo.js:1025`). So when one real
team owns two streams — the motivating fixture has a single real team split across two lanes inside
one `group` — the identity exists nowhere in the model: it survives only in prose inside the two
labels, the team gets two Team API documents with duplicated `focus`/`chat`/`sle` content, and any
interaction drawn between the two lanes is reported to both documents as an inter-team interaction
(`src/teamtopo.js:984-986`), which is precisely the false signal the diagram exists to catch. The
same conflation reaches the app: the Team API route is keyed on the node id
(`app/src/router.ts:18`), the page and the round-tripping editor resolve it through `model.index`
(`app/src/views/team.ts:338,361`, `app/src/lib/apiblock.ts:133,155`), and the sidebar lists topology
nodes as if they were the teams (`app/src/views/team.ts:285`).

## 2. Syntax options

All three are additive: `team` is not a keyword today, so a line starting with `team ` currently
falls through `RE_NODE` and `RE_INTERACTION` and dies at `src/teamtopo.js:216`. Every existing `.tt`
therefore parses unchanged under any of them; the differences are in ergonomics and blast radius.

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
  Team ids join the existing identifier namespace, so the duplicate check at
  `src/teamtopo.js:182` covers team-vs-node collisions for free.
- **`api` blocks.** Bind to whatever the id names — team or node — with no syntax change at
  `src/teamtopo.js:154-157`. `api alpha {}` is the team's; `api desktop {}` stays the stream's. Where
  both exist, node fields override team fields for that node's document.
- **Cardinality.** One-to-many is the base case. Many-to-many is free: `owners` is a list on the
  node, and nothing forbids two `owns` lines naming the same stream. Its cost lands entirely in §4's
  badge design, not in the grammar.
- **SVG.** A corner badge on each owned box, designed in §4 below. No geometry change, so unowned
  diagrams are byte-identical.
- **Backward compatibility.** Total. New keyword, new statement, no attribute reinterpreted.
- **Cost.** Parser: ~35 lines. Model: `model.orgTeams[]` + `node.owners[]`. JSON: additive
  (`src/cli.js:41` serialises the model wholesale). SVG: one badge helper. Team API: the real work
  (§4 phase 2). App: route resolution, sidebar, `apiblock.ts` team-aware lookup. Docs: README
  §Teams/§Team API, `skills/teamtopo/references/syntax.md`, `modeling.md`.

### Option B — attribute form `[team=alpha]` on the stream

```tt
stream desktop "Desktop" [team=alpha]
```

- **Parse rules.** Zero new grammar — `parseAttrs()` already produces `{team: 'alpha'}`
  (`src/teamtopo.js:92-99`).
- **`api` blocks.** Needs a `team alpha "Alpha"` declaration anyway to hold the label and be the
  `api` target, so this is Option A *plus* a second way to state ownership, not an alternative to it.
- **Cardinality.** One owner per stream naturally; many-to-many only via `[team="alpha,bravo"]`,
  which puts a list inside a quoted attribute value and pushes splitting/validation into the
  renderer.
- **SVG.** Same badge; no advantage.
- **Backward compatibility.** The one real risk in this document. Unrecognised attributes currently
  fall through to the tooltip (README:69-71). Nothing in `examples/`, `skills/`, or `README.md` uses
  `team=` today (grepped), but hosted user documents cannot be grepped, and any that used `[team=…]`
  as a note would silently change meaning rather than error.
- **Cost.** Lower in the parser, higher everywhere else: ownership is scattered across the file, so
  "what does Alpha own" is a grep, and `writeApiBlock` gains a second place where identity can be
  edited.

### Option C — block form

```tt
team alpha "Alpha" {
  stream desktop "Desktop"
  stream sharepoint "SharePoint Proxy"
}
```

- **Parse rules.** Reuses the container stack (`src/teamtopo.js:207,212`), but must be exempted from
  the "only platform and group can open a block" guard at `src/teamtopo.js:203-205`.
- **`api` blocks.** Same as A.
- **Cardinality.** Strictly one-to-many, and many-to-many is unrepresentable — a node has one parent.
- **SVG.** A `{ }` block means spatial containment everywhere else in the language (it becomes a
  `frame`, laid out as a box). A real team's streams are frequently *not* contiguous and not in the
  same group — one stream in a product group and one component in the platform group is the common
  shape — so this form either draws a false boundary or forces the author to relocate declarations
  to satisfy the renderer.
- **Backward compatibility.** Total, same as A.
- **Cost.** Cheapest parser, most expensive semantics: it collapses ownership and containment, which
  are the two things #24 exists to separate.

## 3. How `apiFields` (#9) composes

`apiFields` is a document-level *presentation* schema — order, labels, optional choice lists, no
validation. It is orthogonal to what an `api` block is attached to: #24 changes the *key*, #9 changes
the *field list and order*. `teamApi()` currently hardcodes both order and labels in one array
literal (`src/teamtopo.js:989-1019`) against the canonical field set at `src/teamtopo.js:925-938`;
#9 replaces the order, #24 replaces the node lookup. They touch different halves of the same
function and do not conflict.

Two couplings do exist and must be decided even if #9 ships later:

1. **Unknown fields under inheritance.** #9 says non-schema fields render read-only under "Other"
   and are never dropped. With team-bound blocks a stream's page shows fields from two sources, so
   "Other" needs a provenance marker (`from team Alpha`) or it will read as the stream's own data.
2. **Round-trip must not freeze inheritance.** `writeApiBlock` writes every non-empty canonical key
   it is handed (`app/src/lib/apiblock.ts:171-175`). If the form is pre-filled with inherited team
   values, saving a stream copies the team's `focus`/`chat` into the stream's block, and the two
   drift apart forever. The form must track which values are inherited and omit them on save.

**Decided: #9 ships next release, #24 this one.** #24 parses `apiFields` into `model.apiFields` now
and nothing more — ~15 lines in the same block-parsing region (`src/teamtopo.js:127-134,154-157`),
which lets `teamApi()` be written against a schema from the start rather than being reordered twice.
#9's real weight is the app form (selects, visual groups, "Other"); doing it simultaneously would
make that rewrite absorb schema and inheritance in one step.

## 4. Recommendation

**Take Option A: `team <id> "Label"` plus standalone `<id> owns a, b` lines, with `api` binding to
either namespace and node-level fields overriding team-level ones.** Model many-to-many as a list
from day one because the grammar gets it for free.

**Decisions** (settled; the numbering matches the questions this spec originally asked)

1. Real teams live in a new `model.orgTeams` collection. `model.teams` keeps its current meaning and
   contents (`src/teamtopo.js:210`) — no rename, no break for `--json` or the app.
2. An owned node gets **no** Team API document of its own; only its team does. Unowned nodes keep
   theirs. `teamApis()` (`src/teamtopo.js:1025`) becomes: every `orgTeams` entry, plus every non-group
   node with an empty `owners`.
3. An interaction whose two endpoints are owned by the same team is listed in that team's Team API
   under a new **"Internal"** heading, not dropped and not mixed into "Teams we currently interact
   with". A node's own document never sees this case, because owned nodes have no document (2).
4. v1: a team may own **leaf nodes only** — streams, subsystems, enabling teams, and platform leaves.
   Owning a `group` or a `platform` container is a parse error naming the container. Revisit when
   someone declares a team whose whole footprint is one container.
5. "Team type" (`src/teamtopo.js:995`) is the **union of the owned nodes' type names** in declaration
   order, e.g. `Stream-aligned, Complicated subsystem`. A placeholder team with no owned nodes
   renders `Team`.
6. Corner badge for v1 — design below. Band/overlay stays deferred.
7. `team alpha "Alpha"` with no `owns` line is **valid**: a placeholder team. It gets a Team API
   document (type `Team`, empty interaction tables, whatever its `api` block holds) and draws nothing.
8. `apiFields` ships next release; #24 parses it into `model.apiFields` and stops there (§3).

**Badge design — staying legible at scale**

The constraint is Ryan's: a real org can put many teams across many lanes, and the gallery's finding
5 adds two acceptance criteria — shared ownership must be readable from shape or colour *without*
reading notes, and the treatment must not repeat the team name on every owned lane. A per-lane text
pill fails both the moment a diagram has eight teams.

- *Option 1 — name on first, colour thereafter.* Assign each team a colour deterministically by its
  index in `model.orgTeams` (stable across renders because declaration order is stable). Draw a full
  pill — colour chip plus team label — on the **first** owned node in layout order, and a bare colour
  chip on every other owned node. Every chip carries an SVG `<title>` with the team label, so hover
  gives the name back. Cheap, and the name appears exactly once as the gallery asks. Weakness: "first
  in layout order" is arbitrary, so the one lane that carries the name moves when a lane is
  reordered, and a reader scanning the bottom of a tall diagram sees only chips.
- *Option 2 — chips everywhere plus a team legend.* Every owned node gets a compact chip: the team's
  colour plus a short code (the first two characters of the team id, uppercased, disambiguated with a
  digit on collision), with `<title>` for the full label. Beneath the diagram — reusing the existing
  legend row machinery (`legendSVG`, `src/teamtopo.js:847-869`) and appearing whenever any team is
  declared, independent of the `legend` directive — a **team legend** lists colour + code → team
  name, once per team. Uniform per-lane cost (a chip is a fixed ~22px), the name is stated exactly
  once, and the mapping is resolvable anywhere on the page.

**Recommend Option 2.** It is the only one whose per-lane footprint does not grow with the team
label, it satisfies both gallery criteria without depending on layout order, and it degrades
predictably: the legend grows by one row per team while the lanes do not change at all.

- *Cap rule.* Palette is 8 distinct hues. Past 8 teams, hues cycle and the short code becomes the
  disambiguator — teams 1 and 9 share a hue but never a code, and the legend always shows both. Past
  20 teams the badge layer is suppressed entirely and the renderer emits a single note in the legend
  ("21 teams — ownership shown in the Team APIs"), because 20+ chip colours is noise, not signal.
  20 is a guess, not a measurement; see §5.
- *Many-to-many.* A node with two owners gets two chips side by side, in owner-declaration order. A
  node with more than three owners renders three chips plus a `+N` chip whose `<title>` lists the
  rest. Both owners' Team APIs list the node.

**Alternatives rejected**

- *Option B, `[team=alpha]`* — it does not remove the need for a `team` declaration (the label and
  the `api` target have to live somewhere), so it adds a second syntax without retiring the first,
  and it is the only option that can change the meaning of an existing hosted document.
- *Option C, block form* — a block is containment in this language, and a real team's footprint is
  not contiguous; it makes many-to-many unrepresentable and forces declaration order to serve layout.
- *Reuse `group` as team identity* — the current workaround. A group is a frame in the SVG and is
  explicitly excluded from `teamApis()` (`src/teamtopo.js:1025`); making it the identity means either
  emitting a Team API for every group (a breaking output change for existing documents) or adding an
  opt-in attribute, which is Option B with worse ergonomics.
- *Do nothing, keep identity in labels* — what the motivating fixture does. Costs stand: duplicated
  Team API content per lane, no way to answer "who owns this", and intra-team interactions rendered
  and reported as inter-team ones.

**Consequences — what gets worse**

- `model.index` becomes heterogeneous. Every `model.index[x]` consumer must tolerate a record with no
  `type`/`children`/`parent`; the unchecked cast at `app/src/views/team.ts:361` (`as Node`) becomes
  unsound and must be narrowed.
- `model.teams` (`src/teamtopo.js:210`) is a permanent misnomer under decision 1 — it is the flat
  list of topology nodes, and `model.orgTeams` sitting beside it is a name every future reader has to
  learn. Accepted to avoid breaking `--json` consumers (`src/cli.js:41`), `teamApis()`, and the app
  call sites at `app/src/views/team.ts:80,285`.
- Under decision 2 an owned node's Team API **disappears**. Anyone deep-linking
  `/d/<id>/team/<streamId>` for a now-owned stream gets a dead route; the app must redirect to the
  owning team's page rather than 404. Adding one `owns` line silently removes documents from
  `teamApis()` output.
- Error messages get vaguer: "unknown team" at `src/teamtopo.js:227,234,969` now spans two kinds of
  thing.
- Decision 4 means the natural shorthand — "this team owns that whole group" — is a parse error in
  v1, and an author with a 6-stream group must list all six ids.
- Every owned lane loses ~22px of label width to a chip, on every diagram that uses teams. The team
  legend adds a row per team below the diagram, growing the SVG height.
- `apiblock.ts` derives a new block's indentation from `node.line` (`app/src/lib/apiblock.ts:177`),
  so team records must carry `line` — a small but load-bearing constraint on the model shape.

**Phased plan**

| Phase | Lands | Additive? | Could break |
|---|---|---|---|
| P1 | Parser: `team` decl (placeholder legal, d7), `owns` lines with the leaf-only guard (d4), `model.orgTeams` (d1), `node.owners`, `model.apiFields` parsed and otherwise unused (d8) | yes | nothing; `team`/`owns` are new keywords |
| P2 | Team API: `api <teamId>` binding, `teamApi()` over an owned set with the union type line (d5) and the "Internal" heading (d3), `teamApis()` = teams + unowned nodes (d2) | yes for team-free docs | owned nodes lose their own document |
| P3 | SVG: deterministic team palette, chip per owned node, `+N` for >3 owners, team legend row, 8-hue cycle and 20-team suppression (Option 2) | yes | ~22px of lane label width; taller SVG |
| P4 | App: route resolves both namespaces **and redirects an owned node's URL to its team**, sidebar lists teams + unowned nodes, `apiblock.ts` team-aware, `teamtopo.d.ts` types | yes | the `as Node` cast at `team.ts:361`; existing team-page deep links |
| P5 | Docs: README §Teams/§Team API blocks/§Team API, `skills/teamtopo/references/syntax.md` + `modeling.md`, **one new example file** (do not edit existing examples) | yes | skill fence test if a new fence is malformed |
| P6 | *Next release* — #9: `teamApi()` order from schema, app form with selects and "Other", inherited-value handling | yes | field order in exports once a doc declares `apiFields` |

P1-P3 are one release and can land as one PR each; P4 must not ship before P2, or the app will link
to documents `teamApis()` no longer produces.

**Tests to add**

- *Backward-compat corpus.* For every `examples/*.tt`, assert `render()` equals the checked-in
  `examples/<name>.svg` byte for byte (they are generated by `build.js:49-52`, so they are a real
  golden corpus that nothing currently asserts against — `src/teamtopo.test.js:276` only checks that
  rendering does not throw). Add the same for `teamApis()`: freeze the Markdown for every example
  before P1 lands.
- *Skill fences.* `src/skill.test.js:21` parses all 18 ```tt fences. Extend it to assert that a
  fence declaring no `team` yields an empty `orgTeams` and that every fence still renders.
- *New behaviour, one test per decision.* d2: a team owning two streams yields exactly one document
  and the two streams yield none. d3: an interaction between two same-team streams lands under
  "Internal" and nowhere else. d4: `alpha owns pep_group` is a `ParseError` naming the container.
  d5: a team owning a stream and a subsystem renders both type names. d7: a placeholder team parses,
  gets a document, and adds no SVG element. Plus: node-level `api` fields override team-level ones,
  and a node owned by two teams appears in both documents.
- *SVG.* Palette assignment is deterministic across two renders of the same source; a node with four
  owners renders three chips and a `+1`; a 21-team document emits no chips and the suppression note.
- *App.* `apiblock.test.ts` round-trip for a team-bound block, including the "do not write inherited
  values" rule from §3, and a route test that an owned node's URL redirects to its team's page.

Recommend running `plan-review` on this spec before implementation starts, with particular attention
to P2's "Internal" heading and to the owned-node redirect in P4.

## 5. Still open

The eight questions this spec opened are answered in §4. What the decisions leave open:

1. The 20-team badge-suppression cap is a guess, not a measurement — keep 20, or set it after
   rendering the gallery's largest fixture with chips on?
2. Where does the 8-hue team palette come from — a new entry in `THEMES` (`src/teamtopo.js:698`
   onward, needing light and dark variants), or a fixed hue-rotation computed from the team index?
3. Does the app's team sidebar (`app/src/views/team.ts:285`) list owned nodes at all under decision
   2 — hidden entirely, or shown indented beneath their team as non-links?
