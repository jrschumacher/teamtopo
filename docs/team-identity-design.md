# Team identity and Team API binding

Design spec for [#24](https://github.com/jrschumacher/teamtopo/issues/24) (model actual teams
separately from streams/capabilities) folded with [#9](https://github.com/jrschumacher/teamtopo/issues/9)
(`apiFields` document-level schema). Both change what the Team API is keyed on and what fields it
carries, so they are decided together and sequenced together. Status: proposed, not implemented.

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
  node, and nothing forbids two `owns` lines naming the same stream. The cost of many-to-many lands
  entirely in §3's rendering and in the "which document lists this interaction" question, not in the
  grammar.
- **SVG.** A small pill in the lane's top-right corner carrying the team label, drawn per owned box.
  No geometry change, so unowned diagrams are byte-identical. Multi-owned lanes carry two pills.
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

**Ship order: #24 first, #9 after.** Not because they conflict, but because #9's real weight is the
app form (selects, visual groups, "Other"), and doing it simultaneously means that rewrite has to
absorb schema and inheritance in one step. The exception: parse `apiFields` into `model.apiFields`
during #24's parser phase — it is ~15 lines in the same block-parsing region
(`src/teamtopo.js:127-134,154-157`) and lets `teamApi()` be written against a schema from the start
rather than being reordered twice.

## 4. Recommendation

**Take Option A: `team <id> "Label"` plus standalone `<id> owns a, b` lines, with `api` binding to
either namespace and node-level fields overriding team-level ones.** Model many-to-many as a list
from day one because the grammar gets it for free; defer only its *visual* treatment.

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
- `model.teams` (`src/teamtopo.js:210`) is now a misnomer — it is the flat list of topology nodes.
  Renaming it breaks `--json` consumers (`src/cli.js:41`), `teamApis()`, and three app call sites
  (`app/src/views/team.ts:80,285`). The spec assumes it stays and real teams land in a new field.
- `teamApis()` returns a different *set* for documents that use teams (one document per team, plus
  unowned nodes). Unchanged for every document that does not.
- Error messages get vaguer: "unknown team" at `src/teamtopo.js:227,234,969` now spans two kinds of
  thing.
- The team badge consumes lane label width; a long team label on a narrow lane wraps or clips.
- `apiblock.ts` derives a new block's indentation from `node.line` (`app/src/lib/apiblock.ts:177`),
  so team records must carry `line` — a small but load-bearing constraint on the model shape.

**Phased plan**

| Phase | Lands | Additive? | Could break |
|---|---|---|---|
| P1 | Parser: `team` decl, `owns` lines, `model.orgTeams`, `node.owners`, `model.apiFields` parsed only | yes | nothing; new keywords |
| P2 | Team API binding: `api <teamId>`, `teamApi()` over an owned set, `teamApis()` per team + unowned | yes for team-free docs | output *set* for team-using docs |
| P3 | SVG badge on owned boxes | yes | lane label width on narrow lanes |
| P4 | App: route resolves both namespaces, sidebar lists real teams, `apiblock.ts` team-aware, `teamtopo.d.ts` types | yes | the `as Node` cast at `team.ts:361` |
| P5 | Docs: README §Teams/§Team API blocks/§Team API, `skills/teamtopo/references/syntax.md` + `modeling.md`, **one new example file** (do not edit existing examples) | yes | skill fence test if a new fence is malformed |
| P6 | #9: `teamApi()` order from schema, app form with selects and "Other", inherited-value handling | yes | field order in existing exports if a doc declares `apiFields` |

**Tests to add**

- *Backward-compat corpus.* For every `examples/*.tt`, assert `render()` equals the checked-in
  `examples/<name>.svg` byte for byte (they are generated by `build.js:49-52`, so they are a real
  golden corpus that nothing currently asserts against — `src/teamtopo.test.js:276` only checks that
  rendering does not throw). Add the same for `teamApis()`: freeze the Markdown for every example
  before P1 lands.
- *Skill fences.* `src/skill.test.js:21` parses all 18 ```tt fences. Extend it to assert that a
  fence declaring no `team` yields an empty `orgTeams` and that every fence still renders.
- *New behaviour.* One team owning two streams produces one Team API document, not two; an
  interaction between two streams of the same team is handled per open question 3; node-level `api`
  fields override team-level ones; a stream owned by two teams appears in both documents.
- *App.* `apiblock.test.ts` round-trip for a team-bound block, including the "do not write inherited
  values" rule from §3.

Recommend running `plan-review` on this spec before it moves to accepted, and again on P2's
semantics once open questions 2, 3, and 5 are answered.

## 5. Open questions

1. New model field for real teams — `model.orgTeams`, or take the break and rename today's
   `model.teams` (`src/teamtopo.js:210`) to something honest like `model.nodes flat`?
2. If a stream is owned by a team, does that stream still get its own Team API document from
   `teamApis()`, or only the team?
3. An interaction between two streams owned by the same team: drop it from the team's Team API, or
   list it under a new "internal" heading?
4. Can a team own a `group` or a `platform` container (meaning everything inside it), or only leaf
   teams?
5. The "Team type" line (`src/teamtopo.js:995`) for a team owning a stream *and* a subsystem — union
   both names, take the first owned node's type, or require `[type=…]` on the `team` declaration?
6. Badge for v1 with band/overlay deferred until ownership sets are proven contiguous — accept, or
   is the band the point of the feature?
7. Does `team alpha "Alpha"` with no `owns` line parse as a placeholder team, or error?
8. Ship #9 `apiFields` in the same release as #24, or the next one?
