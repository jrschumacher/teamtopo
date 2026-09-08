# `.tt` syntax reference

Everything here is taken from the parser in `src/teamtopo.js` and checked against it.
Line-oriented: one statement per line, indentation ignored, blank lines ignored.

## File shape

```
teamTopology                      %% required header, case-insensitive
  title Diagram title             %% directives (optional, any order)
  flow Flow of change
  legend

  <team declarations>
  <interactions>
  <api blocks>
```

Declarations, interactions and `api` blocks may be interleaved; interactions are
validated after the whole file is read, so an interaction may reference a team that is
declared later. Conventional order: directives, teams, interactions, `api` blocks.

## Comments

- Outside `api` blocks: `%%` or `//` starts a comment, to end of line.
- Inside `api` blocks: only `%%` starts a comment, so `https://` values survive.
- Neither starts a comment inside double quotes: `stream a "A // not a comment"`.

## Directives

| Directive | Effect |
|---|---|
| `title Text` or `title "Text"` | Diagram title, drawn at the top. |
| `flow` | "Flow of change" arrow across the top. |
| `flow Custom text` | Same arrow with custom text. |
| `legend` | Key for the shapes and interaction modes. |

Directives are recognised anywhere in the file, including inside a `{ }` block (the
last `title` wins). Put them at the top.

## Team declarations

```
<type> <id> ["Label" | unquoted label] [attr, attr=value, attr="quoted value"] [{]
```

| Keyword | Aliases | Team type | Drawn as |
|---|---|---|---|
| `stream` | `stream-aligned`, `sa` | Stream-aligned | full-width yellow lane |
| `enabling` | `en` | Enabling | tall purple bar beside the lanes it facilitates |
| `subsystem` | `complicated-subsystem`, `cs` | Complicated subsystem | orange octagon on the first lane it serves |
| `platform` | `pf` | Platform | full-width blue bar beneath the lanes |
| `group` | | any other boundary | dashed frame, name on the bottom edge |

Keywords are case-insensitive. Use the long forms (`stream`, `enabling`, `subsystem`,
`platform`, `group`) in files you write; aliases exist for terseness only.

### Ids

- Pattern `[A-Za-z_][A-Za-z0-9_.]*`: letters, digits, `_` and `.`; must not start
  with a digit. Case-sensitive. Must be unique across the whole file, including inside
  blocks.
- **Hyphens are not part of an id.** `stream a-b "X"` parses without error as id `a`
  and label `-b "X"`. Use `a_b` or `aB`.
- A declaration with no id is an error: `stream "Checkout"` fails with
  `"stream" needs an identifier`. Always give an id and then a label.

### Labels

- Omitted: the label is the id (`stream app` → label `app`).
- Quoted: `stream app "Product Team"`. Backslash escapes a quote inside: `"Say \"hi\""`.
- Unquoted: everything after the id up to `[` or `{`, trimmed:
  `stream app Product Team` → label `Product Team`. Quote anything containing `[`,
  `{`, `"`, `//` or `%%`.

### Attributes

Square brackets after the label, comma-separated. Three value forms:

```
[size=7, note="on call weekly", oncall, team-lead=Ana]
```

- `key=value` unquoted: value runs to the next comma, whitespace or `]`.
- `key="value"` quoted: may contain commas, spaces and `]`; `\"` escapes a quote.
- bare `key`: stored as `"true"`.
- Keys match `[A-Za-z_][\w-]*` (hyphens allowed in keys, not in ids).
- Attributes must come after the label. `stream a [size=3] "A"` is an error
  (`unexpected ""A"" after stream declaration`).

Attributes with meaning:

| Attribute | On | Effect |
|---|---|---|
| `note="text"` | any team | second line under the team name |
| `kind="value stream"` | `group` | small label in the frame's corner |
| anything else | any team | listed in the SVG tooltip (`<title>`) with the team type |

`size=7` is a common convention for head-count; it only appears in the tooltip.

### Blocks

```
platform cloud "Cloud Platform" {
  stream   k8s "Kubernetes"
  platform bare "Bare-metal Fleet"
  bare --> k8s
}

group retail "Retail" [kind="value stream"] {
  stream storefront "Storefront"
}
```

- Only `platform` and `group` may open a block; `stream ... {`, `enabling ... {` and
  `subsystem ... {` fail with `only "platform" and "group" can open a "{ ... }" block`.
- The `{` must be the last thing on the declaration line. A `{` on the next line fails
  with `cannot understand "{"`.
- The closing `}` must be alone on its line. Blocks nest to any depth.
- A `platform { }` block is the book's *platform grouping*: a platform that is itself a
  topology. A `group { }` is any other boundary (value stream, tribe, department).
- Teams inside a block are laid out inside its frame with the same rules recursively.
  Interactions may be written inside or outside the block; they may cross block
  boundaries (`saas --> content` from a platform grouping to a group).
- A group with no children is drawn as a lane.

## Interactions

```
<ids> <operator> <ids> [: label] [[attrs]]
```

| Operator | Mode | Roles |
|---|---|---|
| `a --> b` | X-as-a-Service | `a` provides, `b` consumes |
| `b <-- a` | X-as-a-Service | same as above, written from the consumer's side |
| `a <--> b` or `a <-> b` | Collaboration | symmetric |
| `e ~~> t` | Facilitating | `e` (enabling team) facilitates `t` |
| `t <~~ e` | Facilitating | same, reversed |

- Either side is an id or a comma-separated list: `infra --> checkout, search, accounts`.
  A list on both sides is the cross product. Each pair becomes its own interaction in
  the model, but a fan-out from one provider with the same label is drawn as one wedge.
- Label: after `:`, runs to `[` or end of line, trimmed. Quote it if it contains `[`:
  `p --> a : "label with [brackets]"`. A `:` inside the label is fine
  (`a --> b : ratio 1:2`).
- Attributes: last, in `[ ]`, same forms as team attributes.

| Attribute | Effect |
|---|---|
| `[soon]` or `[expected]` | interaction expected soon: drawn dashed and faded; listed under "Teams we expect to interact with soon" in the Team API |
| `[duration="until Q3"]` | fills the Duration column of the Team API tables |
| anything else | kept in the model, not drawn |

```
devex ~~> checkout, accounts : CI pipelines [duration="until Q3"]
search <--> accounts : personalised results [soon, duration="8 weeks"]
```

Validation, applied after the whole file is parsed:

- both ends must be declared ids (`unknown team "x"`);
- an id cannot interact with itself;
- an id cannot interact with a block that contains it, at any depth
  (`"g" and "a" are nested; a team cannot interact with its own container`).

A block *can* interact with teams outside it (`ux1 <--> content`, where `content` is a
group), and a team inside one block can interact with a team inside another.

## `api` blocks

```
api checkout {
  focus: the checkout experience end to end
  software: checkout-service, cart-ui
  SLE: 99.9% availability, p95 < 300 ms
  versioning: semver, two releases of deprecation notice
  wiki: checkout, cart, basket
  chat: #checkout #checkout-alerts
  sync: 09:30 UTC
  working on: migrating to the new payments API
  ways of working: trunk-based development, pairing on Tuesdays
  improvements: shared on-call rotation with Accounts
}
```

- `api <id> {` on one line; `}` alone on its line; the id must be declared somewhere
  in the file (`api block for unknown team "x"` otherwise). One block per team is
  conventional; several blocks for the same id merge, later fields winning.
- Each line is `field: value`. A line without `:` is an error
  (`expected "field: value" inside the api block`). A quoted value has its quotes
  removed.
- Field names are matched loosely: lower-cased with everything but letters and digits
  removed, so `SLE`, `sle` and `Service Level Expectations` are the same field.
  Unknown fields are kept in the model but not printed in the Team API document.

Recognised fields and accepted spellings:

| Field | Accepted spellings | Team API line |
|---|---|---|
| `focus` | `focus`, `team name and focus` | Team name and focus |
| `platform` | `platform`, `part of a platform`, `platform details` | Part of a Platform? Details |
| `service` | `service`, `services`, `service details`, `do we provide a service to other teams` | Do we provide a service to other teams? Details |
| `sle` | `sle`, `sles`, `service level`, `service level expectations` | Service Level Expectations |
| `software` | `software`, `software owned`, `software owned and evolved by this team` | Software owned and evolved by this team |
| `versioning` | `versioning`, `versioning approaches` | Versioning approaches |
| `wiki` | `wiki`, `wiki search terms` | Wiki search terms |
| `chat` | `chat`, `channels`, `chat tool channels` | Chat tool channels |
| `sync` | `sync`, `daily sync`, `time of daily sync meeting` | Time of daily sync meeting |
| `working on` | `working on`, `working`, `services and systems`, `our services and systems` | Our services and systems |
| `ways of working` | `ways of working`, `ways` | Ways of working |
| `improvements` | `improvements`, `cross team improvements`, `wider cross-team or organisational improvements` | Wider cross-team or organisational improvements |

The rest of the Team API document (team type, part of a platform, services provided,
teams interacted with, expected-soon table) is derived from the diagram itself.

## Parse errors

Every error carries a line number; the CLI prints `file:line: message` and exits 1.

| Message | Cause and fix |
|---|---|
| `diagram must start with "teamTopology"` | missing or misspelled header, or something before it |
| `cannot understand "..."` | line matches nothing: usually a `{` or `api x` on its own line, an unquoted interaction label containing `[`, or a typo in an operator |
| `"stream" needs an identifier, e.g. ...` | label given without an id, or the id starts with a digit |
| `duplicate identifier "x" (first declared on line N)` | ids must be unique across blocks |
| `unexpected "..." after stream declaration` | trailing text; attributes before the label; an unquoted label containing `"` |
| `only "platform" and "group" can open a "{ ... }" block` | `{` after `stream`, `enabling` or `subsystem` |
| `unexpected "}" — no open block` | stray `}` |
| `block for "x" opened on line N is never closed with "}"` | missing `}` |
| `api block for "x" opened on line N is never closed with "}"` | missing `}` after an `api` block (note: inside it `//` is not a comment) |
| `expected "field: value" inside the api block for "x"` | an `api` line without `:` |
| `api block for unknown team "x"` | `api` id not declared |
| `unknown team "x"` | interaction end not declared; typical after a rename or split |
| `"x" cannot interact with itself` | same id on both sides |
| `"a" and "b" are nested; a team cannot interact with its own container` | interaction between a block and one of its descendants |
