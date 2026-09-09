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
  assert.match(railLabel, /<rect[^>]*rx="4"[^>]*fill="#0f172a"/,
    'an opaque plate in the theme background sits behind the rail label, not the raw dot-pattern hatch');
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
