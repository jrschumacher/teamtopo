# Common edits

Each recipe assumes you have read the whole file first. After every edit, validate
(`references/validate.md`) and report the ids you added or changed. The reasoning
behind structural edits (when a platform, when a subsystem, how collaboration becomes
a service) and an end-to-end worked example are in `references/modeling.md`.

## Create a topology from scratch

1. Start with `teamTopology`, then `title`, `flow` and (for readers new to the
   notation) `legend`.
2. Declare stream-aligned teams first, top to bottom in the order the user lists them
   or in flow-of-change order. Then enabling teams, then complicated subsystems, then
   platforms. Blank lines and `%%` comments between the groups keep it readable.
3. Add interactions: platform wedges as fan-outs (`infra --> a, b, c : what`), then
   subsystem services, then facilitation, then collaborations.
4. Add `api` blocks only when the user gives Team API detail (focus, SLE, chat...).

Skeleton:

```
teamTopology
  title <Name>
  flow
  legend

  stream    <id> "<Label>"
  stream    <id> "<Label>"
  enabling  <id> "<Label>"
  subsystem <id> "<Label>"
  platform  <id> "<Label>"

  <platform> --> <stream>, <stream> : <service>
  <subsystem> --> <stream> : <service>
  <enabling> ~~> <stream> : <what they help with>
```

## Split a team into two

"Split checkout into two stream-aligned teams" means one lane becomes two lanes in the
same place, and everything that pointed at the old team must point at the right new
one(s).

1. Replace the declaration line with two lines, in the position of the old one. Choose
   fresh ids (`cart`, `pay`) rather than reusing the old id for one half, unless the
   user asks to keep it; a fresh id makes the cascade impossible to miss. Split any
   `size=` between them.
2. Find every interaction line naming the old id and rewrite it:
   - a fan-out that included the old team lists both new ids
     (`infra --> checkout, search` → `infra --> cart, pay, search`);
   - a service specific to one half goes to that half only
     (`payments --> checkout` → `payments --> pay`);
   - facilitation usually applies to both (`devex ~~> cart, pay`).
3. Consider a collaboration between the halves while the boundary settles, with a
   duration: `cart <--> pay : basket-to-payment handoff [duration="until Q4"]`.
4. Rewrite the `api checkout { }` block: rename it to the half that keeps the systems
   and add a short block for the other half, or drop it and say so.
5. Validate. `unknown team "checkout"` means a reference was missed.

## Merge two teams

The reverse: keep one declaration (or a new id), delete the other, and union the
interactions: every line that named either id now names the merged id, and any
interaction *between* the two is deleted (a team cannot interact with itself). Merge
their `api` blocks by hand.

## Rename a team

Change the id on the declaration, then every interaction line and `api` block naming
it. Use a whole-word search for the id: ids may be substrings of other ids (`pay` in
`payments`). Changing only the label needs no cascade.

## Add a platform

1. Declare `platform <id> "<Label>"` among the other platforms, in the vertical position
   it should take (declaration order stacks the bars). Add `[note="..."]` for what it
   contains.
2. Add one fan-out line for what it provides: `data --> mobile, web : analytics events`.
3. If the platform is itself a topology (several teams inside it), declare it as a
   `platform <id> "<Label>" { ... }` block with its own streams, subsystems and
   platforms inside, and write the inner interactions inside the block.

## Add an enabling team

1. Declare `enabling <id> "<Label>"` **in the same block as the lanes it will help**
   (top level if those lanes are at top level). Keep the label short.
2. Add `<id> ~~> <lane>, <lane> : <capability>`. The bar spans from the first to the
   last listed lane, so list the lanes it helps, not every lane.
3. Enabling engagements are meant to be temporary; add `[duration="..."]` when known.

## Add a complicated-subsystem team

1. Declare `subsystem <id> "<Label>"` in the same block as the lane it serves.
2. Add `<id> --> <lane> : <service>`. The first lane in that line is the one the
   octagon is embedded on. Further consumers are drawn as wedges.

## Mark an interaction as expected soon

Append `[soon]` (or `[expected]`) to the interaction line; add a duration if known:

```
security ~~> catalog : threat modelling [soon, duration="6 weeks"]
```

If the line is a fan-out and only one target is "soon", split that target onto its
own line so the others stay solid:

```
security ~~> storefront : threat modelling
security ~~> catalog    : threat modelling [soon, duration="6 weeks"]
```

Drawn dashed and faded; listed under "Teams we expect to interact with soon" in both
teams' Team API documents. When the interaction starts, remove `[soon]`.

## Change an interaction mode

Rewrite the operator: collaboration that has become a service is `a <--> b` →
`a --> b : <service>`; a facilitation that ended is deleted, not marked. Keep the label
and attributes unless they no longer apply.

## Group teams into value streams or organisational units

1. Wrap the stream declarations in `group <id> "<Label>" [kind="value stream"] { ... }`.
   Move the lines, keep their relative order.
2. Move overlays (enabling, subsystem) that only serve those lanes into the block.
3. Interactions can stay where they were; they may reference ids inside blocks from
   outside. Move the ones internal to the group into it for readability.
4. A group id can be used in interactions with things outside it
   (`ux1 <--> content`), but not with its own members.

## Add or update a Team API block

```
api <id> {
  focus: <one line>
  software: <systems, comma separated>
  SLE: <expectations>
  chat: <channels>
  working on: <current work>
}
```

Only include fields the user gave you; blank fields stay blank in the generated
document. Interactions and team type are derived from the diagram and never go in the
block. Inside the block only `%%` is a comment, so URLs are safe.

## Add a note or attribute

`[note="..."]` draws a second line under the team name; use it for scope, headcount or
tech ("Kubernetes, CI, observability"). Other attributes (`size=7`, `lead=Ana`) only
show in the tooltip. Attributes go after the label on the declaration line.
