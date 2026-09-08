# Reviewing a `.tt` file for health

Read the whole file, run `node src/cli.js --json` to get the model, then walk this
list. Report each smell with the line, the reason, and the edit you propose; make
edits only when asked. Numbers are heuristics from Team Topologies, not rules.

| Smell | Signal | Why it matters | Edit |
|---|---|---|---|
| Overloaded stream team | a `stream` that is the target of three or more `<-->` lines, or of many `-->` from unrelated providers | Each collaboration costs a share of attention; cognitive load exceeds the team's capacity and flow slows. | Turn each collaboration into a labelled `-->` from the team that really provides something; keep at most one `<-->`, with a `duration=`. If the load is intrinsic, split the stream (`edits.md`, "Split a team"). |
| Permanent enabling team | a `~~>` with no `duration=`, or an `enabling` team present in every version of the file | Enabling is a temporary engagement; a permanent one is a dependency in disguise (or a platform that has not admitted it). | Add `[duration="..."]` with an end, or if the team runs something, redeclare it as `platform` and rewrite `~~>` as `-->` with the service named. |
| Platform with no consumers | a `platform` with no outgoing `-->` | A platform is defined by its consumers; without them it is cost with no flow, or the interactions are missing. | Ask what it provides and to whom; add the fan-out `p --> a, b : service`, or remove the team. |
| The team everyone collaborates with | one id on more than two `<-->` lines | It is a bottleneck: every change waits on the same people, and the service it should provide is undefined. | Model the actual service as `-->` (`modeling.md`, pattern 3); keep one collaboration for the consumer still being discovered. |
| Oversized team | `[size=n]` with n above nine | Communication paths grow faster than headcount; trust and shared context drop. | Ask for the fracture plane; split into two streams in the same position with a temporary `<-->` between them. |
| Orphan team | an id that appears in no interaction line | Either the team is isolated (no flow to or from it) or the model is incomplete. | Ask what it delivers and to whom; add the interaction, or delete the team if it is not part of this topology. |
| Subsystem that is really a platform | a `subsystem` with `-->` to most streams, or whose label names a general capability ("API", "Data", "Auth") | Subsystems are specialist parts of the product embedded in one flow; a broadly consumed capability is a platform and should reduce load rather than sit inside a lane. | Redeclare as `platform` (moves it beneath the lanes); keep the `-->` lines. |
| Platform that is really a subsystem | a `platform` with one consumer and a label naming a product feature | A platform with one consumer is a component team; the octagon on the lane tells the truth. | Redeclare as `subsystem`, keep the single `-->`. |
| Unlabelled interactions | `-->`, `<-->` or `~~>` with no `: label` | The label is the contract: what is provided, worked on or taught. Without it the Team API's Purpose column is blank and reviewers cannot tell a real service from a habit. | Add a short label naming the service, the joint work or the capability. |
| Collaboration with no end | `<-->` without `duration=` | Collaboration is for discovering an interface, then it should become X-as-a-Service; open-ended collaboration is coupling. | Add `[duration="..."]` and, if the target is known, the `-->` it becomes with `[soon]`. |
| Layer teams | streams named for a layer (`ui`, `api`, `db`) with collaborations between them | Every change crosses every team; nothing is stream-aligned. | Propose feature-aligned streams with the shared layer as a `platform` (`modeling.md`, pattern 5); do not restructure without the user. |
| Gatekeeper platform | a `platform` whose label or `note=` says "requests", "tickets", "approvals" | Ticket queues are not self-service; the platform is a gate on flow. | Keep the team, relabel the `-->` with the self-service it should offer, and add `[soon]` if that is the target rather than the present. |
| Overlay outside its lanes | an `enabling` or `subsystem` declared at top level while all the lanes it touches are inside one `group`/`platform` block | It draws as a dotted band instead of overlapping the lanes and reads as an outsider. | Move the declaration into that block. |
| Stale `[soon]` | a `[soon]` interaction whose `duration=` has passed, or one that has been in the file for many versions | The to-be never became as-is; either the change happened and the file is behind, or the plan stalled. | Ask; remove `[soon]` if it started, or delete the line if it was abandoned. |

## Reporting

Group findings by team, worst first, and say which are structural (splits, type
changes) versus cosmetic (labels, durations). Offer the structural ones as a
`docs/org-target.tt` rather than editing `docs/org.tt` in place (`modeling.md`,
Interaction evolution). Validate after any edit (`validate.md`).
