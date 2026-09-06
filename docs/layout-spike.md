# Layout spike: complex organisations

Spike on branch `spike/layout` (2026-09-05). Goal: render side-by-side groups and a vertical
platform between them as cleanly as the book's Docker organisation diagram. Throwaway
quality: the mechanism is tested, the product decisions are not made.

## What the spike found

1. **Horizontal cross-frame X-as-a-Service** already works when both endpoints are at the
   same layer (platform to platform in side-by-side groups). The Docker example never hits
   the diagonal fallback. Forcing horizontal when endpoints sit at very different heights
   produced a wedge detached from its target; reverted.
2. **Vertical platform** implemented: `platform id "Label" [orient=vertical]` declared as a
   sibling between the two frames it serves (declaration order is position). It lays out as
   a column spanning the union of its neighbours' lane ranges; its X-as-a-Service edges into
   lanes are short sideways tabs (`L.sideTab`) rather than full-width wedges.
3. **Shared platform baseline** across side-by-side frames already holds.
4. **Fan-out from a platform block** still draws one wedge per consumer because
   `wedgeGroups` only groups siblings sharing a stack level; a block is never in that set.
   Not implemented: where a block's wedge base sits needs a decision.
5. **Collapse/expand** not reached.

## Acceptance criteria for the real change

1. A platform `[orient=vertical]` renders as a column between the frames adjacent to it in
   declaration order, width `L.vertPlatW`, height the union of the lane y-ranges of the
   interactions touching it. (Test exists.)
2. Every X-as-a-Service edge with a vertical endpoint is horizontal and its apex stops within
   30% of the lane width. (Test exists.)
3. A platform block's multi-target fan-out collapses to one wedge with a widened base,
   mirroring the flat-platform rule.
4. All five `examples/*.tt` render byte-identical to their checked-in SVGs after the change.

## Open product questions

- **A vertical platform that also consumes a platform below it** (Kubernetes provides to a
  vertical Data Harbor): keep the diagonal as a documented degraded case, extend the column
  down to the platform baseline so the edge becomes a normal vertical wedge (recommended),
  or require both to be declared in the same group.
- **Collapse/expand**: ship `[collapsed]` plus a `collapse: [ids]` render option in the same
  release, or later.
- **Fan-out base placement** for platform blocks.

Renders from the spike, including the rejected dead ends, were kept only in the session
scratch directory; regenerate with `node src/cli.js` on a two-group fixture.
