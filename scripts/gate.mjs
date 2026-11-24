// The seven gate rows of token-radar-01, run against out/ before a submission.
// `makefun grade-local` refuses this competition (program/v1: the scorer stays on the server),
// so this script mirrors the checks published in competition.yaml, row for row.
//
//   node scripts/gate.mjs
//
// It reads out/ (or --dir <path>) and the sealed snapshot in token-radar-01-kit/input/.

import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

const dir = process.argv.includes('--dir') ? process.argv[process.argv.indexOf('--dir') + 1] : 'out';
const snapshotPath = 'token-radar-01-kit/input/snapshot.json';
const failures = [];
const results = [];

function row(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures.push(name);
}

function walk(root) {
  const out = [];
  const rec = (at) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      const st = lstatSync(path);
      if (st.isDirectory()) rec(path);
      else out.push({ path, name, size: st.size, regular: st.isFile(), rel: relative(root, path) });
    }
  };
  rec(root);
  return out;
}

// ---------------------------------------------------------------- dashboard_files

const dashDir = join(dir, 'dashboard');
let dashFiles = [];
if (!existsSync(dashDir)) {
  row('dashboard_files', false, `${dashDir} does not exist`);
} else {
  dashFiles = walk(dashDir);
  const byName = new Map(dashFiles.map((f) => [f.path, f]));
  const hasIndex = dashFiles.some((f) => f.rel === 'index.html');
  const hasCss = dashFiles.some((f) => f.rel.endsWith('.css'));
  const hasJs = dashFiles.some((f) => f.rel.endsWith('.js'));
  const total = dashFiles.reduce((n, f) => n + f.size, 0);
  const plain = dashFiles.every((f) => f.regular && /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(f.name) && !f.rel.split(sep).some((part) => part.startsWith('.')));
  const network = [];
  const url = /https?:\/\//i;
  for (const f of dashFiles) {
    const text = readFileSync(f.path, 'utf8');
    if (f.rel.endsWith('.css') && url.test(text)) network.push(f.rel);
    if (f.rel.endsWith('.html')) {
      for (const m of text.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g)) {
        if (url.test(m[2])) network.push(`${f.rel} attribute ${m[1]}`);
      }
      for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
        if (url.test(m[1])) network.push(`${f.rel} style body`);
      }
    }
    if (f.rel.endsWith('.js')) {
      for (const m of text.matchAll(/(?:import\s*(?:[^'"]*?\sfrom\s*)?|export\s*[^'"]*?\sfrom\s*|require\s*\(|import\s*\()\s*['"]([^'"]+)['"]/g)) {
        if (url.test(m[1])) network.push(`${f.rel} import ${m[1]}`);
      }
    }
  }
  const ok = hasIndex && hasCss && hasJs && dashFiles.length <= 400 && total <= 4_194_304 && plain && network.length === 0;
  const why = [];
  if (!hasIndex) why.push('no index.html');
  if (!hasCss) why.push('no .css');
  if (!hasJs) why.push('no .js');
  if (dashFiles.length > 400) why.push(`${dashFiles.length} files`);
  if (total > 4_194_304) why.push(`${total} bytes`);
  if (!plain) why.push('a file is not plain or is in a dot directory');
  if (network.length) why.push(`network: ${network.slice(0, 3).join(', ')}`);
  row('dashboard_files', ok, ok ? `${dashFiles.length} files, ${total} bytes, no network address` : why.join('; '));
}

// ---------------------------------------------------------------- board_file / farm_steps

const boardPath = join(dir, 'board.json');
let snapshot = null;
if (existsSync(snapshotPath)) snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const slugs = new Set((snapshot?.protocols ?? []).map((p) => p.slug));
let rows = [];
let boardBytes = 0;
try {
  boardBytes = lstatSync(boardPath).size;
  const raw = JSON.parse(readFileSync(boardPath, 'utf8'));
  rows = Array.isArray(raw) ? raw : raw.rows;
  if (!Array.isArray(rows)) throw new Error('rows is not an array');
} catch (err) {
  row('board_file', false, `cannot read ${boardPath}: ${err.message}`);
}

const boardProblems = [];
if (rows.length < 100 || rows.length > 4000) boardProblems.push(`${rows.length} rows`);
if (boardBytes > 8 * 1024 * 1024) boardProblems.push(`${boardBytes} bytes`);
const seen = new Set();
for (const r of rows) {
  if (typeof r?.slug !== 'string' || !slugs.has(r.slug)) boardProblems.push(`slug ${r?.slug}`);
  else if (seen.has(r.slug)) boardProblems.push(`duplicate ${r.slug}`);
  seen.add(r?.slug);
  if (typeof r?.name !== 'string' || r.name.length === 0) boardProblems.push(`name ${r?.slug}`);
  if (!Number.isSafeInteger(r?.rank) || r.rank < 1) boardProblems.push(`rank ${r?.slug}`);
  if (!Number.isSafeInteger(r?.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 100_000_000_000_000) boardProblems.push(`implied ${r?.slug}`);
  if (!Array.isArray(r?.farm_steps)) boardProblems.push(`steps ${r?.slug}`);
}
if (rows.length >= 2 && new Set(rows.map((r) => r.implied_value_usd)).size === 1) boardProblems.push('every implied value is the same');
row('board_file', boardProblems.length === 0, boardProblems.length === 0 ? `${rows.length} rows, ${boardBytes} bytes` : boardProblems.slice(0, 5).join('; '));

const stepProblems = [];
for (const r of rows) {
  if (!Array.isArray(r?.farm_steps)) continue;
  if (r.farm_steps.length < 3 || r.farm_steps.length > 12) stepProblems.push(`${r.slug}: ${r.farm_steps.length} steps`);
  for (const s of r.farm_steps) {
    if (typeof s !== 'string') { stepProblems.push(`${r.slug}: a step is not a string`); continue; }
    const n = s.trim().length;
    if (n < 20 || n > 600) stepProblems.push(`${r.slug}: ${n} characters`);
  }
}
row('farm_steps', stepProblems.length === 0, stepProblems.length === 0 ? `${rows.length} rows, 3 to 12 steps each, 20 to 600 characters` : stepProblems.slice(0, 5).join('; '));

// ---------------------------------------------------------------- sorted_by_value

const sorted = rows.slice().sort((a, b) => a.rank - b.rank);
const rankProblems = [];
for (let i = 0; i < sorted.length; i++) if (sorted[i].rank !== i + 1) rankProblems.push(`rank ${i + 1} is ${sorted[i].rank}`);
for (let i = 1; i < sorted.length; i++) if (sorted[i].implied_value_usd > sorted[i - 1].implied_value_usd) rankProblems.push(`rank ${i + 1} outranks ${i}`);
row('sorted_by_value', rankProblems.length === 0, rankProblems.length === 0 ? 'ranks 1..N once each, implied value never rises' : rankProblems.slice(0, 5).join('; '));

// ---------------------------------------------------------------- coverage

const missing = (snapshot?.watchlist ?? []).filter((s) => !seen.has(s));
row('coverage', missing.length === 0, missing.length === 0 ? `${snapshot?.watchlist?.length ?? 0} / ${snapshot?.watchlist?.length ?? 0} watchlist slugs` : `missing: ${missing.slice(0, 5).join(', ')}`);

// ---------------------------------------------------------------- screenshots

function imageSize(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), whole: buf.subarray(0, 8).toString('latin1') === '\x89PNG\r\n\x1a\n' };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    let at = 2;
    while (at + 9 < buf.length) {
      if (buf[at] !== 0xff) { at++; continue; }
      const marker = buf[at + 1];
      if (marker === 0xff) { at++; continue; }
      if (marker === 0xd8 || marker === 0xd9) { at += 2; continue; }
      const len = buf.readUInt16BE(at + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { type: 'jpeg', width: buf.readUInt16BE(at + 7), height: buf.readUInt16BE(at + 5), whole: true };
      }
      at += 2 + len;
    }
    return { type: 'jpeg', width: 0, height: 0, whole: false };
  }
  return null;
}

const shotDir = join(dir, 'screenshots');
let shotProblems = [];
let shotDetail = '';
if (!existsSync(shotDir)) shotProblems.push('no screenshots/');
else {
  const shots = readdirSync(shotDir).filter((n) => !n.startsWith('.')).map((n) => {
    const path = join(shotDir, n);
    return { n, path, size: lstatSync(path).size };
  });
  shotDetail = `${shots.length} images`;
  if (shots.length < 3 || shots.length > 4) shotProblems.push(`${shots.length} images`);
  for (const s of shots) {
    if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(s.n)) shotProblems.push(`${s.n}: name`);
    if (s.size > 524_288) shotProblems.push(`${s.n}: ${s.size} bytes`);
    const dim = imageSize(readFileSync(s.path));
    if (dim === null) { shotProblems.push(`${s.n}: not PNG or JPEG`); continue; }
    if (!dim.whole) shotProblems.push(`${s.n}: not a whole image`);
    const long = Math.max(dim.width, dim.height);
    const short = Math.min(dim.width, dim.height);
    if (long > 1440) shotProblems.push(`${s.n}: long side ${long}`);
    if (short < 800) shotProblems.push(`${s.n}: short side ${short}`);
  }
  if (shots.length === 3) shotDetail += ', 3 required views';
}
row('screenshots', shotProblems.length === 0, shotProblems.length === 0 ? shotDetail : shotProblems.slice(0, 5).join('; '));

// ---------------------------------------------------------------- dossier_matches

let dossierOk = false;
let dossierDetail = '';
if (!existsSync(join(dir, 'dossier.json'))) {
  dossierDetail = 'no dossier.json';
} else {
  const got = readFileSync(join(dir, 'dossier.json'));
  const want = Buffer.from(buildDossier(dir, {
    text_max_bytes: 65_536,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }), 'utf8');
  const cut = want.includes('left out');
  dossierOk = got.equals(want) && got.length <= 1_572_864;
  dossierDetail = dossierOk
    ? `${got.length} bytes, byte for byte, source ${cut ? 'CUT' : 'whole'}`
    : `${got.length} bytes, does not match buildDossier (${want.length} bytes)${cut ? ', source cut' : ''}`;
}
row('dossier_matches', dossierOk, dossierDetail);

// ---------------------------------------------------------------- report

const width = Math.max(...results.map((r) => r.name.length));
process.stdout.write(`local gate for token-radar-01 (${dir})\n\n`);
for (const r of results) {
  process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.detail}\n`);
}
process.stdout.write(`\n${failures.length === 0 ? 'all seven gate rows pass' : failures.length + ' row(s) fail: ' + failures.join(', ')}\n`);
process.exit(failures.length === 0 ? 0 : 1);
