# Discovery: sources, questions, and the Team API conversation

## 1. Look before you ask

When working inside a repository, a first draft usually exists in files nobody thinks
of as an org chart. Check these before asking anything:

| Source | What it gives you |
|---|---|
| `CODEOWNERS` (root, `.github/`, `docs/`) | team names (`@org/team-name`) and what each owns, by path |
| Backstage `catalog-info.yaml` (`spec.owner`, `spec.type`, `spec.system`, `dependsOn`, `providesApis`, `consumesApis`) | teams, the components they own, and *directed* dependencies between components |
| `OWNERS`, `.owners`, `ownership.yaml`, `service.yaml`, PagerDuty/Opsgenie exports | service → team ownership |
| ADRs (`docs/adr/`, `docs/decisions/`) | boundaries that were decided, platforms that were created, teams that were split |
| README or `docs/` sections named "Teams", "Ownership", "Architecture", "Who to ask" | team names, contact channels, scope |
| an existing `.tt` (`docs/org.tt` by convention), or `.svg` rendered from one | the current model; evolve it rather than starting over |
| `package.json` / `go.mod` workspaces, monorepo directory names | candidate fracture planes, not teams |

**Infer without asking:** team names and labels, what each team owns (`software` in the
`api` block, or a `note=`), chat channels and wiki terms when they are written down,
and *that* a dependency exists when a catalog says so.

**Do not infer without asking:** team types and interaction modes. A `dependsOn` line
does not say whether it is a service, joint work or coaching; a path in `CODEOWNERS`
does not say whether the team is stream-aligned or a platform. Draft those as your best
guess, mark them, and confirm.

A draft from `CODEOWNERS` such as

```
/apps/storefront/   @acme/storefront
/apps/accounts/     @acme/accounts
/platform/          @acme/infra
```

becomes a file with the uncertain parts called out in comments:

```tt
teamTopology
  title Acme (draft from CODEOWNERS)

  stream   storefront "Storefront" [note="apps/storefront"]
  stream   accounts   "Accounts"   [note="apps/accounts"]
  platform infra      "Infra"      [note="platform/"]

  %% assumed: infra is consumed as a service; confirm the mode and what it provides
  infra --> storefront, accounts
```

Show the draft, ask the open questions in one message, then fix the file. Say which
lines came from which source so the user can correct the source too.

## 2. Modeling from a description

The minimum you need, in one round of questions (skip any the prose already answered):

1. **Which teams?** Names, as the organisation uses them. Do not add teams they did
   not name (`modeling.md`, Guardrails).
2. **What does each team own or deliver?** One phrase per team. This decides the type:
   a user-facing flow → `stream`; something other teams build on → `platform`;
   a specialist part of the product → `subsystem`; helping other teams get better →
   `enabling`.
3. **Who depends on whom, and how?** For each dependency: is it a *service* the other
   team consumes on its own (`-->`), *joint work* on something new (`<-->`), or
   *coaching* (`~~>`)? Offer those three words; people answer them easily.
4. **Rough sizes**, if the user cares about cognitive load (`[size=n]`; anything over
   nine is worth a question).
5. **Groupings**, only if they mentioned tribes, value streams or business units.

Ask these as one short list, not one at a time. If the answer to 3 is "it depends" or
"we just talk to them", draw the dependency as `<-->` with a `duration=` question in a
comment and say you did.

Then write the file, validate, and show it with two or three sentences on what you
assumed. Offer to run the Team API conversation below.

## 3. The Team API conversation

A Team API is the short document each team publishes about how to work with it. The
diagram already provides the team type, the services it offers (`-->` lines), whether
it is part of a platform, and the teams it interacts with. The `api` block holds the
rest. Fill it one team at a time:

1. Pick a team (start with the one the user cares about most, or the first stream).
2. Ask only for what the block can hold, in the user's words, in one message:
   - what the team owns (`focus`, `software`)
   - how to reach them (`chat`, `wiki`, `sync`)
   - what they promise (`sle`, `versioning`)
   - what they are working on now (`working on`, `ways of working`)
   - what is coming (`improvements`; and any expected interaction, which becomes a
     `[soon]` line, not a field)
   - `service` / `platform` free-text detail, only if the diagram's derived answer is
     not enough
3. Map the answers to fields using the spellings in `syntax.md` (loosely matched; use
   the short keys). Leave out fields they did not answer; blank stays blank.
4. Write the block at the end of the file:

```tt
teamTopology
  stream   checkout "Checkout"
  platform payments "Payments Platform"
  payments --> checkout : Payments API

  api checkout {
    focus: the checkout experience end to end
    software: checkout-service, cart-ui
    SLE: 99.9% availability, p95 < 300 ms
    chat: #checkout #checkout-alerts
    sync: 09:30 UTC
    working on: migrating to the new payments API
  }
```

5. Validate, show the block (or the rendered document from
   `node src/cli.js --api --team checkout docs/org.tt`), and move to the next team.
   Stop when the user says so; a file with `api` blocks for some teams is fine.

Do not ask for anything the grammar cannot store (headcount by role, OKRs, roadmaps).
If the user offers it, suggest a `note=` or leave it out.
