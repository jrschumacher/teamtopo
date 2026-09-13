import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, layout, render, wrapText, textWidth, ParseError, THEMES, textVerticalExtent } from './teamtopo.js';

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

test('unknown labelPos value throws a ParseError on that line', () => {
  const src = `teamTopology
    stream a
    stream b
    a --> b : x [labelPos=sideways]`;
  assert.throws(
    () => parse(src),
    (e) => e instanceof ParseError && /labelPos/.test(e.message) && e.line === 4,
  );
});

test('labelPos defaults to "gap" and accepts "above"', () => {
  const m = parse('teamTopology\nstream a\nstream b\na --> b : x');
  assert.equal(m.interactions[0].labelPos, 'gap');
  const m2 = parse('teamTopology\nstream a\nstream b\na --> b : x [labelPos=above]');
  assert.equal(m2.interactions[0].labelPos, 'above');
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

// ── platform-to-platform xaas: boundary marker (issue #27) ──

const BOUNDARY_SRC = `teamTopology
  platform infrastructure "Infrastructure"
  platform hosted "Hosted Product Platform"
  stream app1 "Consumer App 1"
  stream app2 "Consumer App 2"
  infrastructure --> hosted : hosted infrastructure
  hosted --> app1, app2 : platform capabilities`;

test('adjacent platform-to-platform xaas draws a boundary marker instead of a wedge', () => {
  const lay = layout(parse(BOUNDARY_SRC));
  const boundary = lay.edges.find((e) => e.inter.from === 'infrastructure' && e.inter.to === 'hosted');
  assert.ok(boundary, 'edge for infrastructure --> hosted exists');
  assert.equal(boundary.geo.kind, 'boundary');
  assert.equal(boundary.geo.marker.length, 3, 'chevron is a 3-point triangle');

  // the fan-out from `hosted` to two stream consumers is unaffected
  const fanout = lay.edges.filter((e) => e.inter.from === 'hosted');
  assert.equal(fanout.length, 1, 'fan-out stays one grouped edge');
  assert.equal(fanout[0].geo.kind, 'wedge');
  assert.equal(fanout[0].inters.length, 2);
});

test('model, parse output and Team API are unaffected by the boundary-marker rendering change', () => {
  const model = parse(BOUNDARY_SRC);
  const it = model.interactions.find((i) => i.from === 'infrastructure' && i.to === 'hosted');
  assert.deepEqual(
    { mode: it.mode, from: it.from, to: it.to, label: it.label },
    { mode: 'xaas', from: 'infrastructure', to: 'hosted', label: 'hosted infrastructure' },
  );
  const md = teamApi(BOUNDARY_SRC, 'hosted', { date: '2026-01-02' });
  assert.ok(md.includes('| Infrastructure | X-as-a-Service (we consume) | hosted infrastructure |'));
});

test('non-adjacent platform stack (something between provider and consumer) keeps the wedge', () => {
  const lay = layout(parse(`teamTopology
    platform top "Top"
    platform mid "Middle"
    platform bottom "Bottom"
    top --> bottom`));
  const [{ geo }] = lay.edges;
  assert.equal(geo.kind, 'wedge', 'top and bottom are not adjacent — mid sits between them');
});

test('labelled boundary marker: the label plate never overlaps either platform bar\'s rendered text', () => {
  const lay = layout(parse(`teamTopology
    platform infrastructure "Infrastructure Platform" [note="Kubernetes, CI, observability, logging"]
    platform hosted "Hosted Product Platform" [note="managed by the platform team"]
    stream app1 "Consumer App 1"
    infrastructure --> hosted : shared identity, secrets and network policy enforcement
    hosted --> app1`));
  const boundary = lay.edges.find((e) => e.inter.from === 'infrastructure' && e.inter.to === 'hosted');
  assert.equal(boundary.geo.kind, 'boundary');
  assert.ok(boundary.geo.label, 'a labelled interaction gets a label plate');
  const { plate } = boundary.geo.label;
  const plateTop = plate.y, plateBottom = plate.y + plate.h;

  const [, infraTextBottom] = textVerticalExtent(lay.boxes.infrastructure);
  const [hostedTextTop] = textVerticalExtent(lay.boxes.hosted);

  assert.ok(plateTop >= infraTextBottom - 0.01, `plate top (${plateTop}) overlaps infrastructure's text (bottom ${infraTextBottom})`);
  assert.ok(plateBottom <= hostedTextTop + 0.01, `plate bottom (${plateBottom}) overlaps hosted's text (top ${hostedTextTop})`);
});

test('boundary marker rendering is deterministic', () => {
  const svg1 = render(BOUNDARY_SRC);
  const svg2 = render(BOUNDARY_SRC);
  assert.equal(svg1, svg2);
});

test('no example other than org-groups.tt has a qualifying adjacent platform-to-platform xaas edge', () => {
  // examples/org-groups.tt has `infra --> saas` — two adjacent platform bars inside the
  // "cloud" platform group — which DOES qualify for the boundary-marker treatment (see the
  // dedicated assertion below). Every other shipped example has no platform-to-platform xaas
  // edge at all, so none of them can pick up a 'boundary' geo kind from this feature.
  const files = readdirSync(examplesDir).filter((f) => f.endsWith('.tt') && f !== 'org-groups.tt');
  for (const f of files) {
    const lay = layout(parse(readFileSync(join(examplesDir, f), 'utf8')));
    assert.ok(lay.edges.every((e) => e.geo.kind !== 'boundary'), `${f} should have no boundary-marker edges`);
  }
});

test('org-groups.tt: infra --> saas (adjacent platform bars) now renders as a boundary marker', () => {
  const lay = layout(parse(readFileSync(join(examplesDir, 'org-groups.tt'), 'utf8')));
  const boundary = lay.edges.find((e) => e.inter.from === 'infra' && e.inter.to === 'saas');
  assert.ok(boundary, 'infra --> saas edge exists');
  assert.equal(boundary.geo.kind, 'boundary', 'infra and saas are adjacent platform bars in the cloud group');
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
  assert.equal(e.kind, 'en', 'a leaf target inside a group keeps the column, not the rail, even across frames');
});

// ── enabling rail (issue #22) ──

test('a cross-cutting enabling team facilitating every sibling group renders as a shared rail', () => {
  const lay = layout(parse(`teamTopology
    group product {
      stream desktop
    }
    group services {
      stream policy
    }
    group platform2 {
      stream identity
    }
    enabling research
    research ~~> product
    research ~~> services
    research ~~> platform2`));
  const { product, services, platform2, research } = lay.boxes;
  assert.equal(research.kind, 'rail', 'gets the shared rail treatment, not a column');
  assert.equal(research.x, product.x, 'rail starts at the leftmost targeted frame');
  assert.equal(research.x + research.w, platform2.x + platform2.w, 'rail ends at the rightmost targeted frame');
  assert.ok(research.y >= Math.max(product.y + product.h, services.y + services.h, platform2.y + platform2.h),
    'rail is drawn below the frame band');
  assert.equal(lay.edges.filter((ed) => ed.inter.mode === 'facilitating').length, 0,
    'the rail itself carries the relationship; no separate per-pair patches or bands');
});

test('a rail spans leftmost-to-rightmost among a subset of targeted sibling frames', () => {
  const lay = layout(parse(`teamTopology
    group product {
      stream desktop
    }
    group services {
      stream policy
    }
    group platform2 {
      stream identity
    }
    enabling research
    research ~~> product
    research ~~> platform2`));
  const { product, services, platform2, research } = lay.boxes;
  assert.equal(research.kind, 'rail');
  assert.equal(research.x, product.x);
  assert.equal(research.x + research.w, platform2.x + platform2.w);
  assert.ok(research.x < services.x && research.x + research.w > services.x + services.w,
    'the untargeted frame in between is simply spanned, not excluded');
});

test('an enabling team targeting only one sibling frame keeps the column', () => {
  const lay = layout(parse(`teamTopology
    group a {
      stream x
    }
    group b {
      stream y
    }
    enabling e
    e ~~> a`));
  assert.equal(lay.boxes.e.kind, 'en');
});

test('two facilitating enabling teams stack as additional fixed-height rail rows', () => {
  const src = (extra) => `teamTopology
    group a {
      stream x
    }
    group b {
      stream y
    }
    enabling e1
    e1 ~~> a
    e1 ~~> b
    ${extra}`;
  const one = layout(parse(src('')));
  const two = layout(parse(src('enabling e2\ne2 ~~> a\ne2 ~~> b')));
  assert.equal(one.boxes.e1.kind, 'rail');
  assert.equal(two.boxes.e1.kind, 'rail');
  assert.equal(two.boxes.e2.kind, 'rail');
  assert.equal(two.boxes.e1.y, one.boxes.e1.y, 'the first rail row does not move when a second team is added');
  assert.ok(two.boxes.e2.y > two.boxes.e1.y, 'the second rail stacks below the first');
  const rowHeight = two.boxes.e2.y - two.boxes.e1.y;
  assert.equal(two.height - one.height, rowHeight, 'canvas height grows by exactly one fixed rail row for the second team');
});

test('a rail label that does not fit is ellipsised, never wraps, and never grows the rail height', () => {
  const shortSrc = `teamTopology
    group a {
      stream x
    }
    group b {
      stream y
    }
    enabling e
    e ~~> a
    e ~~> b`;
  const longSrc = `teamTopology
    group a {
      stream x
    }
    group b {
      stream y
    }
    enabling research "User Experience Research Insights and Behavioral Analytics Enablement Coaching Team for Product Organizations Worldwide"
    research ~~> a
    research ~~> b`;
  const fullLabel = 'User Experience Research Insights and Behavioral Analytics Enablement Coaching Team for Product Organizations Worldwide';
  const shortLay = layout(parse(shortSrc));
  const longLay = layout(parse(longSrc));
  const research = longLay.boxes.research;
  assert.equal(research.kind, 'rail');
  assert.equal(research.lines.length, 1, 'a rail label is always a single line');
  assert.ok(research.lines[0].endsWith('…'), 'a too-wide label is ellipsised');
  assert.notEqual(research.lines[0], fullLabel);
  assert.equal(research.h, shortLay.boxes.e.h, 'rail height is fixed regardless of label length');

  const svg = render(longSrc);
  assert.ok(svg.includes(fullLabel), 'the full name is kept in the title tooltip');
});

test('rail rendering is deterministic', () => {
  const src = `teamTopology
    group product {
      stream desktop
    }
    group services {
      stream policy
    }
    group platform2 {
      stream identity
    }
    enabling research
    research ~~> product
    research ~~> services
    research ~~> platform2`;
  assert.equal(render(src), render(src));
});

test('a rail label sits on an opaque plate over the facilitating dot pattern', () => {
  const src = `teamTopology
    group a {
      stream x
    }
    group b {
      stream y
    }
    enabling research
    research ~~> a
    research ~~> b`;
  const svg = render(src, { theme: 'dark' });
  const labelsGroup = svg.split('class="tt-overlay-labels"')[1];
  assert.ok(labelsGroup, 'overlay labels group present');
  const railLabel = labelsGroup.split('data-id="research"')[1];
  assert.match(railLabel, new RegExp(`<rect[^>]*rx="4"[^>]*fill="${THEMES.dark.enabling.plate}"`),
    'an opaque plate in the enabling tint sits behind the rail label, not the raw dot-pattern hatch');
  assert.ok(railLabel.indexOf('<rect') < railLabel.indexOf('<text'), 'the plate is drawn before (under) the label text');
});

test('ecommerce example renders byte-identical to the committed svg (in-lane facilitating is unaffected by the rail change)', () => {
  const svg = render(readFileSync(join(examplesDir, 'ecommerce.tt'), 'utf8'));
  const committed = readFileSync(join(examplesDir, 'ecommerce.svg'), 'utf8');
  assert.equal(`${svg}\n`, committed);
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

// ── #23: interaction label layout ──

const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Plate bbox for a wedge label, matching the geometry layout() computes. */
function plateBox(label) {
  assert.ok(Number.isFinite(label.plateW) && label.plateW > 0, 'label has a finite plate width');
  assert.ok(Number.isFinite(label.plateH) && label.plateH > 0, 'label has a finite plate height');
  return { x: label.x - label.plateW / 2, y: label.y - label.plateH / 2, w: label.plateW, h: label.plateH };
}

const ISSUE_23_REPRODUCER = `teamTopology
  title Interaction label layout in nested platform diagrams

  platform cloud "Cloud Platform" {
    group provider "Provider Group" {
      stream services "Platform Services"
    }

    group consumer "Product Group" {
      stream app "App"
    }

    provider --> consumer : platform capabilities
  }`;

test('wedge labels render on an opaque plate with wrapping metadata', () => {
  const lay = layout(parse('teamTopology\nstream a\nplatform p\np --> a : Kubernetes API'));
  const [{ geo }] = lay.edges;
  assert.equal(geo.kind, 'wedge');
  assert.ok(Array.isArray(geo.label.lines) && geo.label.lines.length >= 1);
  assert.ok(geo.label.plateW > 0 && geo.label.plateH > 0, 'plate has a size');
});

test('a long wedge label wraps onto multiple lines', () => {
  const lay = layout(parse(
    'teamTopology\nstream a\nplatform p\np --> a : a very long interaction label that will not fit on one line',
  ));
  const [{ geo }] = lay.edges;
  assert.ok(geo.label.lines.length > 1, 'wraps onto multiple lines');
});

test('#23 reproducer: the frame-to-frame label plate does not collide with either frame', () => {
  const lay = layout(parse(ISSUE_23_REPRODUCER));
  const wedge = lay.edges.find((e) => e.geo.kind === 'wedge');
  assert.ok(wedge, 'has a wedge edge');
  const plate = plateBox(wedge.geo.label);
  assert.ok(!overlaps(plate, lay.boxes.provider), 'plate does not overlap the provider frame');
  assert.ok(!overlaps(plate, lay.boxes.consumer), 'plate does not overlap the consumer frame');
});

// Bounding box of a frame's own rendered label, mirroring frameSVG(): an opaque
// patch on the bottom border, centred, wide enough for the text plus 8px each side.
function frameLabelBBox(box) {
  const tw = textWidth(box.node.label, 13) + 16;
  return { x: box.x + box.w / 2 - tw / 2, y: box.y + box.h - 10, w: tw, h: 20 };
}

test('#23 reproducer: the label plate rides the wedge and leaves its point showing', () => {
  const lay = layout(parse(ISSUE_23_REPRODUCER));
  const { geo } = lay.edges.find((e) => e.geo.kind === 'wedge');
  const plate = plateBox(geo.label);
  const base = geo.points[0].x, tip = geo.points[2].x;
  assert.ok(tip > base, 'the wedge points right, from provider to consumer');
  // on the wedge, not floating beside it: the plate straddles the wedge's axis
  assert.ok(plate.x > base && plate.x < tip, 'plate starts inside the wedge');
  assert.ok(plate.y < geo.points[0].y && plate.y + plate.h > geo.points[1].y, 'plate sits on the wedge axis');
  // and the point is still visible past it, so the wedge reads as directional
  assert.ok(tip - (plate.x + plate.w) >= 20, `point is visible past the plate (got ${tip - (plate.x + plate.w)})`);
  assert.ok(plate.x - base <= 12, 'plate rides the wide end rather than floating mid-gap');
});

test('#23 reproducer: the label plate clears every team label and every frame label', () => {
  const lay = layout(parse(ISSUE_23_REPRODUCER));
  const plate = plateBox(lay.edges.find((e) => e.geo.kind === 'wedge').geo.label);
  for (const id of ['services', 'app']) {
    assert.ok(!overlaps(plate, teamLabelBBox(lay.boxes[id])), `plate overlaps the ${id} team label`);
  }
  for (const id of ['cloud', 'provider', 'consumer']) {
    assert.ok(!overlaps(plate, frameLabelBBox(lay.boxes[id])), `plate overlaps the ${id} frame label`);
  }
});

test('#23 reproducer: a medium-length label stays on one line, and the gap grows to fit it', () => {
  const lay = layout(parse(ISSUE_23_REPRODUCER));
  const { geo } = lay.edges.find((e) => e.geo.kind === 'wedge');
  assert.deepEqual(geo.label.lines, ['platform capabilities'], 'not broken across lines');
  const gap = lay.boxes.consumer.x - (lay.boxes.provider.x + lay.boxes.provider.w);
  assert.ok(gap >= geo.label.plateW, `the frame gap (${gap}) fits the plate (${geo.label.plateW})`);
  assert.ok(gap <= 220, 'and stays within the cap on frame gap growth');
});

test('a label too long for the gap cap wraps tighter instead of eating the wedge point', () => {
  const lay = layout(parse(`teamTopology
    platform cloud {
      group provider {
        stream services
      }
      group consumer {
        stream app
      }
      provider --> consumer : policy decisions, key access and audit events for every tenant
    }`));
  const { geo } = lay.edges.find((e) => e.geo.kind === 'wedge');
  const plate = plateBox(geo.label);
  const base = geo.points[0].x, tip = geo.points[2].x;
  assert.ok(geo.label.lines.length > 1, 'a label this long wraps onto several lines');
  assert.ok(tip - base <= 220, `frame gap growth stays capped (got ${tip - base})`);
  assert.ok(tip - (plate.x + plate.w) >= 20, 'the point is still visible past the plate');
  assert.ok(!overlaps(plate, lay.boxes.provider) && !overlaps(plate, lay.boxes.consumer), 'plate clears both frames');
});

test('three sibling frames with labels on both gaps: no plate/frame overlaps', () => {
  const lay = layout(parse(`teamTopology
    platform cloud {
      group g1 {
        stream a
      }
      group g2 {
        stream b
      }
      group g3 {
        stream c
      }
      g1 --> g2 : platform capabilities
      g2 --> g3 : policy, key access and audit events
    }`));
  const wedges = lay.edges.filter((e) => e.geo.kind === 'wedge');
  assert.equal(wedges.length, 2);
  const frameBoxes = [lay.boxes.g1, lay.boxes.g2, lay.boxes.g3];
  for (const w of wedges) {
    const plate = plateBox(w.geo.label);
    for (const f of frameBoxes) assert.ok(!overlaps(plate, f), `plate for "${w.inter.label}" overlaps a frame`);
  }
});

test('labelPos=above positions the plate above both frames with a leader', () => {
  const lay = layout(parse(`teamTopology
    platform cloud {
      group provider {
        stream services
      }
      group consumer {
        stream app
      }
      provider --> consumer : platform capabilities [labelPos=above]
    }`));
  const wedge = lay.edges.find((e) => e.geo.kind === 'wedge');
  assert.ok(wedge.geo.leader, 'has a leader line');
  const topOfFrames = Math.min(lay.boxes.provider.y, lay.boxes.consumer.y);
  assert.ok(wedge.geo.label.y + wedge.geo.label.plateH / 2 <= topOfFrames, 'plate sits above both frames');
  const plate = plateBox(wedge.geo.label);
  assert.ok(!overlaps(plate, lay.boxes.provider) && !overlaps(plate, lay.boxes.consumer), 'plate clears both frames');
});

test('fan-out to multiple targets with the same label renders one wedge, one label', () => {
  const lay = layout(parse(`teamTopology
    stream m
    stream w
    platform cloud {
      stream k
    }
    k --> m, w : runtime`));
  const wedges = lay.edges.filter((e) => e.geo.kind === 'wedge' && e.inter.label === 'runtime');
  assert.equal(wedges.length, 1, 'one wedge for the fanned-out same-label interactions');
  assert.equal(wedges[0].inters.length, 2, 'covers both targets');
});

test('fan-out with different labels keeps separate plates', () => {
  const lay = layout(parse(`teamTopology
    stream m
    stream w
    platform cloud {
      stream k
    }
    k --> m : runtime
    k --> w : dashboards`));
  const wedges = lay.edges.filter((e) => e.geo.kind === 'wedge');
  assert.equal(wedges.length, 2, 'different labels stay on separate wedges');
  const plates = wedges.map((w) => plateBox(w.geo.label));
  assert.ok(!overlaps(plates[0], plates[1]), 'the two label plates do not overlap each other');
});

test('rendering is deterministic across repeated runs', () => {
  for (const src of [ISSUE_23_REPRODUCER, 'teamTopology\nstream m\nstream w\nplatform cloud {\nstream k\n}\nk --> m, w : runtime']) {
    const a = render(src);
    const b = render(src);
    assert.equal(a, b);
  }
});

test('every example renders byte-identical to its committed svg (run `npm run examples` after a layout change)', () => {
  const files = readdirSync(examplesDir).filter((f) => f.endsWith('.tt')).sort();
  for (const f of files) {
    const svg = render(readFileSync(join(examplesDir, f), 'utf8'));
    const committed = readFileSync(join(examplesDir, f.replace(/\.tt$/, '.svg')), 'utf8');
    assert.equal(`${svg}\n`, committed, f);
  }
});

test('every example .tt parses and renders without throwing', () => {
  const files = readdirSync(examplesDir).filter((f) => f.endsWith('.tt'));
  for (const f of files) {
    const src = readFileSync(join(examplesDir, f), 'utf8');
    assert.doesNotThrow(() => render(parse(src)), f);
  }
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

// ── team api ──

import { teamApi, teamApis } from './teamtopo.js';

const API_SRC = `teamTopology
  stream checkout "Checkout"
  stream search "Search"
  platform payments "Payments Platform" {
    stream ledger "Ledger"
  }
  enabling devex "DevEx"

  payments --> checkout : Payments API [duration="ongoing"]
  devex ~~> checkout : CI pipelines [duration="until Q3"]
  checkout <--> search : "search relevance [beta]" [soon, duration="6 weeks"]

  api checkout {
    focus: the checkout experience end to end
    Software owned and evolved by this team: checkout-service, cart-ui
    chat: #checkout #checkout-alerts
    working on: see https://wiki.example.com/checkout %% not a comment
  }`;

test('parses interaction attributes, quoted labels with brackets, and api blocks', () => {
  const m = parse(API_SRC);
  const collab = m.interactions.find((i) => i.mode === 'collaboration');
  assert.equal(collab.label, 'search relevance [beta]');
  assert.equal(collab.soon, true);
  assert.equal(collab.duration, '6 weeks');
  assert.equal(m.interactions[0].duration, 'ongoing');
  assert.equal(m.interactions[0].soon, false);
  assert.deepEqual(m.index.checkout.api, {
    focus: 'the checkout experience end to end',
    softwareownedandevolvedbythisteam: 'checkout-service, cart-ui',
    chat: '#checkout #checkout-alerts',
    workingon: 'see https://wiki.example.com/checkout',
  });
  assert.equal(m.index.search.api, null);
});

test('api block errors', () => {
  assert.throws(() => parse('teamTopology\nstream a\napi b {\n}'), /unknown team "b"/);
  assert.throws(() => parse('teamTopology\nstream a\napi a {\nno colon here'), /expected "field: value"/);
  assert.throws(() => parse('teamTopology\nstream a\napi a {\nfocus: x'), /never closed/);
});

test('teamApi fills the template from the diagram and the api block', () => {
  const md = teamApi(API_SRC, 'checkout', { date: '2026-01-02' });
  assert.ok(md.startsWith('# Team API: Checkout\n\nDate: 2026-01-02\n'));
  assert.ok(md.includes('* Team name and focus: Checkout — the checkout experience end to end'));
  assert.ok(md.includes('* Team type: Stream-Aligned'));
  assert.ok(md.includes('* Part of a Platform? (y/n) Details: n'));
  assert.ok(md.includes('* Do we provide a service to other teams? (y/n) Details: n'));
  assert.ok(md.includes('* Software owned and evolved by this team: checkout-service, cart-ui'));
  assert.ok(md.includes('* Versioning approaches:\n'), 'unknown fields stay blank');
  assert.ok(md.includes('| Payments Platform | X-as-a-Service (we consume) | Payments API | ongoing |'));
  assert.ok(md.includes('| DevEx | Facilitating (they facilitate us) | CI pipelines | until Q3 |'));
  const soonSection = md.split('### Teams we expect to interact with soon')[1];
  assert.ok(soonSection.includes('| Search | Collaboration | search relevance [beta] | 6 weeks |'));
  assert.ok(!md.split('### Teams we expect to interact with soon')[0].includes('| Search |'), 'soon rows are not in the current table');

  const ledger = teamApi(API_SRC, 'ledger', { date: '2026-01-02' });
  assert.ok(ledger.includes('* Part of a Platform? (y/n) Details: y — part of Payments Platform'));
  const payments = teamApi(API_SRC, 'payments', { date: '2026-01-02' });
  assert.ok(payments.includes('* Team type: Platform'));
  assert.ok(payments.includes('* Do we provide a service to other teams? (y/n) Details: y — to Checkout (Payments API)'));
  assert.ok(payments.includes('| Checkout / the checkout experience end to end | X-as-a-Service (we provide) | Payments API | ongoing |'));
});

test('teamApis covers every team except groups', () => {
  const docs = teamApis('teamTopology\ngroup g {\nstream a\n}\nplatform p');
  assert.deepEqual(docs.map((d) => d.id), ['a', 'p']);
  assert.throws(() => teamApi('teamTopology\nstream a', 'zzz'), /unknown team/);
});

test('interactions expected soon render dashed and faded', () => {
  const svg = render('teamTopology\nstream a\nplatform p\np --> a [soon]');
  assert.ok(/<polygon[^>]*stroke-dasharray="5 4"[^>]*opacity="0.55"|<polygon[^>]*opacity="0.55"[^>]*stroke-dasharray="5 4"/.test(svg));
});

// ── #28: labels for every interaction mode (plates, mode colour, labelPos) ──

// WCAG relative luminance / contrast ratio — implemented here only; no new dependency.
function parseColor(c) {
  c = c.trim();
  let m;
  if ((m = /^#([0-9a-f]{6})$/i.exec(c))) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  if ((m = /^rgba?\(([^)]+)\)$/i.exec(c))) {
    const parts = m[1].split(',').map((s) => parseFloat(s));
    return [parts[0], parts[1], parts[2], parts[3] !== undefined ? parts[3] : 1];
  }
  throw new Error(`unrecognised color "${c}"`);
}
function blendOverBg(fg, bg) {
  const [r1, g1, b1, a1] = parseColor(fg);
  const [r2, g2, b2] = parseColor(bg);
  return [r1 * a1 + r2 * (1 - a1), g1 * a1 + g2 * (1 - a1), b1 * a1 + b2 * (1 - a1)];
}
function relLuminance([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrastRatio(colorA, colorB) {
  const L1 = relLuminance(colorA), L2 = relLuminance(colorB);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

test('WCAG contrast: mode plate colours are legible and visible in both themes', () => {
  for (const [themeName, T] of Object.entries(THEMES)) {
    for (const mode of ['collab', 'xaas', 'facil', 'enabling']) {
      assert.ok(T[mode].plate, `${themeName}/${mode} has a plate token`);
      const plateRGB = parseColor(T[mode].plate).slice(0, 3);
      const bgRGB = parseColor(T.bg).slice(0, 3);
      const textRGB = parseColor(T[mode].text).slice(0, 3);
      const textContrast = contrastRatio(textRGB, plateRGB);
      const bgContrast = contrastRatio(plateRGB, bgRGB);
      assert.ok(textContrast >= 4.5, `${themeName}/${mode} text-on-plate contrast ${textContrast.toFixed(2)} >= 4.5`);
      assert.ok(bgContrast >= 1.5, `${themeName}/${mode} plate-vs-bg contrast ${bgContrast.toFixed(2)} >= 1.5`);
    }
  }
});

test('WCAG contrast: collaboration text on the parallelogram fill itself (labelPos=gap draws directly on the shape)', () => {
  for (const [themeName, T] of Object.entries(THEMES)) {
    const textRGB = parseColor(T.collab.text).slice(0, 3);
    const bgRGB = parseColor(T.bg).slice(0, 3);
    const fillOnBg = blendOverBg(T.collab.fill, T.bg);
    const contrastOnBg = contrastRatio(textRGB, fillOnBg);
    assert.ok(contrastOnBg >= 4.5, `${themeName} collab text-on-fill (over bg) ${contrastOnBg.toFixed(2)} >= 4.5`);
    // the parallelogram usually sits over a stream lane, not bare bg
    const streamOverBg = blendOverBg(T.stream.fill, T.bg);
    const fillOnStream = blendOverBg(T.collab.fill, `rgb(${streamOverBg.map(Math.round).join(',')})`);
    const contrastOnStream = contrastRatio(textRGB, fillOnStream);
    assert.ok(contrastOnStream >= 4.5, `${themeName} collab text-on-fill (over stream lane) ${contrastOnStream.toFixed(2)} >= 4.5`);
  }
});

test('collaboration labels (labelPos=gap) wrap and draw directly on the parallelogram fill, no inner plate', () => {
  const lay = layout(parse(
    'teamTopology\nstream a\nstream b\na <--> b : a very long collaboration label that will not fit on one line',
  ));
  const [{ geo }] = lay.edges;
  assert.equal(geo.kind, 'bridge');
  assert.ok(geo.label.lines.length > 1, 'wraps onto multiple lines');
  assert.equal(geo.label.onShape, true, 'label is drawn on the shape fill, not a plate');
  assert.equal(geo.label.plateW, undefined, 'no inner plate rect for labelPos=gap');
});

test('facilitating patch labels wrap and render on a plate', () => {
  const lay = layout(parse(
    'teamTopology\nstream a\nenabling e\ne ~~> a : a very long facilitating label that will not fit on one line',
  ));
  const patch = lay.edges.find((e) => e.geo.kind === 'patch');
  assert.ok(patch, 'has a patch edge');
  assert.ok(patch.geo.label.lines.length > 1, 'wraps onto multiple lines');
  assert.ok(patch.geo.label.plateW > 0 && patch.geo.label.plateH > 0, 'plate has a size');
});

test('facilitating band labels wrap and render on a plate', () => {
  const lay = layout(parse(`teamTopology
    group g1 {
      stream a
    }
    enabling e
    e ~~> a : a very long facilitating label that will not fit on one line`));
  const band = lay.edges.find((e) => e.geo.kind === 'band');
  assert.ok(band, 'has a band edge');
  assert.ok(band.geo.label.lines.length > 1, 'wraps onto multiple lines');
  assert.ok(band.geo.label.plateW > 0 && band.geo.label.plateH > 0, 'plate has a size');
});

test('labelPos=above works for collaboration and facilitating, with a leader', () => {
  const collab = layout(parse('teamTopology\nstream a\nstream b\na <--> b : pairing [labelPos=above]'));
  const [{ geo: collabGeo }] = collab.edges;
  assert.ok(collabGeo.leader, 'collaboration above has a leader');
  const shapeTop = Math.min(...collabGeo.points.map((p) => p.y));
  assert.ok(collabGeo.label.y + collabGeo.label.plateH / 2 <= shapeTop, 'plate sits above the shape');

  const facil = layout(parse('teamTopology\nstream a\nenabling e\ne ~~> a : coaching [labelPos=above]'));
  const patch = facil.edges.find((e) => e.geo.kind === 'patch');
  assert.ok(patch.geo.leader, 'facilitating above has a leader');
  assert.ok(patch.geo.label.y + patch.geo.label.plateH / 2 <= patch.geo.rect.y, 'plate sits above the patch');
});

test('unknown labelPos is a ParseError for non-xaas modes too', () => {
  assert.throws(
    () => parse('teamTopology\nstream a\nstream b\na <--> b : x [labelPos=weird]'),
    (e) => e instanceof ParseError && /labelPos/.test(e.message),
  );
});

test('frame gap growth stays xaas-only: a labelled collaboration between sibling frames does not widen the gap', () => {
  const withCollab = layout(parse(`teamTopology
    group g1 {
      stream a
    }
    group g2 {
      stream b
    }
    g1 <--> g2 : a moderately long collaboration label`));
  const plain = layout(parse(`teamTopology
    group g1 {
      stream a
    }
    group g2 {
      stream b
    }`));
  assert.equal(withCollab.boxes.g2.x - (withCollab.boxes.g1.x + withCollab.boxes.g1.w),
    plain.boxes.g2.x - (plain.boxes.g1.x + plain.boxes.g1.w),
    'gap between the frames is unchanged by a labelled collaboration edge');
});

// ── owner feedback on PR #28: enabling-label plate, on-shape collab text, subsystem overlap ──

test('a rotated enabling label renders on an opaque plate in the enabling tint', () => {
  const src = 'teamTopology\nstream a\nenabling superlong "SuperLongEnablingTeamName"\nsuperlong ~~> a';
  const light = render(src, { theme: 'light' });
  const dark = render(src, { theme: 'dark' });
  assert.ok(light.includes(`fill="${THEMES.light.enabling.plate}"`), 'light enabling plate colour present');
  assert.ok(dark.includes(`fill="${THEMES.dark.enabling.plate}"`), 'dark enabling plate colour present');
});

test('an upright enabling label gets the same plate as the rotated one', () => {
  // "UX Research" wraps to two short lines and so is drawn upright inside the bar,
  // over the dots of the facilitating patches crossing it (examples/org-groups.tt)
  const src = 'teamTopology\nstream a\nstream b\nenabling ux "UX Research"\nux ~~> a, b';
  const lay = layout(parse(src));
  assert.equal(lay.boxes.ux.rotate, false, 'the label fits across the bar');
  for (const theme of ['light', 'dark']) {
    // the bar's shape and its label are drawn in separate passes; the label lands in
    // the overlay group, above the facilitating dots
    const svg = render(src, { theme });
    const bar = svg.split('class="tt-overlay-labels"')[1].split('data-id="ux"')[1];
    const plate = new RegExp(`<rect[^>]*fill="${THEMES[theme].enabling.plate}"`);
    assert.match(bar, plate, `${theme}: upright bar label sits on an enabling-tinted plate`);
    assert.ok(bar.search(plate) < bar.indexOf('<text'), `${theme}: the plate is drawn under the label text`);
  }
});

test('a collaboration bridge to a sibling frame slides clear of the enabling bar label it grows over', () => {
  const lay = layout(parse(readFileSync(join(examplesDir, 'org-groups.tt'), 'utf8')));
  const bridges = lay.edges.filter((e) => e.geo.kind === 'bridge');
  assert.ok(bridges.length >= 2, 'org-groups has bridges from enabling bars to sibling groups');
  for (const { inter, geo } of bridges) {
    const shape = geoBBox(geo);
    for (const id of [inter.from, inter.to]) {
      const box = lay.boxes[id];
      if (box.kind !== 'en') continue;
      assert.ok(!overlaps(shape, teamLabelBBox(box)), `bridge ${inter.from}<->${inter.to} covers the ${id} bar label`);
      // and it still bridges: the shape stays within the bar it starts from
      assert.ok(shape.y >= box.y && shape.y + shape.h <= box.y + box.h, 'the shape stays alongside the bar');
    }
  }
});

// Approximates the bounding box of a team's own rendered label text, from layout()
// output fields only (kind, rotate, lines, fs, labelZone, note, x/y/w/h) — mirrors
// teamSVG's textBlock/rotate placement closely enough to catch real overlaps.
function teamLabelBBox(box) {
  if (!box.node) return null;
  if (box.kind === 'frame') return frameLabelBBox(box);
  if (box.kind === 'en' && box.rotate) {
    const fs = box.fs + 1;
    const tw = textWidth(box.node.label, fs) + 12;
    const th = fs + 6;
    return { x: box.x + box.w / 2 - th / 2, y: box.y + box.h / 2 - tw / 2, w: th, h: tw };
  }
  const lines = box.lines && box.lines.length ? box.lines : [box.node.label];
  const lh = box.fs * 1.25;
  const textH = lines.length * lh;
  const textW = Math.max(...lines.map((ln) => textWidth(ln, box.fs)));
  const cx = box.labelZone ? (box.labelZone[0] + box.labelZone[1]) / 2 : box.x + box.w / 2;
  const noteH = box.note && box.note.length ? 11 * 1.25 + 2 : 0;
  const cy = box.y + box.h / 2 - noteH / 2;
  const pad = 4;
  return { x: cx - textW / 2 - pad, y: cy - textH / 2 - pad, w: textW + pad * 2, h: textH + pad * 2 };
}

function geoBBox(geo) {
  if (geo.rect) return geo.rect;
  const xs = geo.points.map((p) => p.x), ys = geo.points.map((p) => p.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

test('an interaction shape never covers a team label (examples/ecommerce.tt and a subsystem+collaboration fixture)', () => {
  const cases = [
    ['examples/ecommerce.tt', readFileSync(join(examplesDir, 'ecommerce.tt'), 'utf8')],
    ['examples/group-interactions.tt', readFileSync(join(examplesDir, 'group-interactions.tt'), 'utf8')],
    ['subsystem fixture', `teamTopology
      stream search "Search & Discovery"
      subsystem ranking "Ranking Engine" [note="ML relevance model"]
      ranking --> search : Ranking API
      search <--> ranking : new signals`],
  ];
  for (const [name, src] of cases) {
    const lay = layout(parse(src));
    // An enabling bar's own label sitting under the facilitating patch that crosses
    // the bar is a deliberate, separately-tested exception (#28 gives every bar
    // label its own opaque plate drawn above the dots, rotated or upright, rather
    // than moving the patch away from it).
    const labelBoxes = Object.values(lay.boxes)
      .filter((b) => b.kind !== 'en')
      .map(teamLabelBBox).filter(Boolean);
    for (const { geo } of lay.edges) {
      const gbox = geoBBox(geo);
      for (const lbox of labelBoxes) {
        assert.ok(!overlaps(gbox, lbox), `${name}: an interaction shape overlaps a team label`);
      }
    }
  }
});
