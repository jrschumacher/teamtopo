# Modeling an organisation

The grammar has four team types and three interaction modes on purpose. Modeling is
the act of deciding which of those each real-world team and dependency is. This file
is the reasoning; `syntax.md` is the spelling. Every ```tt snippet here parses.

## Vocabulary: what people say → what you write

| They say | Usually | Ambiguity and the question that resolves it |
|---|---|---|
| Platform team, infra team, cloud team | `platform` | If product teams wait on tickets rather than self-serve, it is a gate, not a platform; model it as `platform` anyway and flag the smell (`review.md`). |
| SRE | `enabling` (teach on-call, SLOs) or `platform` (run observability, incident tooling) | "Do they run something teams consume, or teach teams to run their own?" Often both: two ids. |
| DBA team | `platform` (databases as a service) or `enabling` (schema and query coaching) | "Can a team create a database without asking them?" Yes → platform; no → they are gatekeeping, model as enabling with a `[soon]` platform (pattern 2). |
| Shared services, central engineering | `platform` | Ask what they provide; each service is a labelled `-->`. If nobody can name the service, it may be a `subsystem` or a smell. |
| Center of excellence, practice, guild with a mandate | `enabling` | "Do they build and run anything?" If yes, it is a platform wearing a CoE label. |
| Architecture board, review board, CAB | usually not a team in the topology | Governance is not a team interaction. Model as `enabling` only if they actually pair with teams; otherwise leave it out and say so. |
| Squad | `stream` | If it delivers a slice of the product end to end. A squad that only owns a component is a `subsystem` or a smell. |
| Tribe, domain, business unit | `group` | Give it `[kind="tribe"]` or `[kind="value stream"]`. |
| Chapter, guild, community of practice | not a team | People belong to a stream team and meet across teams. Do not add a team. If a chapter has a budget and a mission to lift other teams, it is `enabling`. |
| Tiger team, task force, SWAT | `enabling` with `duration=`, or a `<-->` collaboration with `duration=` | "Is it new people helping existing teams, or existing teams working jointly?" |
| Feature team | `stream` | Owns a user-facing flow end to end. |
| Component team | `subsystem` if the component needs deep specialist knowledge; `platform` if consumed as a service | If neither (it is just one layer of the product), that is the anti-pattern in pattern 5. |
| "The backend team", "the API team" | `platform` if product teams consume its APIs; `stream` if it owns a user-visible flow | "Do the product teams wait on the backend team to ship a feature?" Wait → collaboration smell; consume → platform. |
| Frontend team, mobile team | `stream` | A single mobile app team serving several product streams may be a `subsystem` (platform-specific expertise) or a smell (a layer team). |
| QA, test team | `enabling` | A permanent, separate QA team that every release goes through is a gate. Model the coaching as `~~>` with a duration and the goal as no QA team at all. |
| Security team | `enabling` (threat modelling, secure coding) and `platform` (secrets, scanning, identity as a service) | Nearly always both; use two ids, e.g. `secen` and `secpf`. |
| Data team | `platform` (data platform, pipelines, warehouse), `stream` (analytics product), or `subsystem` (ML model) | "Who is the customer: other teams, end users, or a model consumed by a product?" |
| DevOps team | `platform` (runs CI/CD and infra) or `enabling` (spreads DevOps practices) | A DevOps team that deploys for others is a gate; model as platform and flag. |
| Operations, support, run team | `platform` if they run something teams consume; otherwise not a separate team (you build it, you run it) | Ask what they run. |

When a mapping is ambiguous, ask the resolving question rather than guessing. One
question, then write the file.

## Patterns by org shape

### 1. A shared backend two product teams depend on

Platform or complicated subsystem? A **platform** hides complexity behind a service so
that stream teams do not need to understand it (APIs, hosting, identity). A
**subsystem** is a part of the product that needs specialists (a pricing engine, video
codec, ML ranking) and is *embedded* in one stream's flow.

```tt
teamTopology
  stream   web    "Web"
  stream   mobile "Mobile"
  platform api    "Core API" [note="orders, inventory, customers"]
  api --> web, mobile : product API
```

```tt
teamTopology
  stream    web     "Web"
  stream    mobile  "Mobile"
  subsystem pricing "Pricing Engine" [note="actuarial models"]
  pricing --> web, mobile : pricing API
```

Ask: "Could a stream team run this themselves if they had the time?" Yes → platform
(reduces load). No, it needs specialists → subsystem.

**Anti-pattern:** `api <--> web` and `api <--> mobile` as permanent collaborations. That
is backlog coupling: every feature needs three teams. Model collaboration only with a
`duration=` while the API is being designed.

### 2. A DBA, security or QA team

These are almost always an **enabling** engagement now and a **platform** later. Draw
the enabling relationship with a duration, and the platform service it is building
toward as `[soon]`.

```tt
teamTopology
  stream   orders  "Orders"
  stream   billing "Billing"
  enabling dba     "Database Enablement"
  platform dbaas   "Managed Databases"

  dba   ~~> orders          : schema design & query tuning [duration="until Q2"]
  dbaas --> orders, billing : Postgres as a service [soon]
```

**Anti-pattern:** `dba --> orders, billing : schema changes` where "service" means
raising a ticket and waiting. A gate is not X-as-a-Service; draw it as enabling and
name the self-service platform as the target.

### 3. A team everyone collaborates with

If one team has `<-->` to most others, that team is a bottleneck and collaboration is
hiding an undefined service. Model what the others actually take from it as XaaS.

```tt
teamTopology
  stream   search   "Search"
  stream   checkout "Checkout"
  stream   accounts "Accounts"
  platform identity "Identity"
  identity --> search, checkout, accounts : login & tokens
```

**Anti-pattern:** `identity <--> search`, `identity <--> checkout`,
`identity <--> accounts`. Keep one collaboration at most, with a `duration=`, for the
consumer whose needs are still being discovered.

### 4. A value stream with sub-teams

A value stream with several teams is a **group** of stream teams, with the platforms
they share outside the group.

```tt
teamTopology
  group retail "Retail" [kind="value stream"] {
    stream storefront "Storefront"
    stream fulfilment "Fulfilment"
    storefront <--> fulfilment : order events contract [duration="until Q3"]
  }
  platform core "Core Platform" [note="identity, billing, data"]
  core --> storefront, fulfilment
```

**Anti-pattern:** one huge `stream retail [size=18]`, or modeling the value stream as a
`platform` block because "it has sub-teams". A platform block is for a platform that is
itself a topology, not for any container.

### 5. A monolith with feature teams

Feature teams on one codebase collaborate by necessity. Model that honestly, with a
duration, and show where the shared parts are heading: a platform (or subsystem)
extracted from the monolith, marked `[soon]`.

```tt
teamTopology
  stream   catalog  "Catalog"
  stream   checkout "Checkout"
  platform core     "Core Services" [note="extracted from the monolith"]

  catalog <--> checkout : shared monolith releases [duration="until Q4"]
  core --> catalog, checkout : orders & inventory APIs [soon]
```

**Anti-pattern:** component teams per layer (`stream ui`, `stream api`, `stream db`)
with collaborations between all three. Layers are not streams; a change crosses every
team.

### 6. An internal tooling team

The thinnest viable platform: a few golden paths, consumed as a service. Name what it
provides in the label so the platform stays thin.

```tt
teamTopology
  stream   payments "Payments"
  stream   lending  "Lending"
  platform tooling  "Engineering Tooling" [note="CI templates, service scaffold, docs"]
  tooling --> payments, lending : golden paths
```

**Anti-pattern:** a tooling team that is `enabling` forever (it never becomes
self-service) or a platform with no labelled service (it builds whatever is asked).

### 7. A team of more than nine people

Cognitive load and communication paths both say: split along a fracture plane (a
business domain, a regulatory boundary, a change cadence, a user type). The two halves
usually collaborate for a while over the new seam.

```tt
teamTopology
  stream cart "Cart"    [size=5]
  stream pay  "Payment" [size=5]
  cart <--> pay : basket-to-payment handoff [duration="until Q4"]
```

**Anti-pattern:** `stream checkout "Checkout" [size=12]`. Ask the user for the
fracture plane; do not pick one for them.

## Interaction evolution

Interaction modes are not permanent:

- **Collaboration is temporary.** Two teams collaborate to discover an interface, then
  one provides it as a service. A collaboration with no `duration=` is a question.
- **Enabling engagements end.** An enabling team helps for weeks or months and moves
  on. Give every `~~>` a `duration=`.
- **X-as-a-Service is the steady state.** It is the only mode that scales.

One file can hold as-is and to-be: current interactions are plain, expected ones carry
`[soon]`, and durations say when the current ones end.

```tt
teamTopology
  title Payments: as-is and to-be
  stream   checkout "Checkout"
  enabling sre      "SRE Coaching"
  platform payments "Payments Platform"

  checkout <--> payments : building the tokenisation API together [duration="until Q3"]
  payments --> checkout  : tokenisation API [soon]
  sre ~~> checkout       : on-call practices [duration="8 weeks"]
```

When the target differs in structure (teams split, groups formed), keep two files with
the same ids: `docs/org.tt` (as-is) and `docs/org-target.tt` (to-be). `diff` between
them is the change plan. This is a convention until version compare
(jrschumacher/teamtopo#4) ships in the hosted editor; after that, keep one file and
compare versions there.

## Guardrails

- **Never invent a team the user did not name.** If the model needs something that
  does not exist ("someone must run the database"), ask, or leave a comment
  (`%% who runs Postgres?`) rather than adding a team.
- **Ask before choosing an interaction mode** when the dependency type is unclear.
  "Depends on" can be a service (`-->`), joint work (`<-->`) or coaching (`~~>`); the
  drawing and the Team API differ for each.
- **Labels are teams, never people.** `stream ana "Ana's team"` is wrong; ask what the
  team owns and name it for that.
- **Keep to topology and Team API.** Do not list every service, repo or endpoint as a
  team or attribute; the `api` block's `software` field and a `note=` are the limit.
  A `.tt` file is not a service catalog.
- **Prefer the smallest true model.** Fewer teams and labelled interactions beat a
  complete inventory. Leave out what the user has not confirmed.

## Worked example: two streams, a platform, then an enabling team

Prompt: "Create a topology with two stream teams and a platform, then add an enabling
team for security."

Step 1, from scratch: streams first (lanes, in the order given), the platform beneath
with one fan-out naming what it provides.

```tt
teamTopology
  title Web product
  flow
  legend

  stream   storefront "Storefront"
  stream   accounts   "Accounts"
  platform core       "Core Platform" [note="identity, hosting, CI"]

  core --> storefront, accounts : hosting & CI
```

Step 2, add the enabling team: declared at top level with the lanes it helps, one
facilitating line naming the capability, with a duration because enabling ends.

```tt
teamTopology
  title Web product
  flow
  legend

  stream   storefront "Storefront"
  stream   accounts   "Accounts"
  enabling security   "Security"
  platform core       "Core Platform" [note="identity, hosting, CI"]

  core     --> storefront, accounts : hosting & CI
  security ~~> storefront, accounts : threat modelling [duration="until Q3"]
```

Validate (`validate.md`), then report: added `security` (enabling), one facilitating
interaction to `storefront` and `accounts`.
