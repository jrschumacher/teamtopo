# Visual evidence — #24 / #9

Screenshots for the team-identity pull request. "Before" is the same organisation
expressed the only way the syntax allowed before this change: team identity in prose
inside the lane labels, and a duplicated `api` block per lane. "After" is
`examples/team-ownership.tt`, which declares the teams and their ownership.

A team-free document renders byte-identically before and after — the corpus test in
`src/teamtopo.test.js` asserts that against every committed `examples/*.svg` — so the
"before" images are produced by the same build from a team-free source.

| File | Shows |
|---|---|
| `before-legend.png` / `after-legend.png` | the legend bands; after adds one row per team with its stream count |
| `before-diagram-light.png` / `after-diagram-light.png` | the motivating fixture, light theme |
| `before-diagram-dark.png` / `after-diagram-dark.png` | the same, dark theme |
| `before-app-team-page.png` / `after-app-team-page.png` | the Team API page: one page per lane, versus one page per real team |
| `before-app-sidebar.png` / `after-app-sidebar.png` | the sidebar list: flat lanes, versus teams with stream counts and their streams indented |
| `after-app-interactions.png` | a team's interactions: counterparts resolved to their owning team, duplicates collapsed, same-team edges under Internal |

Captured with headless Chromium: the SVGs rendered from source, the app pages driven
against the local vite dev server in `app/`.
