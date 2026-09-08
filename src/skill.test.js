import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from './teamtopo.js';

const here = dirname(fileURLToPath(import.meta.url));
const skillDir = join(here, '..', 'skills', 'teamtopo');

// every ```tt fenced block in the skill's Markdown, in document order
function ttBlocks(markdown) {
  const blocks = [];
  const re = /^```tt[^\n]*\n([\s\S]*?)^```/gm;
  let m;
  while ((m = re.exec(markdown))) blocks.push(m[1]);
  return blocks;
}

test('every ```tt snippet in skills/teamtopo parses', () => {
  const files = readdirSync(skillDir, { recursive: true }).filter((f) => f.endsWith('.md')).sort();
  assert.ok(files.length > 0, 'no Markdown files under skills/teamtopo');
  let count = 0;
  for (const file of files) {
    ttBlocks(readFileSync(join(skillDir, file), 'utf8')).forEach((source, i) => {
      count++;
      try {
        parse(source);
      } catch (e) {
        assert.fail(`${file} block #${i + 1}: ${e.message}\n${source}`);
      }
    });
  }
  assert.ok(count > 0, 'no ```tt blocks found');
});

test('ttBlocks extracts only tt fences', () => {
  const md = '```tt\nteamTopology\n```\n\n```\nnot tt\n```\n\n```diff\n-x\n```\n';
  assert.deepEqual(ttBlocks(md), ['teamTopology\n']);
});
