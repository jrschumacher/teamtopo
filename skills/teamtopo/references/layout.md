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
   above the lanes.
5. **Enabling bars.** Enabling teams are tall purple bars in their own column on the
   right (after the subsystems), spanning from the first to the last team they
   facilitate (`~~>`), overlapping each one with a dotted patch. An enabling team with
   no `~~>` spans all the frame's lanes.
6. **Wedges.** Every other X-as-a-Service is a grey wedge: wide base on the provider,
   point reaching the far edge of the consumer. A fan-out (`infra --> a, b, c` on one
   line, or several lines with the same provider and label) is one wedge that reaches
   the farthest consumer and covers the ones between, with a wider base. Wedges from a
   platform bar up to lanes get a reserved column on the left of the lane labels.
7. **Collaboration** is a purple parallelogram bridging the two teams.
8. **Cross-frame interactions** (a wedge from one group's platform to another group, an
   enabling team declared outside the lanes it helps) fall back to geometry between the
   two boxes: legible, not pretty. Facilitating that cannot cross a lane becomes a
   dotted band.
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
  declare `enabling security` inside that group, not at top level. If it helps lanes in
  several groups, declare it at top level and accept dotted bands.
- **The first `sub --> lane` line decides where a subsystem sits.** Order the fan-out so
  the lane it is most associated with comes first.
- **Facilitation targets set an enabling bar's height.** `~~>` to the first and last
  lane makes the bar span everything between; a bar with a single target is short.
- **A platform grouping is a `platform { }` block.** Its inner streams are lanes inside
  the bar; wedges from them to the outer lanes (`k8s --> mobile, web`) are drawn like
  any other platform wedge.
- **Many wedges to the top lanes get busy.** When a platform provides to many lanes,
  prefer one fan-out line (`core --> a, b, c, d`) over one line per consumer; it draws
  as one wide wedge instead of four.
- **Labels wrap; ids do not draw.** Only labels appear in the SVG. Keep labels short
  (two or three words); the lane height grows to fit long ones. Use `note=` for detail.
- **Long labels on enabling bars rotate.** If a label does not fit across the narrow
  bar in three lines, it is drawn vertically. Prefer short enabling labels ("DevEx",
  "SRE Coaching").
- **Nothing you write positions anything.** There are no coordinates, `direction`,
  `rank` or `order` keywords. If the picture needs a different arrangement, change the
  declaration order or the block structure.
