# Validating a `.tt` file

The parser is the source of truth: a file is valid when the CLI exits 0. Always run
it after an edit and before reporting back.

## Commands

`teamtopo` is not yet on npm (tracked in jrschumacher/teamtopo#2), so pick the form
that matches where you are.

**Inside the teamtopo repository** (or a checkout of it):

```bash
node src/cli.js --json path/to/file.tt > /dev/null   # parse only; exit 0 = valid
node src/cli.js path/to/file.tt > file.svg            # render (light theme)
node src/cli.js --theme dark path/to/file.tt > dark.svg
node src/cli.js --api path/to/file.tt                  # Team API Markdown, every team
node src/cli.js --api --team checkout path/to/file.tt  # one team
cat file.tt | node src/cli.js                          # stdin works too
```

**From any other directory**, run the CLI straight from GitHub (the package has a
`bin` and no dependencies or build step; needs network the first time):

```bash
npx --yes github:jrschumacher/teamtopo --json path/to/file.tt > /dev/null
npx --yes github:jrschumacher/teamtopo path/to/file.tt > file.svg
```

**Once the npm package ships** (#2), the same flags on the published binary:

```bash
npx teamtopo --json path/to/file.tt > /dev/null
npx teamtopo path/to/file.tt > file.svg
npx teamtopo --api --team checkout path/to/file.tt
```

## Exit codes and output

| Exit | Meaning | Where |
|---|---|---|
| 0 | parsed (and rendered) | result on stdout |
| 1 | parse error | stderr: `path/to/file.tt:LINE: message`; also for `--team` with an unknown id |
| 2 | file could not be read | stderr: `cannot read path: reason` |

`--json` prints the parsed model, which is the quickest way to check that a rename or
split cascaded: `teams[].id` is every declared id, `interactions[]` has one entry per
pair with `mode`, `from`, `to`, `label`, `soon` and `duration`, and each team's `api`
holds its `api` block fields. In `xaas` interactions `from` is the provider; in
`facilitating`, `from` is the enabling team.

## Checklist after an edit

1. Exit code 0 from `--json`.
2. Every id you introduced appears in `teams` with the intended `type` and `parent`.
3. No interaction still names an id you renamed or removed (a stale one fails with
   `unknown team`, so exit 0 already proves this).
4. If the user will look at the picture, render to SVG and open it, or paste the source
   into the playground (`public/index.html` in the repository, or the hosted app),
   which highlights the failing line on error.
5. `[soon]` interactions show up in the `--api` output under "Teams we expect to
   interact with soon", not "currently interact with".

## Reading a parse error

The message names the line in the file you passed. The most common ones:

- `unknown team "x"` after a rename or split: an interaction or `api` block still
  names the old id. Search the file for the old id as a whole word.
- `cannot understand "{"`: the `{` was put on its own line; move it to the end of the
  `platform`/`group`/`api` line.
- `cannot understand "a --> b : label [x] ..."`: an unquoted interaction label contains
  `[`; quote the label.
- `"stream" needs an identifier`: a label was written without an id, or the id starts
  with a digit.
- `"a" and "b" are nested`: an interaction between a block and something inside it;
  interact with the inner team or with a sibling, not the container.

The full table is in `references/syntax.md`.
