import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, layout, render, wrapText, ParseError } from './teamtopo.js';

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(here, '..', 'examples');

// ── parser ──

test('parses team declarations with quoted, unquoted and default labels', () => {
  const m = parse(`
    teamTopology
      stream checkout "Checkout"
      platform infra Infrastructure Platform
      enabling devex
  `);
  assert.deepEqual(m.teams.map((t) => [t.id, t.type, t.label]), [
    ['checkout', 'stream', 'Checkout'],
    ['infra', 'platform', 'Infrastructure Platform'],
    ['devex', 'enabling', 'devex'],
  ]);
});

test('accepts type aliases', () => {
  const m = parse(`teamTopology
    stream-aligned a
    sa b
    complicated-subsystem c
    cs d
    pf e
    en f`);
  assert.deepEqual(m.teams.map((t) => t.type), ['stream', 'stream', 'subsystem', 'subsystem', 'platform', 'enabling']);
});

test('parses attributes', () => {
  const m = parse(`teamTopology
    stream a "A" [size=7, note="on call weekly", lead=Sam]`);
  assert.deepEqual(m.index.a.attrs, { size: '7', note: 'on call weekly', lead: 'Sam' });
});

test('maps operators to interaction modes and roles', () => {
  const m = parse(`teamTopology
    stream a
    stream b
    platform p
    enabling e
    p --> a : api
    a <-- p
    a <--> b
    b <-> a
    e ~~> a
    a <~~ e`);
  assert.deepEqual(m.interactions.map((i) => [i.mode, i.from, i.to, i.label]), [
    ['xaas', 'p', 'a', 'api'],
    ['xaas', 'p', 'a', ''],
    ['collaboration', 'a', 'b', ''],
    ['collaboration', 'b', 'a', ''],
    ['facilitating', 'e', 'a', ''],
    ['facilitating', 'e', 'a', ''],
  ]);
});

test('expands comma lists on both sides of an interaction', () => {
  const m = parse(`teamTopology
    stream a
    stream b
    platform p
    platform q
    p, q --> a, b : shared`);
  assert.equal(m.interactions.length, 4);
  assert.deepEqual(m.interactions.map((i) => `${i.from}>${i.to}`), ['p>a', 'p>b', 'q>a', 'q>b']);
  assert.ok(m.interactions.every((i) => i.label === 'shared'));
});

test('nests teams inside platform and group blocks', () => {
  const m = parse(`teamTopology
    platform cloud "Cloud" {
      stream k8s
      group inner {
        stream deep
      }
    }
    stream app
    k8s --> app`);
  assert.deepEqual(m.nodes.map((n) => n.id), ['cloud', 'app']);
  assert.deepEqual(m.index.cloud.children.map((n) => n.id), ['k8s', 'inner']);
  assert.equal(m.index.deep.parent, 'inner');
});

test('strips %% and // comments outside quotes', () => {
  const m = parse(`teamTopology  %% header comment
    // full line comment
    stream a "50% done // really" %% trailing
    title Ops // not a comment? yes it is`);
  assert.equal(m.index.a.label, '50% done // really');
  assert.equal(m.title, 'Ops');
});

test('directives: title, flow, legend', () => {
  const m = parse(`teamTopology
    title "Our org"
    flow
    legend
    stream a`);
  assert.equal(m.title, 'Our org');
  assert.equal(m.flow, 'Flow of change');
  assert.equal(m.legend, true);
  assert.equal(parse('teamTopology\nflow Value stream\nstream a').flow, 'Value stream');
});

test('reports errors with line numbers', () => {
  const cases = [
    ['stream a', /must start with "teamTopology"/, 1],
    ['teamTopology\nstream a\nstream a', /duplicate identifier "a"/, 3],
    ['teamTopology\nstream a\na --> b', /unknown team "b"/, 3],
    ['teamTopology\nstream a\na --> a', /cannot interact with itself/, 3],
    ['teamTopology\nplatform p {\nstream a\n}\np --> a', /nested/, 5],
    ['teamTopology\nstream a {\n}', /only "platform" and "group"/, 2],
    ['teamTopology\nplatform p {\nstream a', /never closed/, 3],
    ['teamTopology\n}', /unexpected "}"/, 2],
    ['teamTopology\nwhatever is this', /cannot understand/, 2],
    ['teamTopology\nstream', /needs an identifier/, 2],
  ];
  for (const [src, re, line] of cases) {
    assert.throws(() => parse(src), (e) => e instanceof ParseError && re.test(e.message) && e.line === line, src);
  }
});

// ── layout ──

test('stacks lanes in declaration order with platforms beneath', () => {
  const lay = layout(parse(`teamTopology
    stream a
    stream b
    platform p
    p --> a`));
  const { a, b, p } = lay.boxes;
  assert.ok(a.y + a.h <= b.y && b.y + b.h < p.y);
  assert.equal(a.w, b.w, 'lanes span the full width');
  assert.equal(a.w, p.w, 'platform bars span the full width');
});

test('embeds a subsystem on the first lane it serves', () => {
  const lay = layout(parse(`teamTopology
    stream a
    stream b
    subsystem s
    s --> b, a`));
  const { s, b } = lay.boxes;
  assert.ok(s.y < b.y && s.y + s.h > b.y, 'octagon straddles the top edge of lane b');
  assert.equal(lay.edges.filter((e) => e.inter.mode === 'xaas').length, 1, 'the embedding is the relationship, only the other consumer gets a wedge');
});

test('enabling bar spans and crosses the lanes it facilitates', () => {
  const lay = layout(parse(`teamTopology
    stream a
    stream b
    stream c
    stream d
    enabling e
    e ~~> b, c`));
  const { a, b, c, d, e } = lay.boxes;
  assert.ok(e.y <= b.y && e.y + e.h >= c.y + c.h);
  assert.ok(e.y > a.y + a.h - 20 && e.y + e.h < d.y + 20, 'does not reach the lanes it does not facilitate');
  assert.ok(e.x + e.w <= b.x + b.w && e.x >= b.x, 'bar sits inside the lane width');
  const patches = lay.edges.filter((ed) => ed.geo.kind === 'patch');
  assert.equal(patches.length, 2, 'one dotted patch per crossed lane');
});

test('XaaS is a wedge with its base on the provider and its point on the consumer', () => {
  const lay = layout(parse(`teamTopology
    stream a
    platform p
    p --> a`));
  const [{ geo }] = lay.edges;
  assert.equal(geo.kind, 'wedge');
  const [b1, b2, apex] = geo.points;
  assert.equal(b1.y, lay.boxes.p.y, 'base on the platform top edge');
  assert.equal(b2.y, lay.boxes.p.y);
  assert.equal(apex.y, lay.boxes.a.y, 'point reaches the far edge of the lane so the wedge covers it');
  assert.equal(geo.label.text, 'XaaS');
});

test('a fan-out from one provider is a single wedge spanning every consumer', () => {
  const lay = layout(parse(`teamTopology
    stream a
    stream b
    stream c
    platform p
    p --> a, c : api`));
  const wedges = lay.edges.filter((e) => e.geo.kind === 'wedge');
  assert.equal(wedges.length, 1);
  const [{ geo, inters }] = wedges;
  assert.equal(inters.length, 2);
  assert.equal(geo.points[2].y, lay.boxes.a.y, 'point reaches the top of the farthest consumer');
  assert.ok(Math.abs(geo.points[1].x - geo.points[0].x) > 64, 'base widens to cover more teams');
  // wedges with different labels stay separate
  const lay2 = layout(parse('teamTopology\nstream a\nstream b\nplatform p\np --> a : one\np --> b : two'));
  assert.equal(lay2.edges.length, 2);
});

test('wedges between frames are spread apart', () => {
  const lay = layout(parse(`teamTopology
    stream m
    stream w
    platform cloud {
      stream k
      stream o
    }
    k --> m, w
    o --> m, w`));
  const xs = lay.edges.map((e) => e.geo.points[2].x);
  assert.equal(new Set(xs).size, 4, 'four wedges, four columns');
});

test('root-level overlays get their own column beside a band of frames', () => {
  const lay = layout(parse(`teamTopology
    group g1 {
      stream a
    }
    group g2 {
      stream b
    }
    enabling e
    e ~~> a, b`));
  const { g1, g2, e } = lay.boxes;
  assert.ok(e.x >= g1.x + g1.w && e.x >= g2.x + g2.w, 'bar is to the right of both frames');
  assert.equal(lay.edges.filter((ed) => ed.geo.kind === 'band').length, 2, 'facilitating drawn as dotted bands when the bar cannot cross');
});

test('collaboration is a parallelogram bridging the two teams', () => {
  const lay = layout(parse(`teamTopology
    stream a
    stream b
    a <--> b : pairing`));
  const [{ geo }] = lay.edges;
  assert.equal(geo.kind, 'bridge');
  assert.equal(geo.points.length, 4);
  assert.equal(geo.label.text, 'pairing');
  const ys = geo.points.map((p) => p.y);
  assert.ok(Math.min(...ys) < lay.boxes.a.y + lay.boxes.a.h && Math.max(...ys) > lay.boxes.b.y, 'overlaps both lanes');
});

test('wraps long labels', () => {
  assert.deepEqual(wrapText('Developer Experience Enablement', 90, 12), ['Developer', 'Experience', 'Enablement']);
  assert.deepEqual(wrapText('short', 90, 12), ['short']);
});

// ── renderer ──

test('renders svg with one element per team and interaction', () => {
  const svg = render(`teamTopology
    title T
    legend
    stream a "A & B"
    platform p
    p --> a : <api>`);
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.equal((svg.match(/class="tt-node /g) || []).length, 2);
  assert.equal((svg.match(/class="tt-edge tt-xaas"/g) || []).length, 1);
  assert.ok(svg.includes('A &amp; B'), 'escapes labels');
  assert.ok(svg.includes('&lt;api&gt;'), 'escapes interaction labels');
  assert.ok(svg.includes('class="tt-legend"'));
});

test('themes and id prefixes are applied', () => {
  const src = 'teamTopology\nstream a\nenabling b\nb ~~> a';
  const light = render(src), dark = render(src, { theme: 'dark', idPrefix: 'x1' });
  assert.ok(light.includes('#ffffff') && !dark.includes('#ffffff'));
  assert.ok(dark.includes('url(#x1-dots)'));
});

test('every example renders', () => {
  const files = readdirSync(examplesDir).filter((f) => f.endsWith('.tt'));
  assert.ok(files.length >= 3);
  for (const f of files) {
    const svg = render(readFileSync(join(examplesDir, f), 'utf8'));
    assert.ok(svg.length > 500, f);
  }
});
