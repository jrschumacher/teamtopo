# Layout rules and what they mean for edits

The renderer is not a general graph layout. It reproduces the conventions of the Team
Topologies book, so the text decides almost everything and there are no position
hints. Knowing the rules lets you predict the drawing from the diff.

## How a frame is drawn

Every block (`group { }`, `platform { }`) and the top level is a *frame* laid out with
the same rules, recursively:

1. **Lanes.** Stream-aligned teams declared directly in the frame are full-width
   yellow lanes stacked top to bottom **in declaration order**. A `group` with no
   children is also drawn as a lane.
2. **Platform bars.** Platform teams declared directly in the frame are full-width blue
   bars beneath the lanes, again in declaration order.
3. **Child frames.** Blocks whose majority content is lanes sit side by side *above*
   the frame's own lanes; blocks whose majority content is platforms (platform
   groupings) stretch full width *beneath* the platform bars.
4. **Overlays.** Complicated-subsystem teams are octagons in their own column on the
   right, embedded on the top edge of the **first lane they provide a service to** (the
   first `sub --> lane` in file order). That embedding *is* the X-as-a-Service
   relationship; no wedge is drawn for it. A subsystem with no `-->` to a lane sits
   above the lanes. **Exception — the shared rail:** a subsystem consumed across two or
   more sibling top-level groups is drawn once as a rail below them instead, so its
   position no longer depends on which `-->` line comes first — see rule 8b.
5. **Enabling bars.** Enabling teams are tall purple bars in their own column on the
   right (after the subsystems), spanning from the first to the last team they
   facilitate (`~~>`), overlapping each one with a dotted patch. An enabling team with
   no `~~>` spans all the frame's lanes. **Exception — the shared rail:** an enabling
   team that facilitates two or more sibling top-level groups — the group ids themselves
   or teams inside them — is drawn once as a thin horizontal rail below the frame band
   instead — see rule 8b.
6. **Wedges.** Every other X-as-a-Service is a grey wedge: wide base on the provider,
   point reaching the far edge of the consumer. A fan-out (`infra --> a, b, c` on one
   line, or several lines with the same provider and label) collapses into one wider
   wedge covering the consumers between — but only while they are a **contiguous run**
   of the lane/platform stack. Consumers with an unrelated lane between them get one
   wedge each, so no wedge ever sweeps a lane the provider does not serve; a run that
   does not start next to its provider keeps its own width and is joined back to the
   provider by a thin stem. Wedges from a platform bar up to lanes get a reserved
   column on the left of the lane labels. The
   one exception: a single-target X-as-a-Service between two platform bars that stack
   directly adjacent (nothing between them) draws no wedge — the stack already shows
   the layering. A small chevron marks the shared boundary instead, with the label (if
   any) on an opaque plate beside it, clear of both bars' titles. This is a rendering
   choice only; the interaction still shows up in the parsed model, JSON, and Team
   APIs exactly as written. A fan-out or a pair of non-adjacent platforms still gets
   the normal wedge.
7. **Collaboration** is a purple parallelogram bridging the two teams.
8. **Cross-frame interactions** (a wedge from one group's platform to another group, an
   enabling team declared outside the lanes it helps) fall back to geometry between the
   two boxes: legible, not pretty. Facilitating that cannot cross a lane becomes a
   dotted band.
8b. **The shared rail.** Anything shared across two or more sibling `group { }` blocks is
    drawn once as a rail below them: an enabling team facilitating them (`~~>`, in the
    enabling colour with the facilitating hatch) and a complicated subsystem they consume
    (`-->`, the subsystem octagon flattened out). The rail spans from the leftmost to the
    rightmost group it reaches into (a group in between that it does not touch is simply
    covered, not excluded) and is labelled once. A second shared team at the same level
    stacks as another rail row of the same fixed height below the first — canvas growth
    is one row per team, not per group spanned. A team shared with a single group, or
    with teams inside one group, keeps the tall column / embedded octagon treatment from
    rules 4-5 instead.

    ```tt
    teamTopology
      group product {
        stream desktop
      }
      group services {
        stream policy
      }
      enabling research
      research ~~> product
      research ~~> services
    ```
8c. **Lane markers.** The rail's targets can be the groups themselves or named teams
    inside them. A group named outright is covered by the rail below it and needs no
    other mark; a named team gets a small marker instead — a tab on its bottom edge,
    dotted in the enabling colour for facilitating, grey for X-as-a-Service, with the
    interaction label beside it when it fits (the tooltip carries it either way). So
    `coaching ~~> web`, `coaching ~~> portal`, `coaching ~~> ops` for lanes in three
    sibling groups draws one "Platform Coaching" rail under the three groups plus three
    tabs — never a band across the lanes and their labels, and the lanes beside them
    stay unmarked. Mixing the two (`~~> groupA`, `~~> laneInB`) is fine: the rail spans
    both groups, only the named lane is tabbed.
9. **Canvas** grows to fit; nothing is clipped. `title` goes at the top, `flow` is an
   arrow across the top, `legend` sits at the bottom.

## Consequences for the text you write

- **Ordering is declaration order, only.** To put a new stream between two existing
  ones, insert its line between theirs. To move a lane, move its line. Do not reorder
  lines you were not asked to touch.
- **New teams go where they should appear.** A platform declared before another
  platform is drawn above it. A stream added at the end of a group's stream list is the
  bottom lane of that group.
- **Overlays belong with their lanes.** Declare an enabling or subsystem team in the
  same block as the streams it facilitates or serves. If asked to add "security
  enablement for the retail teams" and the retail teams are in `group retail { }`,
  declare `enabling security` inside that group, not at top level. If it is shared across
  several sibling groups — whole groups (`security ~~> groupA`, `security ~~> groupB`) or
  named teams in them (`security ~~> laneInA`, `security ~~> laneInB`) — declare it at top
  level and it gets the shared rail with lane markers (rules 8b-8c), which is the intended
  shape for that case. The same goes for a subsystem several groups consume.
- **The first `sub --> lane` line decides where a subsystem sits** — unless its consumers
  are spread across sibling groups, in which case it gets a rail and file order stops
  mattering. Order the fan-out so the lane it is most associated with comes first.
- **Facilitation targets set an enabling bar's height.** `~~>` to the first and last
  lane makes the bar span everything between; a bar with a single target is short.
- **A platform grouping is a `platform { }` block.** Its inner streams are lanes inside
  the bar; wedges from them to the outer lanes (`k8s --> mobile, web`) are drawn like
  any other platform wedge.
- **Many wedges to the top lanes get busy.** A platform that provides to every lane
  above it draws as one wide wedge rather than four. Consumers that are not next to
  each other in the stack keep a wedge per run whichever way you write them, so
  declaring the lanes a platform serves next to each other keeps the picture calm —
  and honest, since a wedge only ever covers lanes the provider actually serves.
- **Labels wrap; ids do not draw.** Only labels appear in the SVG. Keep labels short
  (two or three words); the lane height grows to fit long ones. Use `note=` for detail.
- **Long labels on enabling bars rotate.** If a label does not fit across the narrow
  bar in three lines, it is drawn vertically. Prefer short enabling labels ("DevEx",
  "SRE Coaching").
- **Nothing you write positions anything.** There are no coordinates, `direction`,
  `rank` or `order` keywords. If the picture needs a different arrangement, change the
  declaration order or the block structure.
