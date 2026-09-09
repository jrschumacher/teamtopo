/**
 * teamtopo.js — a Mermaid-like text syntax and SVG renderer for
 * Team Topologies diagrams (team types + interaction modes).
 *
 * Zero dependencies. Runs in Node and in the browser.
 *
 *   import { parse, layout, render } from './teamtopo.js';
 *   const svg = render(`
 *     teamTopology
 *       stream checkout "Checkout"
 *       platform infra "Infrastructure"
 *       infra --> checkout : Kubernetes
 *   `);
 */

export const VERSION = '0.1.0';

// ───────────────────────── Vocabulary ─────────────────────────

export const TEAM_TYPES = {
  stream:    { name: 'Stream-aligned team',        rank: 0 },
  enabling:  { name: 'Enabling team',              rank: 0 },
  subsystem: { name: 'Complicated-subsystem team', rank: 1 },
  platform:  { name: 'Platform team',              rank: 2 },
  group:     { name: 'Group',                      rank: null },
};

const TYPE_ALIASES = {
  stream: 'stream', 'stream-aligned': 'stream', sa: 'stream',
  enabling: 'enabling', en: 'enabling',
  subsystem: 'subsystem', 'complicated-subsystem': 'subsystem', cs: 'subsystem',
  platform: 'platform', pf: 'platform',
  group: 'group',
};

export const MODES = {
  collaboration: { name: 'Collaboration' },
  xaas:          { name: 'X-as-a-Service' },
  facilitating:  { name: 'Facilitating' },
};

// operator → mode, and whether the left side is the "from" role
// (provider for X-as-a-Service, facilitator for Facilitating).
const OPERATORS = {
  '<-->': { mode: 'collaboration', leftIsFrom: true },
  '<->':  { mode: 'collaboration', leftIsFrom: true },
  '-->':  { mode: 'xaas',          leftIsFrom: true },
  '<--':  { mode: 'xaas',          leftIsFrom: false },
  '~~>':  { mode: 'facilitating',  leftIsFrom: true },
  '<~~':  { mode: 'facilitating',  leftIsFrom: false },
};

// ───────────────────────── Parser ─────────────────────────

export class ParseError extends Error {
  constructor(detail, line) {
    super(`Line ${line}: ${detail}`);
    this.name = 'ParseError';
    this.detail = detail;
    this.line = line;
  }
}

const ID = '[A-Za-z_][A-Za-z0-9_.]*';
const RE_HEADER = /^teamtopology\s*$/i;
const RE_NODE = new RegExp(
  `^(stream-aligned|stream|sa|enabling|en|complicated-subsystem|subsystem|cs|platform|pf|group)(?:\\s+(${ID}))?(.*)$`, 'i');
const RE_QUOTED = /^\s*"((?:[^"\\]|\\.)*)"/;
const RE_ATTRS = /^\s*\[([^\]]*)\]/;
const RE_ATTR_PAIR = /([A-Za-z_][\w-]*)(?:\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^,\s\]]+)))?/g;
const RE_INTERACTION = new RegExp(
  `^(${ID}(?:\\s*,\\s*${ID})*)\\s*(<-->|<->|-->|<--|~~>|<~~)\\s*(${ID}(?:\\s*,\\s*${ID})*)\\s*(?::\\s*("(?:[^"\\\\]|\\\\.)*"|[^\\[]*?))?\\s*(?:\\[([^\\]]*)\\])?\\s*$`);
const RE_API_OPEN = new RegExp(`^api\\s+(${ID})\\s*\\{$`, 'i');
const RE_API_FIELD = /^([^:]+?)\s*:\s*(.*)$/;

function stripComment(line, slashes = true) {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i - 1] !== '\\') inQuote = !inQuote;
    else if (!inQuote && ((c === '%' && line[i + 1] === '%') || (slashes && c === '/' && line[i + 1] === '/'))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function unescape(s) {
  return s.replace(/\\(.)/g, '$1');
}

function parseAttrs(src) {
  const attrs = {};
  for (const m of src.matchAll(RE_ATTR_PAIR)) {
    attrs[m[1]] = m[2] !== undefined ? unescape(m[2]) : (m[3] ?? 'true');
  }
  return attrs;
}

/**
 * Parse diagram source into a model:
 * {
 *   title, flow, legend,
 *   nodes:        top-level node tree (each node: id, type, label, attrs, api, children, parent, line)
 *   teams:        flat list of every node (containers included), declaration order
 *   interactions: [{ mode, from, to, label, attrs, soon, duration, line }]
 *   index:        id → node
 * }
 * For `xaas`, `from` is the provider and `to` the consumer.
 * For `facilitating`, `from` is the facilitator.
 */
export function parse(source) {
  if (typeof source !== 'string') throw new TypeError('parse() expects a string');
  const model = { title: '', flow: null, legend: false, nodes: [], teams: [], interactions: [], index: {} };
  const stack = [];   // open containers
  const apis = [];    // { id, fields, line }
  let api = null;     // open api block
  let sawHeader = false;

  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    // inside an api block only %% starts a comment, so URLs survive
    const line = stripComment(lines[i], !api).trim();
    if (!line) continue;

    if (api) {
      if (line === '}') { api = null; continue; }
      const fm = RE_API_FIELD.exec(line);
      if (!fm) throw new ParseError(`expected "field: value" inside the api block for "${api.id}"`, lineNo);
      api.fields[apiKey(fm[1])] = stripQuotes(fm[2]);
      continue;
    }

    if (!sawHeader) {
      if (!RE_HEADER.test(line)) throw new ParseError('diagram must start with "teamTopology"', lineNo);
      sawHeader = true;
      continue;
    }

    // directives
    let m;
    if ((m = /^title\s+(.+)$/i.exec(line))) { model.title = stripQuotes(m[1]); continue; }
    if ((m = /^flow(?:\s+(.+))?$/i.exec(line))) { model.flow = m[1] ? stripQuotes(m[1]) : 'Flow of change'; continue; }
    if (/^legend$/i.test(line)) { model.legend = true; continue; }

    if (line === '}') {
      if (!stack.length) throw new ParseError('unexpected "}" — no open block', lineNo);
      stack.pop();
      continue;
    }

    // team api block
    if ((m = RE_API_OPEN.exec(line))) {
      api = { id: m[1], fields: {}, line: lineNo };
      apis.push(api);
      continue;
    }

    // interaction
    if ((m = RE_INTERACTION.exec(line))) {
      const left = m[1].split(',').map((s) => s.trim());
      const op = OPERATORS[m[2]];
      const right = m[3].split(',').map((s) => s.trim());
      const label = m[4] ? stripQuotes(m[4]) : '';
      const attrs = m[5] ? parseAttrs(m[5]) : {};
      const soon = 'soon' in attrs || 'expected' in attrs;
      if (attrs.labelPos !== undefined && attrs.labelPos !== 'gap' && attrs.labelPos !== 'above') {
        throw new ParseError(`invalid labelPos "${attrs.labelPos}" (expected "gap" or "above")`, lineNo);
      }
      const labelPos = attrs.labelPos || 'gap';
      for (const l of left) {
        for (const r of right) {
          const [from, to] = op.leftIsFrom ? [l, r] : [r, l];
          model.interactions.push({ mode: op.mode, from, to, label, attrs, soon, duration: attrs.duration || '', labelPos, line: lineNo });
        }
      }
      continue;
    }

    // node declaration
    if ((m = RE_NODE.exec(line))) {
      const type = TYPE_ALIASES[m[1].toLowerCase()];
      const id = m[2];
      if (!id) throw new ParseError(`"${m[1]}" needs an identifier, e.g. "${m[1]} myTeam \\"My Team\\""`, lineNo);
      if (model.index[id]) throw new ParseError(`duplicate identifier "${id}" (first declared on line ${model.index[id].line})`, lineNo);
      let rest = m[3];
      let label = id;
      let attrs = {};
      let opens = false;

      let q;
      if ((q = RE_QUOTED.exec(rest))) {
        label = unescape(q[1]);
        rest = rest.slice(q[0].length);
      } else {
        // unquoted label: everything up to "[" or "{"
        const cut = rest.search(/[[{]/);
        const raw = (cut === -1 ? rest : rest.slice(0, cut)).trim();
        if (raw) label = raw;
        rest = cut === -1 ? '' : rest.slice(cut);
      }
      if ((q = RE_ATTRS.exec(rest))) { attrs = parseAttrs(q[1]); rest = rest.slice(q[0].length); }
      rest = rest.trim();
      if (rest === '{') { opens = true; rest = ''; }
      if (rest) throw new ParseError(`unexpected "${rest}" after ${type} declaration`, lineNo);
      if (opens && type !== 'platform' && type !== 'group') {
        throw new ParseError(`only "platform" and "group" can open a "{ ... }" block`, lineNo);
      }

      const parent = stack.length ? stack[stack.length - 1] : null;
      const node = { id, type, label, attrs, api: null, children: [], parent: parent ? parent.id : null, line: lineNo };
      (parent ? parent.children : model.nodes).push(node);
      model.teams.push(node);
      model.index[id] = node;
      if (opens) stack.push(node);
      continue;
    }

    throw new ParseError(`cannot understand "${line}"`, lineNo);
  }

  if (!sawHeader) throw new ParseError('diagram must start with "teamTopology"', lines.length || 1);
  if (api) throw new ParseError(`api block for "${api.id}" opened on line ${api.line} is never closed with "}"`, lines.length);
  if (stack.length) {
    const open = stack[stack.length - 1];
    throw new ParseError(`block for "${open.id}" opened on line ${open.line} is never closed with "}"`, lines.length);
  }
  for (const a of apis) {
    const node = model.index[a.id];
    if (!node) throw new ParseError(`api block for unknown team "${a.id}"`, a.line);
    node.api = { ...(node.api || {}), ...a.fields };
  }

  // validate interactions
  for (const it of model.interactions) {
    for (const end of ['from', 'to']) {
      if (!model.index[it[end]]) throw new ParseError(`unknown team "${it[end]}"`, it.line);
    }
    if (it.from === it.to) throw new ParseError(`"${it.from}" cannot interact with itself`, it.line);
    if (isAncestor(model, it.from, it.to) || isAncestor(model, it.to, it.from)) {
      throw new ParseError(`"${it.from}" and "${it.to}" are nested; a team cannot interact with its own container`, it.line);
    }
  }
  return model;
}

function stripQuotes(s) {
  s = s.trim();
  const q = RE_QUOTED.exec(s);
  return q && q[0].length === s.length ? unescape(q[1]) : s;
}

/** Normalise a Team API field name: "Ways of working" → "waysofworking". */
function apiKey(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isAncestor(model, maybeAncestor, id) {
  let cur = model.index[id];
  while (cur && cur.parent) {
    if (cur.parent === maybeAncestor) return true;
    cur = model.index[cur.parent];
  }
  return false;
}

// ───────────────────────── Text metrics ─────────────────────────
// No canvas in Node, so widths are estimated per character class.

const NARROW = new Set("iljtfI'.,:;!| ()[]");
const WIDE = new Set('mwMW@');

export function textWidth(text, fontSize) {
  let w = 0;
  for (const ch of String(text)) {
    if (NARROW.has(ch)) w += 0.32;
    else if (WIDE.has(ch)) w += 0.85;
    else if (ch >= 'A' && ch <= 'Z') w += 0.68;
    else if (ch >= '0' && ch <= '9') w += 0.58;
    else w += 0.55;
  }
  return w * fontSize;
}

export function wrapText(text, maxWidth, fontSize) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (cur && textWidth(candidate, fontSize) > maxWidth) {
      lines.push(cur);
      cur = word;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

// ───────────────────────── Layout ─────────────────────────
//
// The layout follows the conventions of the Team Topologies book rather than
// a general graph layout:
//
//   • stream-aligned teams are full-width lanes, stacked top to bottom
//   • platform teams are full-width bars beneath the lanes
//   • enabling teams are tall bars that cross the lanes they facilitate
//   • complicated-subsystem teams sit embedded on the lane they serve
//   • X-as-a-Service is a grey wedge: wide at the provider, pointed at the consumer
//   • collaboration is a parallelogram bridging two teams
//   • facilitating is the dotted patch where an enabling bar crosses a team
//
// Groups and platform groupings are dashed frames laid out with the same rules,
// recursively. Order within a frame is declaration order.

const L = {
  laneH: 48, laneGap: 14, platH: 56, platGap: 14, lanesToPlat: 64,
  subW: 112, subH: 56, enW: 68, wedgeW: 64, slotGap: 22, labelMin: 170,
  pad: 24, frameTop: 26, frameBottom: 36, bandGap: 44, sideGap: 32, minW: 240,
  margin: 32, lineH: 1.25, noteFs: 11, titleH: 40, flowH: 46, legendH: 64, labelFs: 11,
  leaderGap: 6, topClear: 8,
  fs: { stream: 14, platform: 14, subsystem: 12, enabling: 12, group: 13 },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Wrap a wedge/edge label to maxWidth and measure the block it forms, so the
 * plate that gets drawn behind it (see plateLabelSVG) matches the geometry
 * used to size gaps, headroom and canvas growth.
 */
function wrapBlock(text, maxWidth) {
  const lines = wrapText(text, maxWidth, L.labelFs);
  const blockW = Math.max(...lines.map((ln) => textWidth(ln, L.labelFs)));
  const blockH = lines.length * L.labelFs * L.lineH;
  return { lines, blockW, blockH };
}

/** Max wrap width for a labelled edge parked above a pair of sibling frames. */
function aboveLabelMaxWidth(wA, wB) {
  return clamp(Math.max(wA, wB) * 0.6, 90, 220);
}

/**
 * #28: build a wrapped label plate parked above a shape, with a leader line
 * down to it — the labelPos="above" positioning shared by every interaction
 * mode (xaas wedges build their own variant inline, reaching past `topY`
 * into the wedge itself; every other mode anchors the leader at `topY`).
 */
function aboveLabel(text, midX, topY, maxWidth, anchorY = topY) {
  const { lines, blockW, blockH } = wrapBlock(text, maxWidth);
  const plateW = blockW + 16, plateH = blockH + 8;
  const bottomY = topY - L.leaderGap;
  const label = { x: midX, y: bottomY - plateH / 2, text, lines, plateW, plateH };
  const leader = { x: midX, y1: bottomY, y2: anchorY };
  return { label, leader };
}

/**
 * #28: approximate the bounding box of a team's own rendered label text, from
 * boxes[] fields only (kind, rotate, lines, fs, labelZone, note, x/y/w/h) —
 * mirrors teamSVG's textBlock/rotate placement. Used so an interaction shape
 * (bridge, wedge, patch, band) never gets placed on top of a team's label.
 */
function teamLabelBBox(box) {
  if (!box || !box.node) return null;
  if (box.kind === 'en' && box.rotate) {
    const fs = box.fs + 1;
    const tw = textWidth(box.node.label, fs) + 12, th = fs + 6;
    return { x: box.x + box.w / 2 - th / 2, y: box.y + box.h / 2 - tw / 2, w: th, h: tw };
  }
  const lines = box.lines && box.lines.length ? box.lines : [box.node.label];
  const lh = box.fs * L.lineH;
  const textH = lines.length * lh;
  const textW = Math.max(...lines.map((ln) => textWidth(ln, box.fs)));
  const cx = box.labelZone ? (box.labelZone[0] + box.labelZone[1]) / 2 : box.x + box.w / 2;
  const noteH = box.note && box.note.length ? L.noteFs * L.lineH + 2 : 0;
  const cy = box.y + box.h / 2 - noteH / 2;
  const pad = 4;
  return { x: cx - textW / 2 - pad, y: cy - textH / 2 - pad, w: textW + pad * 2, h: textH + pad * 2 };
}

function walk(node, fn) {
  fn(node);
  for (const c of node.children) walk(c, fn);
}

function rankOf(node) {
  if (node.type !== 'group') return TEAM_TYPES[node.type].rank;
  if (!node.children.length) return 0;
  const counts = new Map();
  for (const c of node.children) {
    const r = rankOf(c);
    counts.set(r, (counts.get(r) || 0) + 1);
  }
  let best = 0, bestN = -1;
  for (const [r, n] of counts) if (n > bestN) { best = r; bestN = n; }
  return best;
}

/**
 * Structural layout of one frame's children (relative coordinates).
 * Returns { w, h, items, slots, lanesRange } where items are lanes, platform bars and
 * child frames, and slots reserve x positions for the overlays placed later.
 */
function structure(children, model, forcedW = 0) {
  const leaf = (t) => children.filter((c) => !c.children.length && c.type === t);
  const lanes = [...leaf('stream'), ...leaf('group')];   // an empty group is drawn as a lane
  const plats = leaf('platform');
  const subs = leaf('subsystem');
  const enab = leaf('enabling');
  const frames = children.filter((c) => c.children.length);
  const topFrames = frames.filter((c) => rankOf(c) < 2);
  const botFrames = frames.filter((c) => rankOf(c) === 2);

  // vertical elements get their own x slot: wedges to the left of the lane labels,
  // subsystems and enabling bars to the right
  const stackIds = new Set([...lanes, ...plats, ...subs, ...enab].map((n) => n.id));
  const wedgeGroups = new Map();
  for (const it of model.interactions) {
    if (it.mode !== 'xaas' || !stackIds.has(it.from) || !stackIds.has(it.to)) continue;
    if (model.index[it.from].type === 'subsystem' || model.index[it.from].type === 'enabling') continue;
    const key = `${it.from}\u0000${it.label}`;
    if (!wedgeGroups.has(key)) wedgeGroups.set(key, []);
    wedgeGroups.get(key).push(it);
  }
  // a wedge that covers several teams gets a wider base
  const wedgeSlots = [...wedgeGroups.values()].map((its) => ({ kind: 'wedge', its, w: L.wedgeW + Math.min(3, its.length - 1) * 28 }));
  const rightSlots = [
    ...subs.map((node) => ({ kind: 'sub', node, w: L.subW })),
    ...enab.map((node) => ({ kind: 'en', node, w: L.enW })),
  ];
  const slotsWidth = (arr) => arr.reduce((a, s) => a + s.w + L.slotGap, 0);
  const leftW = slotsWidth(wedgeSlots), rightW = slotsWidth(rightSlots) + (rightSlots.length ? 24 : 0);
  const hasStack = lanes.length || plats.length;
  const labelW = Math.max(L.labelMin,
    ...lanes.map((n) => textWidth(n.label, L.fs.stream) + 48),
    ...plats.map((n) => textWidth(n.label, L.fs.platform) + 48));

  const topLays = topFrames.map((c) => frame(c, model));
  // #23 treatment A (default): a labelled xaas edge directly between two sibling
  // top-level frames widens just its own gap to fit the wrapped label plate,
  // instead of the flat sideGap. A labelPos="above" edge keeps the gap narrow —
  // its label is parked above the frames instead (see frame() and layout()).
  const xaasLabelGap = (idA, idB) => {
    const it = model.interactions.find((i) => i.mode === 'xaas' && i.label && (i.labelPos || 'gap') === 'gap' &&
      ((i.from === idA && i.to === idB) || (i.from === idB && i.to === idA)));
    if (!it) return L.sideGap;
    const { blockW } = wrapBlock(it.label, 160);
    return clamp(blockW + 32, L.sideGap, 220);
  };
  const topGaps = topLays.slice(0, -1).map((l, i) => xaasLabelGap(l.node.id, topLays[i + 1].node.id));
  const topBandW = topLays.reduce((a, l) => a + l.w, 0) + topGaps.reduce((a, g) => a + g, 0);
  let botLays = botFrames.map((c) => frame(c, model));
  // slot columns always get their own room beside a band of child frames
  const innerW = Math.max(forcedW, hasStack ? leftW + labelW + rightW : 0, topBandW + (topLays.length ? leftW + rightW : 0),
    ...botLays.map((l) => l.w), hasStack ? L.minW : 0);
  botLays = botFrames.map((c) => frame(c, model, innerW - 2 * L.pad));   // platform groupings stretch full width

  let x = L.slotGap;
  for (const s of wedgeSlots) { s.x = x; x += s.w + L.slotGap; }
  x = innerW - rightW + L.slotGap;
  for (const s of rightSlots) { s.x = x; x += s.w + L.slotGap; }
  const labelZone = [leftW, innerW - rightW];

  const items = [];
  let y = 0;
  if (topLays.length) {
    let bx = leftW || rightW ? leftW : (innerW - topBandW) / 2;
    const bandH = Math.max(...topLays.map((l) => l.h));
    topLays.forEach((l, i) => { items.push({ kind: 'frame', node: l.node, x: bx, y, w: l.w, h: l.h, inner: l.inner }); bx += l.w + (topGaps[i] ?? L.sideGap); });
    y += bandH;
    if (lanes.length || plats.length || botLays.length) y += L.bandGap;
  }
  const lanesTop = y + (subs.length ? L.subH / 2 + 8 : enab.length ? 20 : 2);
  y = lanesTop;
  // all lanes in a frame share one label column: clear of wedge columns when a wedge
  // crosses any lane, clear of the subsystem/enabling columns, centred when there is room
  const laneIndex = new Map(lanes.map((n, i) => [n.id, i]));
  const anyCrossed = wedgeSlots.some(({ its }) => its.some((it) => {
    const a = laneIndex.has(it.from) ? laneIndex.get(it.from) : lanes.length;   // platforms sit below every lane
    const b = laneIndex.has(it.to) ? laneIndex.get(it.to) : lanes.length;
    return Math.max(a, b) - Math.min(a, b) > 1;
  }));
  const zone = [anyCrossed ? labelZone[0] : 0, labelZone[1]];
  const widest = Math.max(0, ...lanes.map((n) => textWidth(n.label, L.fs.stream))) / 2 + 12;
  const laneZone = innerW / 2 - widest >= zone[0] && innerW / 2 + widest <= zone[1] ? [0, innerW] : zone;
  for (const n of lanes) {
    const lines = wrapText(n.label, laneZone[1] - laneZone[0] - 24, L.fs.stream);
    const h = Math.max(L.laneH, lines.length * L.fs.stream * L.lineH + 18 + (n.attrs.note ? 14 : 0));
    items.push({ kind: 'lane', node: n, x: 0, y, w: innerW, h, lines, labelZone: laneZone });
    y += h + L.laneGap;
  }
  if (lanes.length) y -= L.laneGap;
  const lanesRange = lanes.length ? [lanesTop, y] : null;
  if (lanes.length && (plats.length || botLays.length)) y += L.lanesToPlat;
  for (const n of plats) {
    const lines = wrapText(n.label, innerW - 48, L.fs.platform);
    const h = Math.max(L.platH, lines.length * L.fs.platform * L.lineH + 22 + (n.attrs.note ? 14 : 0));
    items.push({ kind: 'plat', node: n, x: 0, y, w: innerW, h, lines, labelZone: [0, innerW] });
    y += h + L.platGap;
  }
  if (plats.length) y -= L.platGap;
  for (const l of botLays) {
    if (items.length) y += L.platGap + 6;
    items.push({ kind: 'frame', node: l.node, x: (innerW - l.w) / 2, y, w: l.w, h: l.h, inner: l.inner });
    y += l.h;
  }
  y += enab.length ? 20 : 2;
  return { w: innerW, h: y, items, slots: [...wedgeSlots, ...rightSlots], lanesRange };
}

function frame(node, model, forcedW = 0) {
  const inner = structure(node.children, model, forcedW);
  const w = Math.max(inner.w + 2 * L.pad, textWidth(node.label, L.fs.group) + 80);
  // #23 treatment B: a labelled xaas edge directly between two of this frame's own
  // child frames, with labelPos="above", parks its label above them (see layout()) —
  // grow this frame's own top margin so the plate clears its dashed border.
  const kids = inner.items.filter((it) => it.kind === 'frame');
  let headroom = 0;
  for (const it of model.interactions) {
    if (it.mode !== 'xaas' || !it.label || (it.labelPos || 'gap') !== 'above') continue;
    const A = kids.find((k) => k.node.id === it.from);
    const B = kids.find((k) => k.node.id === it.to);
    if (!A || !B) continue;
    const { blockH } = wrapBlock(it.label, aboveLabelMaxWidth(A.w, B.w));
    headroom = Math.max(headroom, blockH + 8 + L.leaderGap + L.topClear);
  }
  const frameTop = headroom ? L.frameTop + headroom : L.frameTop;
  inner.ox = (w - inner.w) / 2;
  inner.oy = frameTop;
  return { node, w, h: frameTop + inner.h + L.frameBottom, inner };
}

// ── geometry helpers ──

function center(b) { return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }

/** Point on the boundary of box `b` along the ray from its centre toward point `p`. */
function anchor(b, p) {
  const c = center(b);
  const dx = p.x - c.x, dy = p.y - c.y;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return c;
  const sx = Math.abs(dx) > 1e-6 ? (b.w / 2) / Math.abs(dx) : Infinity;
  const sy = Math.abs(dy) > 1e-6 ? (b.h / 2) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

function intersect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w), btm = Math.min(a.y + a.h, b.y + b.h);
  return r > x && btm > y ? { x, y, w: r - x, h: btm - y } : null;
}

const overlap1d = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

/** Base point on P and apex on Q for a wedge or bridge between two boxes, preferring axis-aligned placement. */
function facing(P, Q, xOverride) {
  const xo = overlap1d(P.x, P.x + P.w, Q.x, Q.x + Q.w);
  const yo = overlap1d(P.y, P.y + P.h, Q.y, Q.y + Q.h);
  if (xo >= 40 && yo < 0) {
    const x = xOverride ?? (Math.max(P.x, Q.x) + Math.min(P.x + P.w, Q.x + Q.w)) / 2;
    return P.y < Q.y
      ? { from: { x, y: P.y + P.h }, to: { x, y: Q.y }, axis: 'v' }
      : { from: { x, y: P.y }, to: { x, y: Q.y + Q.h }, axis: 'v' };
  }
  if (yo >= 24 && xo < 0) {
    const y = (Math.max(P.y, Q.y) + Math.min(P.y + P.h, Q.y + Q.h)) / 2;
    return P.x < Q.x
      ? { from: { x: P.x + P.w, y }, to: { x: Q.x, y }, axis: 'h' }
      : { from: { x: P.x, y }, to: { x: Q.x + Q.w, y }, axis: 'h' };
  }
  return { from: anchor(P, center(Q)), to: anchor(Q, center(P)), axis: 'd' };
}

/**
 * Compute absolute boxes for every team and geometry for every interaction.
 * Returns { width, height, boxes, edges, content, legend, flow, title }.
 *   boxes[id] = { x, y, w, h, node, kind, lines, note, fs, labelZone?, rotate? }
 *   edges     = [{ inter, geo }] with geo.kind ∈ wedge | bridge | patch | band
 */
export function layout(model, opts = {}) {
  const root = structure(model.nodes, model);
  const showLegend = opts.legend ?? model.legend;
  const top = L.margin + (model.title ? L.titleH : 0) + (model.flow ? L.flowH : 0);
  const contentW = Math.max(root.w, showLegend ? legendWidth() : 0, model.title ? textWidth(model.title, 18) : 0, 120);
  const ox = L.margin + (contentW - root.w) / 2;

  // pass 1: structural boxes
  const boxes = {};
  const slots = [];
  const place = (lay, x0, y0) => {
    for (const it of lay.items) {
      const x = x0 + it.x, y = y0 + it.y;
      if (it.kind === 'frame') {
        const n = it.node;
        boxes[n.id] = { x, y, w: it.w, h: it.h, node: n, kind: 'frame', lines: [n.label], note: n.attrs.note ? [n.attrs.note] : [], fs: L.fs.group };
        place(it.inner, x + it.inner.ox, y + it.inner.oy);
      } else {
        boxes[it.node.id] = {
          x, y, w: it.w, h: it.h, node: it.node, kind: it.kind, lines: it.lines,
          note: it.node.attrs.note ? wrapText(it.node.attrs.note, it.w - 48, L.noteFs).slice(0, 1) : [],
          fs: it.kind === 'lane' ? L.fs.stream : L.fs.platform,
          labelZone: [x0 + it.labelZone[0], x0 + it.labelZone[1]],
        };
      }
    }
    for (const s of lay.slots) {
      slots.push({ ...s, x: x0 + s.x, lanesRange: lay.lanesRange ? [y0 + lay.lanesRange[0], y0 + lay.lanesRange[1]] : null, inner: [y0, y0 + lay.h] });
    }
  };
  place(root, ox, top);

  // pass 2: subsystems embedded on the first lane they serve
  for (const s of slots.filter((s) => s.kind === 'sub')) {
    const n = s.node;
    const consumer = model.interactions.find((it) => it.mode === 'xaas' && it.from === n.id && boxes[it.to]?.kind === 'lane');
    let y;
    if (consumer) y = boxes[consumer.to].y - L.subH / 2;
    else if (s.lanesRange) y = s.lanesRange[0] - L.subH - 8;
    else y = s.inner[0];
    boxes[n.id] = {
      x: s.x, y, w: L.subW, h: L.subH, node: n, kind: 'sub', fs: L.fs.subsystem,
      lines: wrapText(n.label, L.subW - 28, L.fs.subsystem), note: [], embeddedOn: consumer ? consumer.to : null,
    };
  }

  // pass 3: enabling bars span the teams they facilitate
  for (const s of slots.filter((s) => s.kind === 'en')) {
    const n = s.node;
    const targets = model.interactions.filter((it) => it.mode === 'facilitating' && it.from === n.id && boxes[it.to]).map((it) => boxes[it.to]);
    let y0, y1;
    if (targets.length) {
      y0 = Math.min(...targets.map((t) => t.y)) - 16;
      y1 = Math.max(...targets.map((t) => t.y + t.h)) + 16;
    } else if (s.lanesRange) {
      [y0, y1] = [s.lanesRange[0] - 16, s.lanesRange[1] + 16];
    } else {
      [y0, y1] = [s.inner[0] + 8, s.inner[1] - 8];
    }
    const h = Math.max(y1 - y0, 80);
    const lines = wrapText(n.label, L.enW - 10, L.fs.enabling);
    const fitsAcross = lines.every((ln) => textWidth(ln, L.fs.enabling) <= L.enW - 10) && lines.length * L.fs.enabling * L.lineH < h - 16 && lines.length <= 3;
    boxes[n.id] = { x: s.x, y: y0, w: L.enW, h, node: n, kind: 'en', fs: L.fs.enabling, lines: fitsAcross ? lines : [n.label], rotate: !fitsAcross, note: [] };
  }

  // pass 4: interactions
  const edges = [];
  const corridors = [];   // x positions already used by vertical wedges, with their y ranges
  const solid = Object.values(boxes).filter((b) => b.kind !== 'frame');
  const insideAny = (p, skip) => solid.some((b) => !skip.includes(b) && p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h);
  const handled = new Set();
  for (const inter of model.interactions) {
    if (handled.has(inter)) continue;
    let P = boxes[inter.from], Q = boxes[inter.to];
    if (!P || !Q) continue;
    if (inter.mode === 'xaas') {
      if (P.kind === 'sub' && P.embeddedOn === inter.to) continue;   // embedding is the relationship
      const slot = slots.find((s) => s.kind === 'wedge' && s.its.includes(inter));
      // #23: a fan-out from one provider to several targets with the same label text
      // renders once, even when the targets aren't stack-siblings sharing a wedge slot
      // (e.g. a nested provider fanning out to top-level consumers).
      let group;
      if (slot) group = slot.its.filter((i) => boxes[i.to]);
      else if (inter.label) {
        group = model.interactions.filter((i) => !handled.has(i) && i.mode === 'xaas' &&
          i.from === inter.from && i.label === inter.label && boxes[i.to]);
      } else group = [inter];
      for (const i of group) handled.add(i);
      // the wedge reaches the consumer farthest from the provider and covers the ones between
      const pc = center(P);
      Q = group.map((i) => boxes[i.to]).reduce((far, b) => (Math.abs(center(b).y - pc.y) > Math.abs(center(far).y - pc.y) ? b : far));
      let xOverride = slot ? slot.x + slot.w / 2 : P.kind === 'sub' ? P.x + P.w / 2 : undefined;
      if (xOverride === undefined) {
        // free vertical wedge: pick an x in the overlap that no other wedge on the same stretch uses
        const x0 = Math.max(P.x, Q.x), x1 = Math.min(P.x + P.w, Q.x + Q.w);
        const y0 = Math.min(P.y + P.h, Q.y + Q.h), y1 = Math.max(P.y, Q.y);
        if (x1 - x0 >= 40 && y1 > y0) {
          const mid = (x0 + x1) / 2;
          // #23: when the wedge carries a real label, size the corridor to the
          // label's plate (not just the bare wedge) so two free wedges from the
          // same crowded stretch don't get labels that collide.
          const step = inter.label ? Math.max(L.wedgeW * 0.75, textWidth(inter.label, L.labelFs) + 28) : L.wedgeW * 0.75;
          const clash = (x) => corridors.some((c) => Math.abs(c.x - x) < Math.max(c.step, step) && c.y1 > y0 && c.y0 < y1);
          const candidates = [mid];
          for (let d = step; mid + d <= x1 - 20 || mid - d >= x0 + 20; d += step) { candidates.push(mid + d, mid - d); }
          xOverride = candidates.find((x) => x >= x0 + 20 && x <= x1 - 20 && !clash(x)) ?? mid;
          corridors.push({ x: xOverride, y0, y1, step });
        }
      }
      const f = facing(P, Q, xOverride);
      if (Q.kind !== 'frame') {
        // the point reaches the far edge of a team, so the wedge covers it
        if (f.axis === 'v') f.to = { x: f.to.x, y: P.y < Q.y ? Q.y + Q.h : Q.y };
        else if (f.axis === 'h') f.to = { x: P.x < Q.x ? Q.x + Q.w : Q.x, y: f.to.y };
      }
      const dx = f.to.x - f.from.x, dy = f.to.y - f.from.y, len = Math.hypot(dx, dy);
      if (len < 2) continue;
      const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
      const hw = Math.min((slot ? slot.w : L.wedgeW) / 2, len * 0.35);
      const points = [
        { x: f.from.x + nx * hw, y: f.from.y + ny * hw },
        { x: f.from.x - nx * hw, y: f.from.y - ny * hw },
        f.to,
      ];
      let label = null;
      let leader = null;
      if (len >= 30) {
        const text = inter.label || 'XaaS';
        const labelPos = inter.labelPos || 'gap';
        if (inter.label && labelPos === 'above' && P.kind === 'frame' && Q.kind === 'frame' && f.axis === 'h') {
          // #23 treatment B: park the label above both frames, joined to the wedge
          // by a short leader, instead of crowding the gap between them.
          const { lines, blockW, blockH } = wrapBlock(text, aboveLabelMaxWidth(P.w, Q.w));
          const plateW = blockW + 16, plateH = blockH + 8;
          const midX = (f.from.x + f.to.x) / 2;
          const bottomY = Math.min(P.y, Q.y) - L.leaderGap;
          label = { x: midX, y: bottomY - plateH / 2, text, lines, plateW, plateH };
          leader = { x: midX, y1: bottomY, y2: f.from.y };
        } else {
          let along;
          if (P.kind === 'frame' && Q.kind === 'frame') {
            // #23 treatment A: the gap between two sibling frames is sized to fit
            // the wrapped label (see xaasLabelGap in structure()), so center the
            // plate in it rather than hunting for the first clear spot.
            along = len / 2;
          } else {
            along = Math.min(48, len * 0.3);
            for (let a = along; a < len - 16; a += 16) {
              if (!insideAny({ x: f.from.x + ux * a, y: f.from.y + uy * a }, [P, ...group.map((i) => boxes[i.to])])) { along = a; break; }
            }
          }
          // wrap to the room available along the wedge, on an opaque plate, so a
          // long label breaks onto lines instead of overflowing.
          const { lines, blockW, blockH } = wrapBlock(text, clamp(len - 20, 90, 220));
          label = { x: f.from.x + ux * along, y: f.from.y + uy * along, text, lines, plateW: blockW + 16, plateH: blockH + 8 };
        }
      }
      edges.push({ inter, inters: group, geo: { kind: 'wedge', points, label, leader, axis: f.axis } });
    } else if (inter.mode === 'collaboration' && intersect(P, Q)) {
      const small = P.w * P.h <= Q.w * Q.h ? P : Q;
      const text = inter.label || 'Collaboration';
      const above = inter.label && (inter.labelPos || 'gap') === 'above';
      const k = 10;
      let w, h;
      if (above) { w = Math.max(small.w - 12, 60); h = 30; } else {
        const { blockW, blockH } = wrapBlock(text, clamp(small.w - 32, 90, 220));
        w = Math.max(small.w - 12, blockW + 30);
        h = Math.max(30, blockH + 16);
      }
      let cx = small.x + small.w / 2, cy = small.y + small.h;
      // #28: an embedded subsystem's octagon carries its own label — the bridge
      // must never cover it (or the lane's label it also touches). Try clear of
      // the octagon: below it inside the lane, then beside it, before falling
      // back to the original position.
      const sub = P.kind === 'sub' ? P : Q.kind === 'sub' ? Q : null;
      if (sub) {
        const other = sub === P ? Q : P;
        const subLabel = teamLabelBBox(sub), otherLabel = teamLabelBBox(other);
        const gap = 6;
        const candidates = [
          { x: sub.x + sub.w / 2, y: sub.y + sub.h + h / 2 + gap },
          { x: sub.x + sub.w + w / 2 + gap, y: sub.y + sub.h / 2 },
          { x: sub.x - w / 2 - gap, y: sub.y + sub.h / 2 },
        ];
        const clear = (c) => {
          const bbox = { x: c.x - w / 2, y: c.y - h / 2, w, h };
          return (!subLabel || !intersect(bbox, subLabel)) && (!otherLabel || !intersect(bbox, otherLabel));
        };
        const pick = candidates.find(clear) ?? candidates[0];
        cx = pick.x; cy = pick.y;
      }
      let label, leader;
      if (above) {
        ({ label, leader } = aboveLabel(text, cx, cy - h / 2, aboveLabelMaxWidth(w, 0)));
      } else {
        const { lines } = wrapBlock(text, clamp(small.w - 32, 90, 220));
        label = { x: cx, y: cy, text, lines, onShape: true };
      }
      const points = [
        { x: cx - w / 2 + k, y: cy - h / 2 }, { x: cx + w / 2 + k, y: cy - h / 2 },
        { x: cx + w / 2 - k, y: cy + h / 2 }, { x: cx - w / 2 - k, y: cy + h / 2 },
      ];
      edges.push({ inter, geo: { kind: 'bridge', points, label, leader } });
    } else if (inter.mode === 'collaboration') {
      const f = facing(P, Q);
      const cx = (f.from.x + f.to.x) / 2, cy = (f.from.y + f.to.y) / 2;
      const gap = Math.hypot(f.to.x - f.from.x, f.to.y - f.from.y);
      const text = inter.label || 'Collaboration';
      const above = inter.label && (inter.labelPos || 'gap') === 'above';
      const minW = f.axis === 'h' ? gap + 12 : 120;
      const minH = f.axis === 'h' ? 40 : Math.max(gap + 24, 40);
      const k = 14;
      let w = minW, h = minH, label, leader;
      if (above) {
        ({ label, leader } = aboveLabel(text, cx, cy - h / 2, aboveLabelMaxWidth(w, 0)));
      } else {
        const { lines, blockW, blockH } = wrapBlock(text, clamp(minW - 24, 90, 220));
        w = Math.max(minW, blockW + 30);
        h = Math.max(minH, blockH + 16);
        // #28: the shape straddles both P and Q — never let it grow into either
        // one's own label. Shrink toward the available strip between their label
        // bboxes (only meaningful for the common vertical-stack case).
        if (f.axis === 'v') {
          const aBox = teamLabelBBox(P), bBox = teamLabelBBox(Q);
          if (aBox && bBox) {
            const top = P.y < Q.y ? aBox : bBox, bottom = P.y < Q.y ? bBox : aBox;
            const avail = bottom.y - (top.y + top.h) - 4;
            if (avail > 20 && h > avail) h = avail;
          }
        }
        label = { x: cx, y: cy, text, lines, onShape: true };
      }
      const points = [
        { x: cx - w / 2 + k, y: cy - h / 2 }, { x: cx + w / 2 + k, y: cy - h / 2 },
        { x: cx + w / 2 - k, y: cy + h / 2 }, { x: cx - w / 2 - k, y: cy + h / 2 },
      ];
      edges.push({ inter, geo: { kind: 'bridge', points, label, leader } });
    } else {
      const r = intersect(P, Q);
      if (r) {
        let label = null, leader = null;
        if (inter.label) {
          const above = (inter.labelPos || 'gap') === 'above';
          if (above) {
            // #28: anchor above the whole lane stack the enabling bar crosses, not
            // just its own box or the narrow patch rect — an enabling bar can start
            // partway down a stack (it only spans the lanes it facilitates), so a
            // lane sitting above the bar's own top edge could still collide.
            const enSlot = slots.find((s) => s.kind === 'en' && s.node.id === inter.from);
            const topY = Math.min(enSlot?.lanesRange ? enSlot.lanesRange[0] : P.y, r.y);
            ({ label, leader } = aboveLabel(inter.label, r.x + r.w / 2, topY, aboveLabelMaxWidth(r.w, 0), r.y + r.h / 2));
          } else {
            // #28: same wrap rule as xaas; the patch has no natural width constraint
            // of its own (the label floats beside it), so wrap at the outer cap.
            const { lines, blockW, blockH } = wrapBlock(inter.label, clamp(220, 90, 220));
            label = { x: r.x + r.w + 10 + blockW / 2, y: r.y + r.h / 2, text: inter.label, lines, plateW: blockW + 16, plateH: blockH + 8 };
          }
        }
        edges.push({ inter, geo: { kind: 'patch', rect: r, label, leader } });
      } else {
        const f = facing(P, Q);
        const dx = f.to.x - f.from.x, dy = f.to.y - f.from.y, len = Math.hypot(dx, dy);
        if (len < 2) continue;
        const nx = -dy / len, ny = dx / len, t = 12;
        const points = [
          { x: f.from.x + nx * t, y: f.from.y + ny * t }, { x: f.to.x + nx * t, y: f.to.y + ny * t },
          { x: f.to.x - nx * t, y: f.to.y - ny * t }, { x: f.from.x - nx * t, y: f.from.y - ny * t },
        ];
        let label = null, leader = null;
        if (inter.label) {
          const above = (inter.labelPos || 'gap') === 'above';
          if (above) {
            const topY = Math.min(...points.map((p) => p.y));
            ({ label, leader } = aboveLabel(inter.label, (f.from.x + f.to.x) / 2, topY, aboveLabelMaxWidth(len, 0)));
          } else {
            const { lines, blockW, blockH } = wrapBlock(inter.label, clamp(len - 20, 90, 220));
            label = {
              x: (f.from.x + f.to.x) / 2 + nx * 24, y: (f.from.y + f.to.y) / 2 + ny * 24,
              text: inter.label, lines, plateW: blockW + 16, plateH: blockH + 8,
            };
          }
        }
        edges.push({ inter, geo: { kind: 'band', points, label, leader } });
      }
    }
  }

  // canvas: grow around anything that overflows the structural content
  let minX = ox, minY = top, maxX = ox + root.w, maxY = top + root.h;
  const grow = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const b of Object.values(boxes)) { grow(b.x, b.y); grow(b.x + b.w, b.y + b.h); }
  for (const { geo } of edges) {
    for (const p of geo.points || []) grow(p.x, p.y);
    if (geo.label) {
      if (geo.label.plateW != null) {
        const w = geo.label.plateW, h = geo.label.plateH;
        grow(geo.label.x - w / 2, geo.label.y - h / 2); grow(geo.label.x + w / 2, geo.label.y + h / 2);
      } else {
        // #28: on-shape labels (e.g. collaboration labelPos=gap) have no plate —
        // measure the wrapped lines directly. The shape itself is already sized
        // to contain them, so this mostly just keeps growth calc accurate.
        const lines = geo.label.lines || [geo.label.text];
        const hw = Math.max(...lines.map((ln) => textWidth(ln, L.labelFs))) / 2 + 6;
        const hh = (lines.length * L.labelFs * L.lineH) / 2 + 6;
        grow(geo.label.x - hw, geo.label.y - hh); grow(geo.label.x + hw, geo.label.y + hh);
      }
    }
    if (geo.leader) { grow(geo.leader.x, geo.leader.y1); grow(geo.leader.x, geo.leader.y2); }
  }
  const padL = Math.max(0, ox - minX), padT = Math.max(0, top - minY);
  if (padL || padT) {
    const shift = (p) => { p.x += padL; p.y += padT; };
    for (const b of Object.values(boxes)) { shift(b); if (b.labelZone) { b.labelZone[0] += padL; b.labelZone[1] += padL; } }
    for (const { geo } of edges) {
      for (const p of geo.points || []) shift(p);
      if (geo.rect) shift(geo.rect);
      if (geo.label) shift(geo.label);
      if (geo.leader) { geo.leader.x += padL; geo.leader.y1 += padT; geo.leader.y2 += padT; }
    }
    maxX += padL; maxY += padT;
  }
  const finalContentW = Math.max(contentW, maxX - L.margin);
  const contentH = maxY - top;
  const width = finalContentW + 2 * L.margin;
  const height = top + contentH + L.margin + (showLegend ? L.legendH : 0);
  return {
    width, height, boxes, edges,
    content: { x: L.margin, y: top, w: finalContentW, h: contentH },
    title: model.title ? { x: L.margin, y: L.margin + 18 } : null,
    flow: model.flow ? { x: L.margin, y: L.margin + (model.title ? L.titleH : 0), w: finalContentW, label: model.flow } : null,
    legend: showLegend ? { x: L.margin, y: height - L.legendH + 8, w: finalContentW } : null,
  };
}

// ───────────────────────── Themes ─────────────────────────

export const THEMES = {
  light: {
    bg: '#ffffff', text: '#1f2430', muted: '#6b7280', title: '#111827',
    flow: '#e5e7eb', flowText: '#4b5563', halo: '#ffffff',
    stream:    { fill: '#FFE9A8', stroke: '#E8C453', text: '#3b2f00' },
    enabling:  { fill: '#C4B1E0', stroke: '#8E6BBF', text: '#2a1a55', plate: '#C4B1E0' },
    subsystem: { fill: '#F6C79B', stroke: '#DE9A5C', text: '#4a2200' },
    platform:  { fill: '#BBD9F3', stroke: '#6FA6DD', text: '#0f2f55' },
    frame:     { fill: 'none', stroke: '#5B8FD6', text: '#3b76c4', platformFill: 'rgba(187,217,243,0.18)' },
    collab:    { fill: 'rgba(196,177,224,0.85)', stroke: '#A58DCB', text: '#2a1a55', plate: '#cdbde5' },
    xaas:      { fill: 'rgba(120,124,132,0.32)', stroke: 'rgba(90,94,102,0.35)', text: '#3f4652', plate: '#c6c8cb' },
    facil:     { dot: '#6B4FA8', fill: 'rgba(107,79,168,0.25)', text: '#4c3a85', plate: '#cdc3e1' },
  },
  dark: {
    bg: '#0f172a', text: '#e5e7eb', muted: '#94a3b8', title: '#f8fafc',
    flow: '#1e293b', flowText: '#94a3b8', halo: '#0f172a',
    stream:    { fill: '#B8912A', stroke: '#FFD166', text: '#1a1400' },
    enabling:  { fill: '#7C5CBF', stroke: '#C9BAEA', text: '#f3eefc', plate: '#6647a8' },
    subsystem: { fill: '#C2661E', stroke: '#F8B98A', text: '#1f0e00' },
    platform:  { fill: '#2F6DB5', stroke: '#A9CCEF', text: '#eef5fc' },
    frame:     { fill: 'none', stroke: '#6FA3DC', text: '#9cc4ef', platformFill: 'rgba(47,109,181,0.18)' },
    collab:    { fill: 'rgba(124,92,191,0.98)', stroke: '#C9BAEA', text: '#f6f2ff', plate: '#7a5bbc' },
    xaas:      { fill: 'rgba(203,213,225,0.28)', stroke: 'rgba(203,213,225,0.35)', text: '#e2e8f0', plate: '#444c5d' },
    facil:     { dot: '#E0D4F5', fill: 'rgba(224,212,245,0.28)', text: '#d9ccf5', plate: '#4a4c63' },
  },
};

// ───────────────────────── Renderer ─────────────────────────

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => (Math.round(n * 100) / 100).toString();
const pts = (arr) => arr.map((p) => `${num(p.x)},${num(p.y)}`).join(' ');

function el(tag, attrs = {}, children = '') {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  const body = Array.isArray(children) ? children.join('') : children;
  return body ? `<${tag}${a}>${body}</${tag}>` : `<${tag}${a}/>`;
}

function octagonPath(x, y, w, h, c) {
  return `M${num(x + c)},${num(y)} H${num(x + w - c)} L${num(x + w)},${num(y + c)} V${num(y + h - c)} L${num(x + w - c)},${num(y + h)} H${num(x + c)} L${num(x)},${num(y + h - c)} V${num(y + c)} Z`;
}

function textBlock(lines, cx, cy, fs, color, extra = {}) {
  const lh = fs * L.lineH;
  const total = lines.length * lh;
  const y0 = cy - total / 2 + lh * 0.78;
  return el('text', { x: cx, y: y0, 'text-anchor': 'middle', 'font-size': fs, fill: color, ...extra },
    lines.map((ln, i) => el('tspan', { x: cx, dy: i === 0 ? 0 : lh }, esc(ln) || ' ')));
}

function tooltip(node) {
  return el('title', {}, esc([TEAM_TYPES[node.type].name, ...Object.entries(node.attrs).map(([k, v]) => `${k}: ${v}`)].join('\n')));
}

function frameSVG(box, T) {
  const { x, y, w, h, node } = box;
  const isPlatform = node.type === 'platform';
  const label = node.label;
  const tw = textWidth(label, L.fs.group) + 16;
  return el('g', { class: `tt-frame tt-${node.type}`, 'data-id': node.id }, [
    tooltip(node),
    el('rect', { x, y, width: w, height: h, rx: 6, fill: isPlatform ? T.frame.platformFill : T.frame.fill, stroke: T.frame.stroke, 'stroke-width': 1.5, 'stroke-dasharray': '7 5' }),
    el('rect', { x: x + w / 2 - tw / 2, y: y + h - 10, width: tw, height: 20, fill: T.bg }),
    el('text', { x: x + w / 2, y: y + h + 4, 'text-anchor': 'middle', 'font-size': L.fs.group, 'font-weight': 600, fill: T.frame.text }, esc(label)),
  ]);
}

function teamSVG(box, T, part = 'all') {
  const { x, y, w, h, node } = box;
  const c = T[node.type === 'group' ? 'stream' : node.type];
  const parts = [tooltip(node)];
  if (part !== 'label') switch (box.kind) {
    case 'sub':
      parts.push(el('path', { d: octagonPath(x, y, w, h, 12), fill: c.fill, stroke: c.stroke, 'stroke-width': 2 }));
      break;
    default:
      parts.push(el('rect', { x, y, width: w, height: h, rx: box.kind === 'en' ? 10 : 8, fill: c.fill, stroke: c.stroke, 'stroke-width': 2 }));
  }
  const cx = box.labelZone ? (box.labelZone[0] + box.labelZone[1]) / 2 : x + w / 2;
  if (part === 'shape') {
    // label drawn separately
  } else if (box.rotate) {
    // #28: an enabling bar's rotated label can sit over the dotted facilitating
    // pattern crossing it — give it an opaque plate in the enabling tint (rotated
    // along with the text) so it stays legible over the dots.
    const fs = L.fs.enabling + 1;
    const tw = textWidth(node.label, fs) + 12, th = fs + 6;
    parts.push(el('g', { transform: `translate(${num(x + w / 2 + 5)} ${num(y + h / 2)}) rotate(90)` }, [
      el('rect', { x: -tw / 2, y: -th * 0.65, width: tw, height: th, rx: 3, fill: c.plate }),
      el('text', { x: 0, y: 0, 'text-anchor': 'middle', 'font-size': fs, 'font-weight': 600, fill: c.text }, esc(node.label)),
    ]));
  } else {
    const noteH = box.note.length ? L.noteFs * L.lineH + 2 : 0;
    parts.push(textBlock(box.lines, cx, y + h / 2 - noteH / 2, box.fs, c.text, { 'font-weight': 600 }));
    if (box.note.length) parts.push(el('text', { x: cx, y: y + h / 2 + (box.lines.length * box.fs * L.lineH) / 2 + 8, 'text-anchor': 'middle', 'font-size': L.noteFs, fill: c.text, opacity: 0.8 }, esc(box.note[0])));
  }
  return el('g', { class: `tt-node tt-${node.type}`, 'data-id': node.id }, parts);
}

/**
 * An edge label, possibly wrapped onto several lines, drawn on an opaque background
 * plate coloured to match its interaction mode (#28), rather than a text-stroke
 * halo — stays legible over frame fills, dashed borders and adjacent team labels.
 * Every interaction mode's label gets this treatment.
 */
function plateLabelSVG(label, textColor, plateColor) {
  if (!label) return '';
  const lines = label.lines && label.lines.length ? label.lines : [label.text];
  const lh = L.labelFs * L.lineH;
  const blockH = lines.length * lh;
  const w = label.plateW ?? (Math.max(...lines.map((ln) => textWidth(ln, L.labelFs))) + 16);
  const h = label.plateH ?? (blockH + 8);
  const y0 = label.y - blockH / 2 + lh * 0.78;
  return el('g', { class: 'tt-edge-label' }, [
    el('rect', { x: label.x - w / 2, y: label.y - h / 2, width: w, height: h, rx: 4, fill: plateColor }),
    el('text', { x: label.x, y: y0, 'text-anchor': 'middle', 'font-size': L.labelFs, 'font-weight': 500, fill: textColor },
      lines.map((ln, i) => el('tspan', { x: label.x, dy: i === 0 ? 0 : lh }, esc(ln)))),
  ]);
}

/**
 * #28: a wrapped label drawn directly on its shape's own fill — no background
 * plate — for the labelPos="gap" collaboration case, where a plate over the
 * parallelogram reads as a sticker. The shape itself is sized to fit the text.
 */
function shapeLabelSVG(label, textColor) {
  if (!label) return '';
  const lines = label.lines && label.lines.length ? label.lines : [label.text];
  const lh = L.labelFs * L.lineH;
  const blockH = lines.length * lh;
  const y0 = label.y - blockH / 2 + lh * 0.78;
  return el('text', { x: label.x, y: y0, 'text-anchor': 'middle', 'font-size': L.labelFs, 'font-weight': 500, fill: textColor },
    lines.map((ln, i) => el('tspan', { x: label.x, dy: i === 0 ? 0 : lh }, esc(ln))));
}

function edgeSVG({ inter, inters, geo }, lay, T, prefix) {
  const A = lay.boxes[inter.from];
  const targets = (inters || [inter]).map((i) => lay.boxes[i.to].node.label).join(', ');
  const title = el('title', {}, esc(`${MODES[inter.mode].name}${inter.soon ? ' (expected soon)' : ''}: ${A.node.label} -> ${targets}${inter.label ? ` (${inter.label})` : ''}`));
  const parts = [title];
  const soon = inter.soon ? { opacity: 0.55, 'stroke-dasharray': '5 4' } : {};
  switch (geo.kind) {
    case 'wedge':
      parts.push(el('polygon', { points: pts(geo.points), fill: T.xaas.fill, stroke: inter.soon ? T.xaas.text : T.xaas.stroke, 'stroke-width': 1, 'stroke-linejoin': 'round', ...soon }));
      if (geo.leader) parts.push(el('line', { x1: geo.leader.x, y1: geo.leader.y1, x2: geo.leader.x, y2: geo.leader.y2, stroke: T.xaas.stroke, 'stroke-width': 1.5, 'stroke-dasharray': '3 3' }));
      parts.push(plateLabelSVG(geo.label, T.xaas.text, T.xaas.plate));
      break;
    case 'bridge':
      parts.push(el('polygon', { points: pts(geo.points), fill: T.collab.fill, stroke: T.collab.stroke, 'stroke-width': 1.5, 'stroke-linejoin': 'round', ...soon }));
      if (geo.leader) parts.push(el('line', { x1: geo.leader.x, y1: geo.leader.y1, x2: geo.leader.x, y2: geo.leader.y2, stroke: T.collab.stroke, 'stroke-width': 1.5, 'stroke-dasharray': '3 3' }));
      parts.push(geo.label && geo.label.onShape ? shapeLabelSVG(geo.label, T.collab.text) : plateLabelSVG(geo.label, T.collab.text, T.collab.plate));
      break;
    case 'patch':
      parts.push(el('rect', { x: geo.rect.x, y: geo.rect.y, width: geo.rect.w, height: geo.rect.h, fill: `url(#${prefix}-dots)`, stroke: inter.soon ? T.facil.dot : null, ...soon }));
      if (geo.leader) parts.push(el('line', { x1: geo.leader.x, y1: geo.leader.y1, x2: geo.leader.x, y2: geo.leader.y2, stroke: T.facil.dot, 'stroke-width': 1.5, 'stroke-dasharray': '3 3' }));
      parts.push(plateLabelSVG(geo.label, T.facil.text, T.facil.plate));
      break;
    case 'band':
      parts.push(el('polygon', { points: pts(geo.points), fill: `url(#${prefix}-dots)`, stroke: T.facil.dot, 'stroke-width': 1, 'stroke-dasharray': '2 3', opacity: inter.soon ? 0.55 : null }));
      if (geo.leader) parts.push(el('line', { x1: geo.leader.x, y1: geo.leader.y1, x2: geo.leader.x, y2: geo.leader.y2, stroke: T.facil.dot, 'stroke-width': 1.5, 'stroke-dasharray': '3 3' }));
      parts.push(plateLabelSVG(geo.label, T.facil.text, T.facil.plate));
      break;
  }
  return el('g', { class: `tt-edge tt-${inter.mode}` }, parts);
}

function flowSVG(f, T) {
  const y = f.y + 6, h = 22, tip = 18;
  const d = `M${num(f.x)},${num(y)} H${num(f.x + f.w - tip)} L${num(f.x + f.w)},${num(y + h / 2)} L${num(f.x + f.w - tip)},${num(y + h)} H${num(f.x)} Z`;
  return el('g', { class: 'tt-flow' }, [
    el('path', { d, fill: T.flow }),
    el('text', { x: f.x + f.w / 2, y: y + h / 2 + 4, 'text-anchor': 'middle', 'font-size': 11, 'letter-spacing': 1.5, fill: T.flowText }, esc(f.label.toUpperCase())),
  ]);
}

const LEGEND_ITEMS = [
  ['stream', 'Stream-aligned'], ['enabling', 'Enabling'], ['subsystem', 'Complicated subsystem'], ['platform', 'Platform'],
  ['collaboration', 'Collaboration'], ['xaas', 'X-as-a-Service'], ['facilitating', 'Facilitating'],
];
function legendWidth() {
  return LEGEND_ITEMS.reduce((w, [, label]) => w + 44 + textWidth(label, 11) + 22, 0) - 22;
}

function legendSVG(lg, T, prefix) {
  const parts = [];
  let x = lg.x;
  const y = lg.y + 10;
  for (const [key, label] of LEGEND_ITEMS) {
    const cy = y + 12;
    switch (key) {
      case 'stream': parts.push(el('rect', { x, y: y + 4, width: 36, height: 16, rx: 4, fill: T.stream.fill, stroke: T.stream.stroke, 'stroke-width': 1.5 })); break;
      case 'enabling': parts.push(el('rect', { x: x + 11, y: y - 2, width: 14, height: 28, rx: 4, fill: T.enabling.fill, stroke: T.enabling.stroke, 'stroke-width': 1.5 })); break;
      case 'subsystem': parts.push(el('path', { d: octagonPath(x + 2, y + 3, 32, 18, 5), fill: T.subsystem.fill, stroke: T.subsystem.stroke, 'stroke-width': 1.5 })); break;
      case 'platform': parts.push(el('rect', { x, y: y + 2, width: 36, height: 20, rx: 4, fill: T.platform.fill, stroke: T.platform.stroke, 'stroke-width': 1.5 })); break;
      case 'collaboration': parts.push(el('polygon', { points: pts([{ x: x + 6, y: y + 4 }, { x: x + 40, y: y + 4 }, { x: x + 32, y: y + 20 }, { x: x - 2, y: y + 20 }]), fill: T.collab.fill, stroke: T.collab.stroke, 'stroke-width': 1 })); break;
      case 'xaas': parts.push(el('polygon', { points: pts([{ x: x + 4, y: y + 22 }, { x: x + 32, y: y + 22 }, { x: x + 18, y: y - 2 }]), fill: T.xaas.fill, stroke: T.xaas.stroke, 'stroke-width': 1 })); break;
      case 'facilitating':
        parts.push(el('rect', { x: x + 2, y: y + 4, width: 32, height: 16, rx: 3, fill: T.stream.fill, stroke: T.stream.stroke, 'stroke-width': 1 }));
        parts.push(el('rect', { x: x + 12, y: y + 4, width: 12, height: 16, fill: `url(#${prefix}-dots)` }));
        break;
    }
    parts.push(el('text', { x: x + 44, y: cy + 4, 'font-size': 11, fill: T.muted }, esc(label)));
    x += 44 + textWidth(label, 11) + 22;
  }
  return el('g', { class: 'tt-legend' }, parts);
}

/**
 * Render diagram source (or a parsed model) to an SVG string.
 * opts: { theme: 'light'|'dark'|themeObject, legend: bool, idPrefix: string, fontFamily: string }
 */
export function render(input, opts = {}) {
  const model = typeof input === 'string' ? parse(input) : input;
  const lay = layout(model, opts);
  const T = typeof opts.theme === 'object' ? { ...THEMES.light, ...opts.theme } : (THEMES[opts.theme] || THEMES.light);
  const prefix = opts.idPrefix || 'tt';
  const font = opts.fontFamily || 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  const defs = el('defs', {}, [
    el('pattern', { id: `${prefix}-dots`, patternUnits: 'userSpaceOnUse', width: 7, height: 7 }, [
      el('rect', { width: 7, height: 7, fill: T.facil.fill }),
      el('circle', { cx: 3.5, cy: 3.5, r: 1.4, fill: T.facil.dot }),
    ]),
  ]);

  const boxes = Object.values(lay.boxes);
  const byKind = (k) => boxes.filter((b) => b.kind === k);
  const frames = byKind('frame').sort((a, b) => depth(model, a.node) - depth(model, b.node));
  const edgesOf = (mode) => lay.edges.filter((e) => e.inter.mode === mode).map((e) => edgeSVG(e, lay, T, prefix));

  const body = [
    el('rect', { width: lay.width, height: lay.height, fill: T.bg, class: 'tt-bg' }),
    lay.title ? el('text', { x: lay.title.x, y: lay.title.y, 'font-size': 18, 'font-weight': 700, fill: T.title }, esc(model.title)) : '',
    lay.flow ? flowSVG(lay.flow, T) : '',
    el('g', { class: 'tt-frames' }, frames.map((b) => frameSVG(b, T))),
    el('g', { class: 'tt-lanes' }, [...byKind('plat'), ...byKind('lane')].map((b) => teamSVG(b, T))),
    el('g', { class: 'tt-xaas' }, edgesOf('xaas')),
    el('g', { class: 'tt-overlays' }, [...byKind('sub').map((b) => teamSVG(b, T)), ...byKind('en').map((b) => teamSVG(b, T, 'shape'))]),
    el('g', { class: 'tt-facilitating' }, edgesOf('facilitating')),
    el('g', { class: 'tt-overlay-labels' }, byKind('en').map((b) => teamSVG(b, T, 'label'))),
    el('g', { class: 'tt-collaboration' }, edgesOf('collaboration')),
    lay.legend ? legendSVG(lay.legend, T, prefix) : '',
  ];

  return el('svg', {
    xmlns: 'http://www.w3.org/2000/svg', width: lay.width, height: lay.height,
    viewBox: `0 0 ${num(lay.width)} ${num(lay.height)}`, 'font-family': font, role: 'img',
    'aria-label': model.title || 'Team topology diagram', 'data-teamtopo': VERSION,
  }, [defs, ...body]);
}

// ───────────────────────── Team API ─────────────────────────
//
// Generates the Team API document from the TeamTopologies/Team-API-template
// (CC BY-SA 4.0). What the diagram knows is filled in: team type, platform
// membership, services provided, and the interaction tables. Everything else
// comes from an `api <id> { field: value }` block and stays blank otherwise.

const API_TYPE_NAMES = { stream: 'Stream-Aligned', enabling: 'Enabling', subsystem: 'Complicated Subsystem', platform: 'Platform', group: 'Group' };

/** Fields a team can set in its api block, with the spellings accepted for each. */
export const TEAM_API_FIELDS = [
  { key: 'focus',         aliases: ['focus', 'teamnameandfocus'] },
  { key: 'platform',      aliases: ['platform', 'partofaplatform', 'platformdetails'] },
  { key: 'service',       aliases: ['service', 'services', 'servicedetails', 'doweprovideaservicetootherteams'] },
  { key: 'sle',           aliases: ['sle', 'sles', 'servicelevel', 'servicelevelexpectations'] },
  { key: 'software',      aliases: ['software', 'softwareowned', 'softwareownedandevolvedbythisteam'] },
  { key: 'versioning',    aliases: ['versioning', 'versioningapproaches'] },
  { key: 'wiki',          aliases: ['wiki', 'wikisearchterms'] },
  { key: 'chat',          aliases: ['chat', 'channels', 'chattoolchannels'] },
  { key: 'sync',          aliases: ['sync', 'dailysync', 'timeofdailysyncmeeting'] },
  { key: 'workingon',     aliases: ['workingon', 'working', 'servicesandsystems', 'ourservicesandsystems'] },
  { key: 'waysofworking', aliases: ['waysofworking', 'ways'] },
  { key: 'improvements',  aliases: ['improvements', 'crossteamimprovements', 'widercrossteamororganisationalimprovements'] },
];

function apiField(node, key) {
  const spec = TEAM_API_FIELDS.find((f) => f.key === key);
  for (const a of spec.aliases) if (node.api && node.api[a] !== undefined) return node.api[a];
  return '';
}

function apiRow(model, self, inter) {
  const otherId = inter.from === self.id ? inter.to : inter.from;
  const other = model.index[otherId];
  const focus = apiField(other, 'focus');
  let mode = MODES[inter.mode].name;
  if (inter.mode === 'xaas') mode += inter.from === self.id ? ' (we provide)' : ' (we consume)';
  if (inter.mode === 'facilitating') mode += inter.from === self.id ? ' (we facilitate)' : ' (they facilitate us)';
  const cell = (v) => String(v || '').replace(/\|/g, '\\|');
  return `| ${cell(other.label)}${focus ? ` / ${cell(focus)}` : ''} | ${mode} | ${cell(inter.label)} | ${cell(inter.duration)} |`;
}

function apiTable(rows) {
  const head = '| Team name/focus | Interaction Mode | Purpose | Duration |\n| --------------- | ---------------- | ------- | -------- |';
  return rows.length ? `${head}\n${rows.join('\n')}` : `${head}\n| . |  |  |  |`;
}

/**
 * The Team API document for one team, as Markdown following the Team API template.
 * opts: { date: string }
 */
export function teamApi(input, id, opts = {}) {
  const model = typeof input === 'string' ? parse(input) : input;
  const node = model.index[id];
  if (!node) throw new Error(`unknown team "${id}"`);
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const yn = (cond) => (cond ? 'y' : 'n');

  const platformParent = (() => {
    let cur = node;
    while (cur.parent) { cur = model.index[cur.parent]; if (cur.type === 'platform') return cur; }
    return null;
  })();
  const platformDetails = [platformParent ? `part of ${platformParent.label}` : '', apiField(node, 'platform')].filter(Boolean).join('; ');

  const provided = model.interactions.filter((it) => it.mode === 'xaas' && it.from === node.id && !it.soon);
  const consumers = provided.map((it) => `${model.index[it.to].label}${it.label ? ` (${it.label})` : ''}`);
  const serviceDetails = [consumers.length ? `to ${consumers.join(', ')}` : '', apiField(node, 'service')].filter(Boolean).join('; ');

  const mine = model.interactions.filter((it) => it.from === node.id || it.to === node.id);
  const now = mine.filter((it) => !it.soon).map((it) => apiRow(model, node, it));
  const soon = mine.filter((it) => it.soon).map((it) => apiRow(model, node, it));
  const focus = apiField(node, 'focus');

  return [
    `# Team API: ${node.label}`,
    '',
    `Date: ${date}`,
    '',
    `* Team name and focus: ${node.label}${focus ? ` — ${focus}` : ''}`,
    `* Team type: ${API_TYPE_NAMES[node.type]}`,
    `* Part of a Platform? (y/n) Details: ${yn(platformParent || apiField(node, 'platform'))}${platformDetails ? ` — ${platformDetails}` : ''}`,
    `* Do we provide a service to other teams? (y/n) Details: ${yn(provided.length || apiField(node, 'service'))}${serviceDetails ? ` — ${serviceDetails}` : ''}`,
    `* What kind of Service Level Expectations do other teams have of us? ${apiField(node, 'sle')}`.trimEnd(),
    `* Software owned and evolved by this team: ${apiField(node, 'software')}`.trimEnd(),
    `* Versioning approaches: ${apiField(node, 'versioning')}`.trimEnd(),
    `* Wiki search terms: ${apiField(node, 'wiki')}`.trimEnd(),
    `* Chat tool channels: ${apiField(node, 'chat')}`.trimEnd(),
    `* Time of daily sync meeting: ${apiField(node, 'sync')}`.trimEnd(),
    '',
    '### What we\'re currently working on',
    '',
    `* Our services and systems: ${apiField(node, 'workingon')}`.trimEnd(),
    `* Ways of working: ${apiField(node, 'waysofworking')}`.trimEnd(),
    `* Wider cross-team or organisational improvements: ${apiField(node, 'improvements')}`.trimEnd(),
    '',
    '### Teams we currently interact with',
    '',
    apiTable(now),
    '',
    '### Teams we expect to interact with soon',
    '',
    apiTable(soon),
    '',
  ].join('\n');
}

/** Team API documents for every team in the diagram (groups excluded): [{ id, label, markdown }]. */
export function teamApis(input, opts = {}) {
  const model = typeof input === 'string' ? parse(input) : input;
  return model.teams.filter((t) => t.type !== 'group').map((t) => ({ id: t.id, label: t.label, markdown: teamApi(model, t.id, opts) }));
}

function depth(model, node) {
  let d = 0;
  while (node.parent) { d++; node = model.index[node.parent]; }
  return d;
}

export default { parse, layout, render, teamApi, teamApis, textWidth, wrapText, VERSION, THEMES, TEAM_TYPES, MODES, TEAM_API_FIELDS, ParseError };
