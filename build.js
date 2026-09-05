#!/usr/bin/env node
/**
 * build.js
 *
 *   node build.js                      → public/index.html (playground) + public/teamtopo.js
 *   node build.js --examples           → also renders examples/*.tt to examples/*.svg
 *   node build.js --artifact out.html  → also writes the playground as a head-less fragment
 *
 * The playground inlines the library so the deployed page is a single file.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, parse } from './src/teamtopo.js';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const artifactPath = args.includes('--artifact') ? args[args.indexOf('--artifact') + 1] : null;

const lib = readFileSync(join(here, 'src/teamtopo.js'), 'utf8');
const template = readFileSync(join(here, 'src/playground.html'), 'utf8');

const examples = readdirSync(join(here, 'examples')).filter((f) => f.endsWith('.tt')).sort()
  .map((f) => {
    const source = readFileSync(join(here, 'examples', f), 'utf8');
    const name = basename(f, '.tt');
    const model = parse(source);
    return { name, title: model.title || name, source };
  });
// keep the richest example first so the page opens on something worth looking at
examples.sort((a, b) => (a.name === 'org-groups' ? -1 : b.name === 'org-groups' ? 1 : a.name.localeCompare(b.name)));

const page = template
  .replace('/*LIB*/', () => lib)
  .replace('/*EXAMPLES*/[]', () => JSON.stringify(examples).replace(/<\//g, '<\\/'));

mkdirSync(join(here, 'public'), { recursive: true });
const [head, body] = page.split('<!--BODY-->');
writeFileSync(join(here, 'public/index.html'),
  `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${head}</head>\n<body>${body}</body>\n</html>\n`);
writeFileSync(join(here, 'public/teamtopo.js'), lib);
console.log('wrote public/index.html, public/teamtopo.js');

if (artifactPath) {
  writeFileSync(artifactPath, page.replace('<!--BODY-->', ''));
  console.log(`wrote ${artifactPath}`);
}

if (args.includes('--examples')) {
  for (const ex of examples) {
    writeFileSync(join(here, 'examples', `${ex.name}.svg`), render(ex.source) + '\n');
    console.log(`rendered examples/${ex.name}.svg`);
  }
}
