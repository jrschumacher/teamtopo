# Usage analytics

Two independent signals, neither of which can identify a person:

- **Workers Analytics Engine** — usage events written by the Worker on the request path
  (`app/worker/analytics.ts`). Queried with the SQL API.
- **Cloudflare Web Analytics** — a page-view beacon on the landing page only
  (`app/src/lib/webAnalytics.ts`). Read in the dashboard.

Retention decisions are a separate issue (#12). Nothing here is a per-user record.

## Events

Every event is one Analytics Engine data point, written best-effort with `ctx.waitUntil` and
wrapped so a missing or failing binding can never fail or slow a request.

| Event               | When                                              | `double1` payload bytes | `double2` version count |
| ------------------- | ------------------------------------------------- | ----------------------- | ----------------------- |
| `doc_create`        | `POST /api/docs` succeeded                        | new version             | 1                       |
| `doc_view`          | `GET /api/docs/:id` (editor / viewer)             | latest version          | versions kept           |
| `team_view`         | `GET /api/docs/:id?view=team` (Team API page)     | latest version          | versions kept           |
| `version_view`      | `GET /api/docs/:id/versions/:vid`                 | that version            | versions kept           |
| `doc_save`          | `PUT /api/docs/:id` succeeded                     | new version             | versions kept           |
| `subscribe`         | signup accepted and a confirmation mail went out  | 0                       | 0                       |
| `subscribe_confirm` | confirmation link accepted                        | 0                       | 0                       |

Column layout (the queries below depend on it):

| Column   | Value                                                                  |
| -------- | ---------------------------------------------------------------------- |
| `index1` | event type (the sampling key)                                          |
| `blob1`  | event type                                                             |
| `blob2`  | document id, or `''` for subscribe events                              |
| `blob3`  | route _pattern_ (`/api/docs/:id`), never a concrete path               |
| `double1` | payload bytes (ciphertext size) or 0                                   |
| `double2` | number of versions the document holds after the request, or 0          |

Not recorded, by design: IP addresses, user agents, email addresses, tokens, concrete URLs.
The document id is an opaque UUID and the payload is encrypted client-side, so the id links
events to a blob nobody can read server-side. A repeat signup from an address that is already
confirmed does not count as a `subscribe`.

## Datasets and bindings

Configured in `app/wrangler.jsonc` under `analytics_engine_datasets`, binding `ANALYTICS`:

| Environment | Dataset                  |
| ----------- | ------------------------ |
| production  | `teamtopo_usage`         |
| preview     | `teamtopo_usage_preview` |

Datasets are created on first write; there is nothing to provision. Preview builds write to
their own dataset, so preview traffic never lands in the production numbers. Local
`wrangler dev` and the Vitest worker project get Miniflare's local binding, which stores
nothing you need to clean up.

## Querying with the SQL API

Create an API token with **Account | Account Analytics | Read** (dashboard → My Profile →
API Tokens). The account id is on the Workers overview page. Keep both in the environment,
never in the URL:

```sh
export CF_ACCOUNT_ID=...   # Workers & Pages overview, right-hand column
export CF_API_TOKEN=...    # Account Analytics: Read

query() {
  curl -sS "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/analytics_engine/sql" \
    --header "Authorization: Bearer $CF_API_TOKEN" \
    --data "$1"
}
```

Analytics Engine samples under load, so counts are `SUM(_sample_interval)`, never
`COUNT()`. Append `FORMAT TabSeparated` for a terminal-friendly table (the default is JSON).

### Views per day (last 30 days)

```sql
SELECT
  toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day,
  SUM(_sample_interval) AS views
FROM teamtopo_usage
WHERE blob1 = 'doc_view'
  AND timestamp > NOW() - INTERVAL '30' DAY
GROUP BY day
ORDER BY day
```

Swap `blob1 = 'doc_view'` for `blob1 IN ('doc_view', 'team_view', 'version_view')` to count
every kind of read, or group by `blob1` as well to split them:

```sql
SELECT
  toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day,
  blob1 AS event,
  SUM(_sample_interval) AS n
FROM teamtopo_usage
WHERE blob1 IN ('doc_view', 'team_view', 'version_view')
  AND timestamp > NOW() - INTERVAL '30' DAY
GROUP BY day, event
ORDER BY day, event
```

### Documents created per day

```sql
SELECT
  toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day,
  SUM(_sample_interval) AS created
FROM teamtopo_usage
WHERE blob1 = 'doc_create'
  AND timestamp > NOW() - INTERVAL '30' DAY
GROUP BY day
ORDER BY day
```

### Saves per day

```sql
SELECT
  toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day,
  SUM(_sample_interval) AS saves,
  SUM(_sample_interval * double1) / SUM(_sample_interval) AS avg_payload_bytes
FROM teamtopo_usage
WHERE blob1 = 'doc_save'
  AND timestamp > NOW() - INTERVAL '30' DAY
GROUP BY day
ORDER BY day
```

### Signups per week

```sql
SELECT
  toStartOfWeek(timestamp) AS week,
  SUM(IF(blob1 = 'subscribe', _sample_interval, 0)) AS signups,
  SUM(IF(blob1 = 'subscribe_confirm', _sample_interval, 0)) AS confirmed
FROM teamtopo_usage
WHERE blob1 IN ('subscribe', 'subscribe_confirm')
  AND timestamp > NOW() - INTERVAL '12' WEEK
GROUP BY week
ORDER BY week
```

Point any of these at `teamtopo_usage_preview` to check a preview build. Usage examples:

```sh
query "SELECT blob1, SUM(_sample_interval) AS n FROM teamtopo_usage WHERE timestamp > NOW() - INTERVAL '7' DAY GROUP BY blob1 FORMAT TabSeparated"
```

## Web Analytics beacon (landing page)

The beacon is added from the landing view only, and only when a token is present at build
time. It is configured with `spa: false`, so it never hooks history navigation and never sees
`/d/<id>` routes; the beacon also strips the URL fragment and query before sending, so the
key-carrying `#k=` / `#s=` links would not leave the browser in any case.

**Setting the token.** The token is `VITE_CF_WEB_ANALYTICS_TOKEN`, read by Vite at build
time; no token, no beacon. It is not committed anywhere.

1. Dashboard → Analytics & Logs → Web Analytics → **Add a site**. Enter the hostname
   (`teamtopo.abnl.workers.dev`, and `teamtopo.dev` once the custom domain is live), choose
   manual setup, and copy the `token` value out of the snippet it shows.
2. Workers Builds → the `teamtopo` Worker → Settings → Build → **Variables and secrets**:
   add `VITE_CF_WEB_ANALYTICS_TOKEN` for the **production** branch only. Leave it unset for
   preview builds so preview traffic does not show up in the site's numbers.
3. For a local build, put it in `app/.env.local` (gitignored):
   `VITE_CF_WEB_ANALYTICS_TOKEN=...`

Query strings are not logged by Web Analytics, and the token is a public site identifier
(it ships in the page), not a secret.
