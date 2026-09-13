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
      stream a2
    }
    group g2 {
      stream b
    }
    enabling e
    e ~~> a, a2`));
  const { g1, g2, e } = lay.boxes;
  assert.ok(e.x >= g1.x + g1.w && e.x >= g2.x + g2.w, 'bar is to the right of both frames');
  assert.equal(lay.edges.filter((ed) => ed.geo.kind === 'band').length, 2, 'facilitating drawn as dotted bands when the bar cannot cross');
  assert.equal(e.kind, 'en', 'targets inside a single frame keep the column, not the rail');
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

// ── rails that reach into specific teams: lane markers (issue #37) ──

const LEAVES_SRC = `teamTopology
  group alpha "Alpha" {
    stream web "Web"
    stream mobile "Mobile"
  }
  group beta "Beta" {
    stream portal "Partner Portal"
    stream api_gw "API Gateway"
  }
  group gamma "Gamma" {
    stream ops "Ops Console"
  }
  enabling coaching "Platform Coaching"
  coaching ~~> web
  coaching ~~> portal
  coaching ~~> ops`;

const SHARED_SUB_SRC = `teamTopology
  group growth "Growth" {
    stream acquisition "Acquisition"
    stream retention "Retention"
  }
  group commerce "Commerce" {
    stream checkout "Checkout"
    stream catalog "Catalog"
  }
  group support "Support" {
    stream helpdesk "Helpdesk"
    stream community "Community"
  }
  subsystem analytics "Analytics Engine"
  analytics --> acquisition : event API
  analytics --> checkout : event API
  analytics --> helpdesk : event API`;

test('an enabling team facilitating one team in each sibling group gets a rail under the groups', () => {
  const lay = layout(parse(LEAVES_SRC));
  const { alpha, beta, gamma, coaching } = lay.boxes;
  assert.equal(coaching.kind, 'rail', 'a rail, not a column of bands across the lanes');
  assert.equal(coaching.x, alpha.x, 'rail starts at the leftmost group holding a target');
  assert.equal(coaching.x + coaching.w, gamma.x + gamma.w, 'rail ends at the rightmost group holding a target');
  assert.ok(coaching.y >= Math.max(alpha.y + alpha.h, beta.y + beta.h, gamma.y + gamma.h), 'rail sits below the frame band');
  assert.equal(lay.edges.filter((e) => e.geo.kind === 'band' || e.geo.kind === 'patch').length, 0,
    'nothing is painted across the lanes any more');
  assert.equal(lay.edges.filter((e) => e.geo.kind === 'marker').length, 3, 'one marker per targeted team');
});

test('only the targeted teams carry a marker, and it stays clear of their labels', () => {
  const lay = layout(parse(LEAVES_SRC));
  const marks = new Map(lay.edges.filter((e) => e.geo.kind === 'marker').map((e) => [e.inter.to, e.geo]));
  assert.deepEqual([...marks.keys()].sort(), ['ops', 'portal', 'web']);
  for (const id of ['mobile', 'api_gw']) assert.ok(!marks.has(id), `${id} is untargeted, so it carries no marker`);
  for (const [id, geo] of marks) {
    const lane = lay.boxes[id];
    const [, textBottom] = textVerticalExtent(lane);
    assert.ok(geo.rect.y > textBottom, `the ${id} marker sits below the lane label, never across it`);
    assert.ok(geo.rect.y >= lane.y + lane.h - 6, 'the marker is a tab on the lane bottom edge');
    assert.ok(geo.rect.x >= lane.x && geo.rect.x + geo.rect.w <= lane.x + lane.w, 'the tab stays within its lane');
    assert.ok(geo.rect.w <= lane.w / 3, 'a tab, not a band across the lane');
  }
});

test('lane-targeting rails stack as fixed rows, one per enabling team', () => {
  const one = layout(parse(LEAVES_SRC));
  const two = layout(parse(`${LEAVES_SRC}
  enabling sec "Security"
  sec ~~> mobile
  sec ~~> api_gw`));
  assert.equal(two.boxes.sec.kind, 'rail');
  assert.equal(two.boxes.coaching.y, one.boxes.coaching.y, 'the first rail row does not move when a second team is added');
  assert.ok(two.boxes.sec.y > two.boxes.coaching.y, 'the second rail stacks below the first');
  assert.equal(two.boxes.sec.h, two.boxes.coaching.h, 'rail height is fixed');
  assert.equal(two.height - one.height, two.boxes.sec.y - two.boxes.coaching.y,
    'canvas height grows by exactly one fixed rail row for the second team');
});

test('two rails reaching the same team put their tabs side by side', () => {
  const lay = layout(parse(`${LEAVES_SRC}
  enabling sec "Security"
  sec ~~> web
  sec ~~> portal`));
  const on = lay.edges.filter((e) => e.geo.kind === 'marker' && e.inter.to === 'web').map((e) => e.geo.rect);
  assert.equal(on.length, 2);
  const [a, b] = on.sort((p, q) => p.x - q.x);
  assert.ok(a.x + a.w <= b.x, 'the two tabs do not overlap');
  assert.equal(a.y, b.y, 'both sit on the same edge');
});

test('a rail only marks the relationship it carries; other modes keep their own shape', () => {
  const lay = layout(parse(`${LEAVES_SRC}
  coaching <--> mobile : design system`));
  const collab = lay.edges.find((e) => e.inter.mode === 'collaboration');
  assert.equal(collab.geo.kind, 'bridge', 'a collaboration with the railed team is still a parallelogram');
  assert.equal(lay.edges.filter((e) => e.geo.kind === 'marker' && e.inter.to === 'mobile').length, 0);
});

test('a rail mixing a whole group with a team inside another marks only the team', () => {
  const lay = layout(parse(`teamTopology
    group alpha "Alpha" {
      stream web "Web"
      stream mobile "Mobile"
    }
    group beta "Beta" {
      stream portal "Partner Portal"
    }
    enabling coaching "Coaching"
    coaching ~~> alpha
    coaching ~~> portal`));
  const { alpha, beta, coaching } = lay.boxes;
  assert.equal(coaching.kind, 'rail');
  assert.equal(coaching.x, alpha.x);
  assert.equal(coaching.x + coaching.w, beta.x + beta.w, 'the rail spans both groups it reaches into');
  const markers = lay.edges.filter((e) => e.geo.kind === 'marker');
  assert.deepEqual(markers.map((e) => e.inter.to), ['portal'], 'the whole-group target needs no marker; the named team gets one');
});

test('a subsystem consumed by teams in several sibling groups gets the same rail and markers', () => {
  const lay = layout(parse(SHARED_SUB_SRC));
  const { growth, support, analytics } = lay.boxes;
  assert.equal(analytics.kind, 'rail', 'not a floating octagon in the overlay column');
  assert.equal(analytics.x, growth.x);
  assert.equal(analytics.x + analytics.w, support.x + support.w);
  assert.equal(lay.edges.filter((e) => e.geo.kind === 'wedge').length, 0, 'no loose wedges across frame boundaries');
  const markers = lay.edges.filter((e) => e.geo.kind === 'marker');
  assert.deepEqual(markers.map((e) => e.inter.to).sort(), ['acquisition', 'checkout', 'helpdesk']);
  assert.ok(markers.every((e) => e.inter.mode === 'xaas'), 'the markers carry the X-as-a-Service relationship');
  assert.ok(markers.every((e) => e.geo.label?.text === 'event API'), 'an interaction label rides beside its tab when it fits');
});

test('a subsystem rail does not move with the order of its own lines', () => {
  const reordered = SHARED_SUB_SRC.replace(
    'analytics --> acquisition : event API\n  analytics --> checkout : event API\n  analytics --> helpdesk : event API',
    'analytics --> helpdesk : event API\n  analytics --> checkout : event API\n  analytics --> acquisition : event API');
  const a = layout(parse(SHARED_SUB_SRC)).boxes.analytics;
  const b = layout(parse(reordered)).boxes.analytics;
  assert.deepEqual([a.x, a.y, a.w, a.h], [b.x, b.y, b.w, b.h]);
});

test('a subsystem serving teams inside one group keeps the embedded octagon', () => {
  const lay = layout(parse(`teamTopology
    group growth {
      stream acquisition
      stream retention
    }
    group commerce {
      stream checkout
    }
    subsystem analytics
    analytics --> acquisition
    analytics --> retention`));
  assert.equal(lay.boxes.analytics.kind, 'sub');
  assert.equal(lay.boxes.analytics.embeddedOn, 'acquisition');
});

test('a facilitating marker is a dotted tab in the enabling idiom, an xaas marker the service grey', () => {
  const facil = render(LEAVES_SRC).split('class="tt-edge tt-facilitating"')[1].split('</g>')[0];
  assert.match(facil, /url\(#tt-dots\)/, 'the facilitating hatch');
  assert.match(facil, /stroke-dasharray="2 3"/, 'dotted outline');
  assert.match(facil, /stroke="#6B4FA8"/, 'in the facilitating colour');
  const xaas = render(SHARED_SUB_SRC).split('class="tt-edge tt-xaas"')[1].split('</g>')[0];
  assert.ok(!xaas.includes('tt-dots'), 'a consumed-subsystem marker is not drawn in the facilitating hatch');
  assert.ok(xaas.includes('event API'), 'its label is drawn beside the tab');
});

test('a subsystem rail keeps the subsystem shape and colour, an enabling rail the hatch', () => {
  const sub = render(SHARED_SUB_SRC).split('data-id="analytics"')[1];
  assert.match(sub, /<path[^>]*fill="#F6C79B"/, 'the subsystem octagon, flattened into a rail');
  const en = render(LEAVES_SRC).split('class="tt-overlays"')[1].split('data-id="coaching"')[1];
  assert.match(en, /<rect[^>]*fill="url\(#tt-dots\)"/, 'the enabling rail keeps the facilitating hatch');
});

test('enabling-groups example renders byte-identical to the committed svg (whole-group facilitation is unchanged)', () => {
  const svg = render(readFileSync(join(examplesDir, 'enabling-groups.tt'), 'utf8'));
  const committed = readFileSync(join(examplesDir, 'enabling-groups.svg'), 'utf8');
  assert.equal(`${svg}\n`, committed);
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

// ── backward-compatibility corpus ──

test('every example renders byte-identically to its committed svg', () => {
  const files = readdirSync(examplesDir).filter((f) => f.endsWith('.tt')).sort();
  assert.ok(files.length >= 3);
  for (const f of files) {
    const source = readFileSync(join(examplesDir, f), 'utf8');
    const expected = readFileSync(join(examplesDir, f.replace(/\.tt$/, '.svg')), 'utf8');
    assert.equal(render(source) + '\n', expected, f);
  }
});

test('teamApis markdown is stable for every example', () => {
  const golden = JSON.parse(readFileSync(join(here, 'teamtopo.api.golden.json'), 'utf8'));
  const files = readdirSync(examplesDir).filter((f) => f.endsWith('.tt')).sort();
  assert.deepEqual(files, Object.keys(golden));
  for (const f of files) {
    const actual = teamApis(readFileSync(join(examplesDir, f), 'utf8'), { date: '2026-01-01' })
      .map((t) => `${t.id}\n${t.markdown}`).join('\n---\n');
    assert.equal(actual, golden[f], f);
  }
});

// ── team identity ──

const TEAM_SRC = `teamTopology
  stream desktop "Desktop"
  stream sharepoint "SharePoint Proxy"
  subsystem crypto "Crypto"
  team alpha "Alpha"
  alpha owns desktop, sharepoint
  api alpha {
    focus: endpoint protection
  }`;

test('declares teams and resolves ownership', () => {
  const m = parse(TEAM_SRC);
  assert.equal(m.orgTeams.length, 1);
  const alpha = m.orgTeams[0];
  assert.equal(alpha.isTeam, true);
  assert.equal(alpha.label, 'Alpha');
  assert.deepEqual(alpha.owns, ['desktop', 'sharepoint']);
  assert.deepEqual(alpha.load, { streams: 2, subsystems: 0, nodes: 2 });
  assert.deepEqual(m.index.desktop.owners, ['alpha']);
  assert.deepEqual(m.index.crypto.owners, []);
  assert.equal(m.index.alpha.api.focus, 'endpoint protection');
  assert.deepEqual(m.diagnostics.length >= 0, true);
});

test('owns accumulates across lines, deduped, and counts only streams', () => {
  const m = parse(`teamTopology
    stream desktop "Desktop"
    subsystem crypto "Crypto"
    team alpha "Alpha"
    alpha owns desktop
    alpha owns crypto, desktop`);
  assert.deepEqual(m.orgTeams[0].owns, ['desktop', 'crypto']);
  assert.deepEqual(m.orgTeams[0].load, { streams: 1, subsystems: 1, nodes: 2 });
  assert.equal(m.orgTeams[0].ownsLine, 6);
});

test('a placeholder team with no owns line is valid', () => {
  const m = parse('teamTopology\nteam alpha "Alpha"');
  assert.deepEqual(m.orgTeams[0].owns, []);
  assert.deepEqual(m.orgTeams[0].load, { streams: 0, subsystems: 0, nodes: 0 });
});

test('owns is matched before the node keywords and only for non-keyword ids', () => {
  for (const id of ['sales', 'engineering', 'platform_core']) {
    const m = parse(`teamTopology\nstream x "X"\nteam ${id} "T"\n${id} owns x`);
    assert.deepEqual(m.orgTeams[0].owns, ['x'], id);
  }
  const m = parse('teamTopology\nstream owns "Owns"');
  assert.equal(m.index.owns.type, 'stream');
  assert.equal(m.orgTeams.length, 0);
});

test('team and owns keywords are case-insensitive', () => {
  const m = parse('teamTopology\nstream x "X"\nTEAM alpha "Alpha"\nalpha OWNS x');
  assert.deepEqual(m.orgTeams[0].owns, ['x']);
});

test('team identity errors', () => {
  const cases = [
    ['teamTopology\nstream x\nteam x "X"', /duplicate identifier "x"/, 3],
    ['teamTopology\nteam a "A"\nteam a "A2"', /duplicate identifier "a"/, 3],
    ['teamTopology\nstream x\na owns x', /"a" is not a team/, 3],
    ['teamTopology\nteam a "A"\na owns nope', /owns names an unknown team "nope"/, 3],
    ['teamTopology\ngroup g {\nstream x\n}\nteam a "A"\na owns g', /"g" is a container/, 6],
    ['teamTopology\nstream x\nteam a "A"\na owns x\napi x {\n  focus: f\n}',
      /api x belongs to team a, which owns x; move these fields into "api a"/, 5],
    ['teamTopology\nstream x\nteam a "A"\na owns x\na --> x', /"a" is a team, not a node; use one of the nodes it owns \(x\)/, 5],
  ];
  for (const [src, re, line] of cases) {
    assert.throws(() => parse(src), (e) => e instanceof ParseError && re.test(e.message) && e.line === line, src);
  }
});

test('an unclosed apiFields block is a parse error', () => {
  assert.throws(() => parse('teamTopology\napiFields {\n  focus'), (e) => e instanceof ParseError && /apiFields block is never closed/.test(e.message));
});

test('apiFields is parsed into the model and otherwise unused', () => {
  const m = parse(`teamTopology
  apiFields {
    focus
    tier: gold | silver | bronze

    wiki
  }
  stream x "X"`);
  assert.deepEqual(m.apiFields, [
    { key: 'focus', choices: [], group: 0 },
    { key: 'tier', choices: ['gold', 'silver', 'bronze'], group: 0 },
    { key: 'wiki', choices: [], group: 1 },
  ]);
});

// ── diagnostics ──

test('a multi-stream team warns once, on its last owns line, with the final count', () => {
  const m = parse(`teamTopology
    stream desktop "Desktop"
    stream sharepoint "SharePoint"
    stream web "Web"
    team alpha "Alpha"
    alpha owns desktop
    alpha owns sharepoint
    alpha owns web`);
  assert.equal(m.diagnostics.length, 1);
  const d = m.diagnostics[0];
  assert.equal(d.level, 'warning');
  assert.equal(d.code, 'team-multi-stream');
  assert.equal(d.line, 8);
  assert.equal(d.message,
    'team alpha is aligned to 3 streams: desktop, sharepoint, web; a team aligned to more than one stream carries extra cognitive load');
});

test('one stream, or a stream plus a subsystem, does not warn', () => {
  const one = parse('teamTopology\nstream x\nteam a "A"\na owns x');
  assert.deepEqual(one.diagnostics, []);
  const mixed = parse('teamTopology\nstream x\nsubsystem y\nteam a "A"\na owns x, y');
  assert.deepEqual(mixed.diagnostics, []);
  assert.deepEqual(mixed.orgTeams[0].load, { streams: 1, subsystems: 1, nodes: 2 });
});

test('a team owning several complicated subsystems warns the same way', () => {
  const m = parse(`teamTopology
    subsystem pricing "Pricing"
    subsystem billing "Billing"
    stream web "Web"
    team alpha "Alpha"
    alpha owns pricing
    alpha owns billing, web`);
  assert.deepEqual(m.orgTeams[0].load, { streams: 1, subsystems: 2, nodes: 3 });
  assert.deepEqual(m.diagnostics.map((d) => d.code), ['team-multi-subsystem']);
  const d = m.diagnostics[0];
  assert.equal(d.level, 'warning');
  assert.equal(d.line, 7);
  assert.equal(d.message,
    'team alpha owns 2 complicated subsystems: pricing, billing; each carries its own deep specialism, so one team owning several carries extra cognitive load');
});

test('one subsystem does not warn, and both rules can fire for one team', () => {
  assert.deepEqual(parse('teamTopology\nsubsystem y\nteam a "A"\na owns y').diagnostics, []);
  const both = parse(`teamTopology
    stream w "W"
    stream x "X"
    subsystem y "Y"
    subsystem z "Z"
    team a "A"
    a owns w, x, y, z`);
  assert.deepEqual(both.diagnostics.map((d) => d.code), ['team-multi-stream', 'team-multi-subsystem']);
});

test('the team document counts subsystems and adds their split-candidate note', () => {
  const md = teamApi(`teamTopology
    subsystem pricing "Pricing"
    subsystem billing "Billing"
    team a "A"
    a owns pricing, billing`, 'a', { date: '2026-01-01' });
  assert.match(md, /^\* Streams: 0$/m);
  assert.match(md, /^\* Subsystems: 2$/m);
  assert.match(md, /each one's deep specialism; the subsystems above are split candidates/);
  // a team with no subsystem keeps the document it had
  const plain = teamApi('teamTopology\nstream x "X"\nteam a "A"\na owns x', 'a', { date: '2026-01-01' });
  assert.ok(!/Subsystems:/.test(plain));
});

test('the legend shows a subsystem load riding alongside the stream count', () => {
  const svg = render(`teamTopology
    stream w "W"
    subsystem y "Y"
    subsystem z "Z"
    team a "A"
    a owns w, y, z`);
  assert.match(svg, />A \(1 stream, 2 subsystems\)</);
});

test('diagnostics is always an array and never throws', () => {
  assert.deepEqual(parse('teamTopology\nstream x').diagnostics, []);
  assert.deepEqual(parse('teamTopology').diagnostics, []);
});

// ── team api bound to a team ──

const OWNED_SRC = `teamTopology
  stream desktop "Desktop"
  stream sharepoint "SharePoint Proxy"
  platform infra "Infra"
  stream gateway "Gateway"
  team alpha "Alpha"
  team bravo "Bravo"
  alpha owns desktop, sharepoint
  bravo owns gateway
  desktop <--> sharepoint : shared installer
  infra --> desktop : CI
  infra --> sharepoint : CI
  gateway <--> desktop : token exchange
  api alpha {
    focus: endpoint protection
  }
  api bravo {
    focus: north-south traffic
  }`;

test('teamApis emits one document per team plus one per unowned node', () => {
  const ids = teamApis(OWNED_SRC, { date: '2026-01-01' }).map((t) => t.id);
  assert.deepEqual(ids, ['alpha', 'bravo', 'infra']);
});

test('teamApi resolves an owned node id to its owning team', () => {
  const model = parse(OWNED_SRC);
  assert.equal(teamApi(model, 'desktop', { date: '2026-01-01' }), teamApi(model, 'alpha', { date: '2026-01-01' }));
});

test('the team document lists ownership, the stream count and the load note', () => {
  const md = teamApi(OWNED_SRC, 'alpha', { date: '2026-01-01' });
  assert.match(md, /^# Team API: Alpha$/m);
  assert.match(md, /^\* Team type: Stream-Aligned$/m);
  assert.match(md, /^\* Owns 2: desktop \(stream-aligned\), sharepoint \(stream-aligned\)$/m);
  assert.match(md, /^\* Streams: 2$/m);
  assert.match(md, /cognitive load of all of them; the streams above are split candidates/);
});

test('a single-node team pluralises Owns and omits the load note', () => {
  const md = teamApi(OWNED_SRC, 'bravo', { date: '2026-01-01' });
  assert.match(md, /^\* Owns 1: gateway \(stream-aligned\)$/m);
  assert.match(md, /^\* Streams: 1$/m);
  assert.ok(!/split candidates/.test(md));
});

test('an interaction inside one team is Internal, and rows resolve to the owning team', () => {
  const md = teamApi(OWNED_SRC, 'alpha', { date: '2026-01-01' });
  const internal = md.slice(md.indexOf('### Internal'));
  assert.match(internal, /shared installer/);
  const current = md.slice(md.indexOf('### Teams we currently interact with'), md.indexOf('### Internal'));
  assert.ok(!/shared installer/.test(current));
  // gateway is owned by Bravo, so the row names Bravo and Bravo's focus
  assert.match(current, /\| Bravo \/ north-south traffic \|/);
  // two owned nodes consuming the same service from Infra collapse to one row
  assert.equal(current.split('\n').filter((l) => l.includes('| Infra |')).length, 1);
});

test('an unowned node reports an owned counterpart as its owning team', () => {
  const md = teamApi(OWNED_SRC, 'infra', { date: '2026-01-01' });
  assert.match(md, /\| Alpha \/ endpoint protection \|/);
  assert.ok(!/\| Desktop \|/.test(md));
});

test('a team owning a stream and a subsystem unions both type names', () => {
  const md = teamApi(`teamTopology
    stream x "X"
    subsystem y "Y"
    team a "A"
    a owns x, y`, 'a', { date: '2026-01-01' });
  assert.match(md, /^\* Team type: Stream-Aligned, Complicated Subsystem$/m);
});

test('a placeholder team gets a document with no platform line', () => {
  const md = teamApi('teamTopology\nteam a "A"', 'a', { date: '2026-01-01' });
  assert.match(md, /^\* Team type: Team$/m);
  assert.match(md, /^\* Owns 0: $/m);
  assert.ok(!/Part of a Platform/.test(md));
});

test('the platform line appears only when every owned node is in the same platform', () => {
  const same = teamApi(`teamTopology
    platform p "P" {
      stream a "A"
      stream b "B"
    }
    team t "T"
    t owns a, b`, 't', { date: '2026-01-01' });
  assert.match(same, /Part of a Platform\? \(y\/n\) Details: y — part of P/);
  const split = teamApi(`teamTopology
    platform p "P" {
      stream a "A"
    }
    stream b "B"
    team t "T"
    t owns a, b`, 't', { date: '2026-01-01' });
  assert.ok(!/Part of a Platform/.test(split));
});

// ── team chips and legend ──

const CHIP_SRC = `teamTopology
  stream desktop "Desktop"
  stream sharepoint "SharePoint"
  stream gateway "Gateway"
  team alpha "Alpha"
  team bravo "Bravo"
  alpha owns desktop, sharepoint
  bravo owns gateway, desktop`;

test('a team-free diagram gets no chips and no team legend', () => {
  const svg = render('teamTopology\nstream a "A"');
  assert.ok(!svg.includes('tt-chips'));
  assert.ok(!svg.includes('tt-team-legend'));
});

test('each owned node gets a chip and the legend names every team once', () => {
  const svg = render(CHIP_SRC);
  assert.equal((svg.match(/class="tt-chips"/g) || []).length, 3);
  assert.equal((svg.match(/class="tt-team-legend"/g) || []).length, 1);
  assert.equal((svg.match(/>Alpha \(2 streams\)</g) || []).length, 1);
  assert.equal((svg.match(/>Bravo \(2 streams\)</g) || []).length, 1);
});

test('chip colours are deterministic across renders', () => {
  assert.equal(render(CHIP_SRC), render(CHIP_SRC));
});

test('a node owned by two teams carries two chips', () => {
  const svg = render(CHIP_SRC);
  const from = svg.indexOf('data-id="desktop"');
  const next = svg.indexOf('data-id=', from + 10);
  const desktop = svg.slice(from, next === -1 ? undefined : next);
  assert.equal((desktop.match(/class="tt-chip"/g) || []).length, 2);
});

test('more than three owners collapse to three chips and a +N', () => {
  const src = ['teamTopology', 'stream x "X"',
    ...['a', 'b', 'c', 'd'].map((t) => `team ${t} "T${t}"`),
    ...['a', 'b', 'c', 'd'].map((t) => `${t} owns x`)].join('\n');
  const svg = render(src);
  assert.equal((svg.match(/class="tt-chip"/g) || []).length, 3);
  assert.match(svg, />\+1</);
});

test('past twenty teams the chip layer is suppressed with a note', () => {
  const ids = Array.from({ length: 21 }, (_, i) => `t${i}`);
  const src = ['teamTopology', ...ids.map((t) => `stream s${t} "S"`),
    ...ids.map((t) => `team ${t} "T"`), ...ids.map((t) => `${t} owns s${t}`)].join('\n');
  const svg = render(src);
  assert.ok(!svg.includes('class="tt-chip"'));
  assert.match(svg, /21 teams — ownership shown in the Team APIs/);
});

test('the team legend is independent of the type legend', () => {
  const withTeams = render(CHIP_SRC, { legend: false });
  assert.ok(withTeams.includes('tt-team-legend'));
  assert.ok(!withTeams.includes('class="tt-legend"'));
  const both = render(`${CHIP_SRC}\n  legend`);
  assert.ok(both.includes('tt-team-legend') && both.includes('class="tt-legend"'));
});

test('a team owning no stream shows its node count in the legend', () => {
  const svg = render('teamTopology\nsubsystem y "Y"\nteam a "A"\na owns y');
  assert.match(svg, />A \(1 subsystem\)</);
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

test('label-driven frame gap growth stays xaas-only: a collaboration label does not widen the gap past the crossed-boundary minimum', () => {
  const withLabel = layout(parse(`teamTopology
    group g1 {
      stream a
    }
    group g2 {
      stream b
    }
    g1 <--> g2 : a moderately long collaboration label`));
  const bare = layout(parse(`teamTopology
    group g1 {
      stream a
    }
    group g2 {
      stream b
    }
    g1 <--> g2`));
  // both cross the boundary, so both get the #39 minimum; only an xaas label buys more
  assert.equal(withLabel.boxes.g2.x - (withLabel.boxes.g1.x + withLabel.boxes.g1.w),
    bare.boxes.g2.x - (bare.boxes.g1.x + bare.boxes.g1.w),
    'gap between the frames is unchanged by a labelled collaboration edge');
});

// ── #39: a crossed sibling-group boundary gets a comfortable minimum gap ──

const gapBetween = (lay, a, b) => lay.boxes[b].x - (lay.boxes[a].x + lay.boxes[a].w);

// The alignment-vs-flow shape from the shape gallery (docs/shapes/alignment-vs-flow.tt on
// spike/shape-gallery): a lane in one tribe flows into a lane in the sibling tribe, so the
// wedge has only the gap between the two frames to live in.
const ISSUE_39_REPRODUCER = `teamTopology
  title Reporting lines vs flow direction disagree

  group platform_tribe "Platform Tribe" {
    stream identity "Identity"
    stream mobile_shell "Mobile Shell (reports to Platform)"
  }

  group growth_tribe "Growth Tribe" {
    stream onboarding "Onboarding"
  }

  identity --> mobile_shell
  mobile_shell --> onboarding : flow continues`;

test('#39 reproducer: a wedge from a lane to a lane in the sibling group gets the crossed-boundary minimum', () => {
  const lay = layout(parse(ISSUE_39_REPRODUCER));
  assert.ok(gapBetween(lay, 'platform_tribe', 'growth_tribe') >= 64,
    `crossed boundary is at least 64px (got ${gapBetween(lay, 'platform_tribe', 'growth_tribe')})`);
});

test('#39: an unlabelled crossing widens the gap just as a labelled one does', () => {
  const src = (edge) => `teamTopology
    group g1 {
      stream a
    }
    group g2 {
      stream b
    }
    ${edge}`;
  for (const edge of ['a --> b', 'a --> b : shared runtime', 'a --> b [labelPos=above]',
    'g1 --> g2', 'a <--> b', 'a ~~> b']) {
    const lay = layout(parse(src(edge)));
    assert.ok(gapBetween(lay, 'g1', 'g2') >= 64, `"${edge}" widens the boundary it crosses (got ${gapBetween(lay, 'g1', 'g2')})`);
  }
});

test('#39: an uncrossed boundary keeps the flat 32px sideGap', () => {
  // interactions inside each group, and from a team outside both, cross no boundary
  const lay = layout(parse(`teamTopology
    group g1 {
      stream a
      stream a2
      a --> a2
    }
    group g2 {
      stream b
    }
    platform core
    core --> a, b`));
  assert.equal(gapBetween(lay, 'g1', 'g2'), 32);
});

test('#39: the minimum applies to the boundary an interaction ends at, not the ones it flies over', () => {
  const lay = layout(parse(`teamTopology
    group g1 {
      stream a
    }
    group g2 {
      stream b
    }
    group g3 {
      stream c
    }
    a --> c`));
  assert.equal(gapBetween(lay, 'g1', 'g2'), 32, 'g1|g2 is only flown over');
  assert.equal(gapBetween(lay, 'g2', 'g3'), 32, 'g2|g3 is only flown over');
});

test('#39: a label that needs more room than the minimum still gets it, and the cap still holds', () => {
  const wide = layout(parse(`teamTopology
    group g1 {
      stream a
    }
    group g2 {
      stream b
    }
    g1 --> g2 : policy decisions, key access and audit events for every tenant`));
  const gap = gapBetween(wide, 'g1', 'g2');
  assert.ok(gap > 64, `a wrapped label still buys more than the minimum (got ${gap})`);
  assert.ok(gap <= 220, 'and frame gap growth stays capped');
});

test('#39: nested sibling frames get the same treatment as top-level ones', () => {
  const lay = layout(parse(`teamTopology
    group outer {
      group g1 {
        stream a
      }
      group g2 {
        stream b
      }
      a --> b
    }`));
  assert.ok(gapBetween(lay, 'g1', 'g2') >= 64,
    `crossed boundary inside a frame widens too (got ${gapBetween(lay, 'g1', 'g2')})`);
});

test('#39: ecommerce and enabling-groups have no crossed boundary, so neither moves', () => {
  for (const f of ['ecommerce.tt', 'enabling-groups.tt']) {
    const lay = layout(parse(readFileSync(join(examplesDir, f), 'utf8')));
    const frames = Object.values(lay.boxes).filter((b) => b.kind === 'frame');
    const band = frames.filter((b) => Math.abs(b.y - frames[0].y) < 1).sort((a, b) => a.x - b.x);
    for (let i = 0; i < band.length - 1; i++) {
      assert.equal(band[i + 1].x - (band[i].x + band[i].w), 32, `${f}: ${band[i].node.id}|${band[i + 1].node.id}`);
    }
  }
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
