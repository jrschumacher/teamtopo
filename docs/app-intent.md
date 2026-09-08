# teamtopo app — intent and contract

Approved 2026-09-05. A free, hosted SPA around the `teamtopo` library: write a topology
in text, see it rendered, get a Team API page per team, share by link. No accounts.

## What we build

- **One document per UUID.** The document is the `.tt` source. Team APIs are derived
  from it, never stored separately.
- **Two links.** Edit link `/d/<id>#s=<secret>`; view link `/d/<id>#k=<key>`. Server
  never sees the fragment.
- **Client-side encryption.** Browser encrypts with AES-256-GCM before upload. R2 stores
  ciphertext. Nothing renders server-side.
- **Versions.** Every save appends a snapshot. Cap 100 per document, oldest evicted.
- **Team API pages.** `/d/<id>/team/<teamId>` renders that team's Team API. A form editor
  for the `api` block writes back into the source text. Text is the source of truth.
- **Email list.** Optional signup, double opt-in, stored in D1, never linked to a document.
- **Abuse limits.** 256 KB payload cap, 100 versions, rate limiting binding on writes.

## What we do not build

Accounts, orgs, real-time co-editing, drag-and-drop canvas, server-side rendering.

## Repo shape

```
src/                 library, unchanged (plain JS, node --test)
app/                 Worker + SPA. Own package.json (npm), Vite + @cloudflare/vite-plugin
app/worker/          Worker: index.ts (router), docs.ts, subscribe.ts, *.test.ts
app/src/             SPA: main.ts, router.ts, lib/, views/
app/src/lib/teamtopo.d.ts   type declarations for ../../../src/teamtopo.js
app/migrations/      D1 migrations (wrangler d1 migrations create DB "...")
app/public/          static assets
docs/                this file and later design notes
```

Conventions: `dev-ts` and `dev-wrangler` skills. npm, not pnpm (repo has no lockfile and
uses npm scripts). Vanilla TypeScript, no framework. Vitest 4 with
`@cloudflare/vitest-pool-workers` for the Worker; plain vitest (happy-dom) for `src/lib`.
Prettier tabs / singleQuote / no trailing comma / width 100, scoped to `app/`. eslint flat
config. Hand-rolled Result validators, no zod. Wrangler config is `app/wrangler.jsonc`.

## Crypto (client, `app/src/lib/crypto.ts`)

- `secret` = 32 random bytes, base64url. Lives only in the edit link fragment `#s=`.
- `encKey` = HKDF-SHA256(secret, salt = "teamtopo", info = "enc") → AES-256-GCM key.
  Exported raw as base64url for the view link fragment `#k=`.
- `writeToken` = HKDF-SHA256(secret, salt = "teamtopo", info = "write"), 32 bytes,
  base64url. Sent as `Authorization: Bearer <writeToken>` on create and save.
- Payload format, a JSON string: `{"v":1,"iv":"<base64url 12 bytes>","ct":"<base64url>"}`.
  Plaintext is the UTF-8 `.tt` source. Server treats payload as opaque text.
- Server stores `tokenHash` = base64url(SHA-256(writeToken)) and compares constant-time.

## Worker API (`app/worker/docs.ts`)

All JSON. Errors are `{ "error": "<code>", "message": "<text>" }`.

| Method | Path | Auth | Body | 2xx |
|---|---|---|---|---|
| POST | `/api/docs` | Bearer writeToken | `{ payload }` | 201 `{ id, version }` |
| GET | `/api/docs/:id` | none | | 200 `{ id, version, versions, payload }` |
| GET | `/api/docs/:id/versions/:vid` | none | | 200 `{ id, version, payload }` |
| PUT | `/api/docs/:id` | Bearer writeToken | `{ payload, base }` | 200 `{ id, version }` |

- `version` is `{ id, at, size }`; `versions` is the list, newest first.
- Version id: `<ms timestamp, 14 digits zero-padded>-<4 base36 random>`. Sorts by time.
- PUT with `base` ≠ latest → 409 `{ error: "stale", latest: <version> }`.
- Missing/wrong token → 401. Unknown id → 404. Payload > 256 KB → 413. Rate limited → 429.
- Server generates ids with `crypto.randomUUID()`.

R2 layout (binding `DOCS`):

```
docs/<id>/meta.json     { id, tokenHash, createdAt, latest: <vid>, versions: [ {id, at, size} ] }
docs/<id>/v/<vid>       payload text
```

Version list lives in meta, so reads never call R2 list. Eviction deletes the object and
drops it from meta.

## Subscribe API (`app/worker/subscribe.ts`, D1 binding `DB`)

| Method | Path | Body | Result |
|---|---|---|---|
| POST | `/api/subscribe` | `{ email }` | 202 always (no enumeration) |
| GET | `/api/subscribe/confirm?t=` | | redirect to `/?subscribed=1` |
| GET | `/api/subscribe/unsubscribe?t=` | | redirect to `/?unsubscribed=1` |

Table `subscribers(email PRIMARY KEY, token, created_at, confirmed_at, unsubscribed_at)`.
Confirmation mail via Cloudflare Email Service binding `EMAIL`; if the binding is absent
(local dev) log the link instead. Unconfirmed rows older than 7 days are ignored and
overwritten on re-signup. From address is var `EMAIL_FROM`.

## SPA routes (`app/src/router.ts`)

| Path | View |
|---|---|
| `/` | landing: catalog demo, features, free, signup |
| `/new` | editor, unsaved; first save POSTs and redirects to the edit link |
| `/privacy`, `/terms` | legal pages (`views/legal.ts`), landing chrome, Markdown body |
| `/d/:id` | editor if `#s=`, viewer if `#k=`, otherwise "link missing key" |
| `/d/:id/v/:vid` | read-only view of a version, same fragment rules |
| `/d/:id/team/:teamId` | Team API page for one team |

Fragment is preserved across in-app navigation. `not_found_handling` is
`single-page-application` for non-`/api` paths.

## Client lib contracts

```ts
// app/src/lib/crypto.ts
newSecret(): string
deriveKeys(secret: string): Promise<{ encKey: CryptoKey; viewKey: string; writeToken: string }>
importViewKey(viewKey: string): Promise<CryptoKey>
encrypt(key: CryptoKey, source: string): Promise<string>       // payload JSON
decrypt(key: CryptoKey, payload: string): Promise<string>

// app/src/lib/api.ts  (thin fetch wrappers mirroring the table above)
createDoc(payload, writeToken) / getDoc(id) / getVersion(id, vid) / saveDoc(id, payload, base, writeToken)

// app/src/lib/links.ts
parseFragment(hash): { secret?: string; viewKey?: string }
editLink(id, secret) / viewLink(id, viewKey) / teamLink(id, teamId, fragment)

// app/src/lib/apiblock.ts   (text-level editing of `api <team> { ... }` blocks)
readApiBlock(source, teamId): Record<string, string>
writeApiBlock(source, teamId, fields: Record<string, string>): string  // insert or replace, preserve everything else
```

## Catalog

`app/public/catalog.json` is generated at build from `examples/*.tt`:
`[{ name, title, source }]`. The landing hero renders these live with the library.
