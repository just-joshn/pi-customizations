const MOVE_MIN_LINES = 3;
const MOVE_MAX_RUN = 40;
const MOVE_MATCH_RATIO = 0.7;

function toggle(hdr) {
  const b = hdr.nextElementSibling;
  const c = hdr.querySelector('.chev');
  b.classList.toggle('open');
  c.classList.toggle('open');
}
function toggleBP(hdr) {
  toggle(hdr);
}

function isImport(line) {
  const s = line.replace(/^[+ -]/, '').trim();
  return s.startsWith('import ') || s.startsWith('import{') || s.startsWith('} from ');
}

function isWhitespaceOnly(del, add) {
  return del.replace(/^-/, '').replace(/\s/g, '') === add.replace(/^\+/, '').replace(/\s/g, '');
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function normWs(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function toLines(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') return input.split('\n');
  return [];
}

/* Diff payload is a plain object assigned by template.html: window.__PR_DIFFS__ = {...}. */
function loadPrDiffs() {
  const diffs = window.__PR_DIFFS__;
  if (!diffs || typeof diffs !== 'object' || Array.isArray(diffs)) return null;
  return diffs;
}

function setHtml(el, html) {
  el.replaceChildren();
  el.insertAdjacentHTML('afterbegin', html);
}

function isFileHeader(l) {
  return l.startsWith('--- ') || l.startsWith('+++ ') || l.startsWith('diff ');
}

function collectRun(items, start, used) {
  const end = items.findIndex(function(item, idx) {
    return idx > start && (idx - start >= MOVE_MAX_RUN || !item.consecutive || used[idx]);
  });
  const stop = end === -1 ? items.length : end;
  return items.slice(start, stop).map(function(_, k) { return start + k; });
}

function findAddMatch(adds, ma, dn) {
  for (let ai = 0; ai < adds.length; ai++) {
    if (ma[ai]) continue;
    const ab = collectRun(adds, ai, ma);
    if (ab.length < MOVE_MIN_LINES) continue;
    const an = ab.map(function(i) { return normWs(adds[i].code); });
    const ml = Math.min(dn.length, an.length);
    const mc = Array.from({ length: ml }, function(_, m) { return dn[m] === an[m]; })
      .filter(Boolean).length;
    if (mc >= MOVE_MIN_LINES && mc >= ml * MOVE_MATCH_RATIO) return { ab: ab, an: an, ml: ml };
  }
  return null;
}

function markMoved(map, indices, flags) {
  const entries = flags.map(function(exact, k) { return [indices[k], { exact: exact }]; });
  return { ...map, ...Object.fromEntries(entries) };
}

function detectMoves(dels, adds) {
  let md = {};
  let ma = {};
  for (let di = 0; di < dels.length; di++) {
    if (md[di]) continue;
    const db = collectRun(dels, di, md);
    if (db.length < MOVE_MIN_LINES) continue;
    const dn = db.map(function(i) { return normWs(dels[i].code); });
    const hit = findAddMatch(adds, ma, dn);
    if (!hit) continue;
    const flags = Array.from({ length: hit.ml }, function(_, k) { return dn[k] === hit.an[k]; });
    md = markMoved(md, db, flags);
    ma = markMoved(ma, hit.ab, flags);
  }
  return { movedDels: md, movedAdds: ma };
}

function takeWhilePrefix(lines, start, prefix) {
  const end = lines.findIndex(function(l, i) { return i >= start && !l.startsWith(prefix); });
  return lines.slice(start, end === -1 ? lines.length : end);
}

/* A '-' run followed by an equally long '+' run that differs only by whitespace. */
function readWhitespaceRun(lines, i) {
  if (!lines[i].startsWith('-')) return null;
  const dr = takeWhilePrefix(lines, i, '-');
  const ar = takeWhilePrefix(lines, i + dr.length, '+');
  const same = dr.length === ar.length && dr.every(function(d, k) { return isWhitespaceOnly(d, ar[k]); });
  return same ? { adds: ar, next: i + dr.length + ar.length } : null;
}

function collapseWhitespaceRuns(lines) {
  let out = [];
  let i = 0;
  while (i < lines.length) {
    const run = readWhitespaceRun(lines, i);
    if (run) {
      out = out.concat(run.adds.map(function(a) { return ' ' + a.slice(1); }));
      i = run.next;
    } else {
      out = out.concat([lines[i]]);
      i++;
    }
  }
  return out;
}

function parseHunk(state, line) {
  const hm = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
  const oL = hm ? parseInt(hm[1]) : state.oL;
  const nL = hm ? parseInt(hm[2]) : state.nL;
  return { oL: oL, nL: nL, pD: false, pA: false, parsed: state.parsed.concat([{ type: 'hunk', text: line }]) };
}

function parseLine(state, line) {
  if (isFileHeader(line)) return state;
  if (line.startsWith('@@')) return parseHunk(state, line);
  const idx = state.parsed.length;
  if (line.startsWith('+')) {
    const ae = { type: 'add', code: line.slice(1), newLine: state.nL, consecutive: state.pA, idx: idx };
    return { ...state, nL: state.nL + 1, pA: true, pD: false, parsed: state.parsed.concat([ae]) };
  }
  if (line.startsWith('-')) {
    const de = { type: 'del', code: line.slice(1), oldLine: state.oL, consecutive: state.pD, idx: idx };
    return { ...state, oL: state.oL + 1, pD: true, pA: false, parsed: state.parsed.concat([de]) };
  }
  const code = line.startsWith(' ') ? line.slice(1) : line;
  const ctx = { type: 'ctx', code: code, oldLine: state.oL, newLine: state.nL };
  return { oL: state.oL + 1, nL: state.nL + 1, pD: false, pA: false, parsed: state.parsed.concat([ctx]) };
}

function parseDiff(lines) {
  const init = { oL: 0, nL: 0, pD: false, pA: false, parsed: [] };
  return lines.reduce(parseLine, init).parsed;
}

function movedClass(moved, base) {
  if (!moved) return 'diff-' + base;
  return 'diff-moved-' + base + (moved.exact ? '' : '-edited');
}

function row(cls, oldCell, newCell, code) {
  return '<tr class="' + cls + '"><td class="diff-ln">' + oldCell + '</td><td class="diff-ln">' + newCell +
    '</td><td class="diff-code">' + esc(code) + '</td></tr>';
}

function rowHtml(p, ctx) {
  if (p.type === 'hunk') return row('diff-hunk', '', '', p.text);
  if (p.type === 'add') {
    return row(movedClass(ctx.mv.movedAdds[ctx.adds.indexOf(p)], 'add'), '', p.newLine, p.code);
  }
  if (p.type === 'del') {
    return row(movedClass(ctx.mv.movedDels[ctx.dels.indexOf(p)], 'del'), p.oldLine, '', p.code);
  }
  return row('diff-ctx', p.oldLine, p.newLine, p.code);
}

function resolveTarget(target) {
  if (typeof target === 'string') return document.getElementById(target) || document.querySelector(target);
  return target;
}

function buildTable(lines) {
  const filtered = lines.filter(function(l) {
    return l.startsWith('--- ') || l.startsWith('+++ ') || l.startsWith('@@') || l.startsWith('diff ') || !isImport(l);
  });
  const parsed = parseDiff(collapseWhitespaceRuns(filtered));
  const adds = parsed.filter(function(p) { return p.type === 'add'; });
  const dels = parsed.filter(function(p) { return p.type === 'del'; });
  const ctx = { mv: detectMoves(dels, adds), adds: adds, dels: dels };
  const rows = parsed.map(function(p) { return rowHtml(p, ctx); });
  return '<table class="diff-table"><tbody>' + rows.join('') + '</tbody></table>';
}

/**
 * renderDiff(target, diffInput)
 *   target: DOM element, string ID, or CSS selector
 *   diffInput: array of diff lines, OR a single string (will be split on \n)
 */
function renderDiff(target, diffInput) {
  const el = resolveTarget(target);
  if (!el) return;
  const lines = toLines(diffInput);
  if (!lines.length) {
    setHtml(el, '<div style="padding:12px;color:#777;font-size:12px;">No diff data</div>');
    return;
  }
  setHtml(el, buildTable(lines));
}

/* Auto-discovery: after DOM loads, find all [data-diff] elements and render diffs from window.__PR_DIFFS__. */
document.addEventListener('DOMContentLoaded', function() {
  const prDiffs = loadPrDiffs();
  if (!prDiffs) return;
  document.querySelectorAll('[data-diff]').forEach(function(el) {
    const key = el.getAttribute('data-diff');
    if (key && Object.prototype.hasOwnProperty.call(prDiffs, key)) renderDiff(el, prDiffs[key]);
  });
});
