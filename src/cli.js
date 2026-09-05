#!/usr/bin/env node
/**
 * teamtopo CLI — render a .tt file (or stdin) to SVG on stdout.
 *
 *   node src/cli.js examples/ecommerce.tt > out.svg
 *   cat diagram.tt | node src/cli.js --theme dark > out.svg
 *   node src/cli.js --json examples/ecommerce.tt     # dump the parsed model
 *   node src/cli.js --api examples/ecommerce.tt      # Team API documents (Markdown) for every team
 *   node src/cli.js --api --team checkout diagram.tt # one team's Team API
 */
import { readFileSync } from 'node:fs';
import { render, parse, teamApi, teamApis, ParseError } from './teamtopo.js';

const args = process.argv.slice(2);
let theme = 'light', json = false, api = false, team = null, file = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--theme') theme = args[++i];
  else if (a === '--json') json = true;
  else if (a === '--api') api = true;
  else if (a === '--team') team = args[++i];
  else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
  else file = a;
}

function usage() {
  process.stdout.write('usage: teamtopo [--theme light|dark] [--json] [--api [--team id]] [file.tt]\n  reads stdin when no file is given\n');
}

let source;
try {
  source = readFileSync(file ?? 0, 'utf8');
} catch (e) {
  process.stderr.write(`cannot read ${file ?? 'stdin'}: ${e.message}\n`);
  process.exit(2);
}

try {
  if (json) {
    const model = parse(source);
    process.stdout.write(JSON.stringify(model, (k, v) => (k === 'index' ? undefined : v), 2) + '\n');
  } else if (api) {
    const model = parse(source);
    if (team) {
      if (!model.index[team]) { process.stderr.write(`unknown team "${team}"\n`); process.exit(1); }
      process.stdout.write(teamApi(model, team));
    } else {
      process.stdout.write(teamApis(model).map((t) => t.markdown).join('\n---\n\n'));
    }
  } else {
    process.stdout.write(render(source, { theme }) + '\n');
  }
} catch (e) {
  if (e instanceof ParseError) {
    process.stderr.write(`${file ?? 'stdin'}:${e.line}: ${e.detail}\n`);
    process.exit(1);
  }
  throw e;
}
