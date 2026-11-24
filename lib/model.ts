// Token Radar's model v2: a comparables model, not a name list.
//
// The snapshot carries live-token protocols beside the pre-token ones. Their market cap over
// TVL is the market's own multiple for a category, so the model borrows it instead of inventing
// one:
//
//   peer(category) = shrink( median(mcap_usd / tvl_usd of live protocols in the category),
//                            toward the all-live median, k = 4 ) clamped 0.05 .. 2.5
//   growth         = 1 + clamp(change_7d, -40, 80) / 100 * 0.45
//   maturity       = 0.75 + min(age_days, 1460) / 1460 * 0.25   (age unknown: 365 days)
//   implied        = round(tvl_usd * peer(category) * growth * maturity)
//
// Every input is a field the snapshot carries. No protocol name is special-cased in the value
// model: the per-name text in lib/plans.ts is the farm playbook, never a valuation.

import { PLAYBOOK, type PlanRecord } from './plans.ts';

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  peer_shrink_k: number;
  ratio_floor: number;
  ratio_cap: number;
  multiple_floor: number;
  multiple_cap: number;
  early_rows: number;
  live_rows: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.45,
  growth_floor: -40,
  growth_cap: 80,
  maturity_floor: 0.75,
  maturity_range: 0.25,
  maturity_days: 1460,
  unknown_age_days: 365,
  peer_shrink_k: 4,
  ratio_floor: 0.02,
  ratio_cap: 4,
  multiple_floor: 0.05,
  multiple_cap: 2.5,
  early_rows: 160,
  live_rows: 24,
};

export const MODEL_VERSION = 'radar-2-comparables';

/** One category's live-token multiple. */
export interface PeerStat {
  category: string;
  n: number;
  median: number;
  multiple: number;
}

/** The comparables the model reads: every live-token ratio, by category. */
export interface PeerModel {
  global_median: number;
  by_category: Record<string, PeerStat>;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_category: string;
    peer_count: number;
    category_median: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
    global_median: number;
  };
  venue: string;
  risk: string;
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  peer_multiple: number;
  peer_count: number;
  category_median: number;
  watchlist: boolean;
  venue: string;
  risk: string;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_median: number;
  watchlist_tvl_usd: number;
  board_tvl_usd: number;
  median_implied_usd: number;
  top_implied_usd: number;
  peers: PeerStat[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/**
 * The live-token comparables: the median mcap/TVL of every category with a live protocol, each
 * shrunk toward the all-live median so a category with one or two live tokens cannot set its own
 * multiple alone.
 */
export function peerModel(snapshot: Snapshot, model: ModelConstants = MODEL): PeerModel {
  const all: number[] = [];
  const byCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = clamp(p.mcap_usd / p.tvl_usd, model.ratio_floor, model.ratio_cap);
    all.push(ratio);
    if (p.category === null) continue;
    const list = byCategory.get(p.category);
    if (list === undefined) byCategory.set(p.category, [ratio]);
    else list.push(ratio);
  }
  const global = all.length > 0 ? median(all) : 0.2;
  const out: Record<string, PeerStat> = {};
  for (const [category, list] of byCategory) {
    const n = list.length;
    const med = median(list);
    const shrunk = (n * med + model.peer_shrink_k * global) / (n + model.peer_shrink_k);
    out[category] = {
      category,
      n,
      median: round4(med),
      multiple: round4(clamp(shrunk, model.multiple_floor, model.multiple_cap)),
    };
  }
  return { global_median: round4(global), by_category: out };
}

/** The peer stat a category reads; an unknown category reads the all-live median. */
function statFor(peers: PeerModel, category: string | null, model: ModelConstants): PeerStat {
  if (category !== null) {
    const direct = peers.by_category[category];
    if (direct !== undefined) return direct;
  }
  return {
    category: category ?? 'Other',
    n: 0,
    median: peers.global_median,
    multiple: round4(clamp(peers.global_median, model.multiple_floor, model.multiple_cap)),
  };
}

/** The growth, maturity and peer multipliers, and the implied value, one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  peers: PeerModel,
): { implied: number; stat: PeerStat; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const stat = statFor(peers, protocol.category, model);
  const growthPct = clamp(finite(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (clamp(ageForModel, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const raw = protocol.tvl_usd * stat.multiple * growthMult * maturityMult;
  const implied = Math.max(1, Math.min(100_000_000_000_000, Math.round(raw)));
  return { implied, stat, growthPct, growthMult, maturityMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const peers = peerModel(snapshot, model);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the floor, by TVL, capped.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, model.early_rows);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, model, peers) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const watchlist = new Set(snapshot.watchlist);
  return scored.map((s, i) => {
    const plan = PLAYBOOK[s.p.slug];
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        peer_multiple: s.stat.multiple,
        peer_category: s.stat.category,
        peer_count: s.stat.n,
        category_median: s.stat.median,
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        age_days: s.age,
        global_median: peers.global_median,
      },
      venue: plan?.venue ?? `${s.p.category ?? 'Protocol'} market`,
      risk: plan?.risk ?? 'Read the protocol own terms and the exit path before depositing.',
      farm_steps: farmSteps(s.p, s.age, watchlist.has(s.p.slug)),
    };
  });
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 2_000_000_000) return 250;
  if (p.tvl_usd >= 500_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** A rough one-transaction gas cost, by the first chain the protocol names. */
const GAS: Record<string, number> = {
  Ethereum: 6,
  Bitcoin: 3,
  Binance: 0.5,
  'BNB Chain': 0.5,
  Base: 0.4,
  Arbitrum: 0.5,
  Optimism: 0.5,
  Solana: 0.1,
  Tron: 1,
  Monad: 0.1,
  Sui: 0.1,
  Ink: 0.1,
  Flare: 0.1,
  Avalanche: 0.3,
  Algorand: 0.01,
  Bittensor: 0.2,
  Stellar: 0.02,
  Polygon: 0.1,
  Plasma: 0.1,
  Pharos: 0.1,
  Mezo: 0.2,
  CORE: 0.2,
  'Babylon Genesis': 0.5,
  'B2 Network': 0.5,
  BSquared: 0.5,
  Arc: 0.2,
  Noble: 0.1,
};

function gasFor(chain: string): number {
  return GAS[chain] ?? 0.5;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function fill(text: string, capital: number, chain: string, name: string): string {
  return text.replaceAll('{capital}', `$${capital}`).replaceAll('{chain}', chain).replaceAll('{name}', name);
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The playbook gives the
 * venue and the specific move for the 40 watchlist protocols; a row below the floor gets a plan
 * derived from its category, chain and TVL. The same function writes board.json and the page.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, onWatchlist = false): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const gas = gasFor(chain);
  const hold = holdDaysFor(age);
  const record: PlanRecord | undefined = PLAYBOOK[p.slug];
  const category = (p.category ?? 'protocol').toLowerCase();
  const setup = record !== undefined
    ? fill(record.setup, capital, chain, p.name)
    : `Deposit $${capital} USDC into ${p.name}'s main ${category} market on ${chain} and keep the receipt in the same wallet.`;
  const qualifying = record !== undefined
    ? fill(record.qualifying, capital, chain, p.name)
    : `Add a $25 second position, or make one borrow, swap or vote in ${p.name}, so the wallet records more than one action.`;
  const watch = record !== undefined
    ? fill(record.watch, capital, chain, p.name)
    : `Read ${p.name}'s own risk and rewards page weekly and claim only there; never from a link sent to the wallet.`;
  const asset = record?.asset ?? 'USDC';
  const fund = record?.fund !== undefined
    ? fill(record.fund, capital, chain, p.name)
    : `Fund a dedicated ${chain} wallet with $${capital} ${asset} and about $${round4(gas * 2)} for gas, and keep its seed phrase offline.`;
  const steps: FarmStep[] = [
    {
      text: fund,
      cost: `$${capital} of ${asset} + about $${round4(gas * 2)} of gas`,
      time: '10 minutes',
    },
    {
      text: setup,
      cost: `$${capital} of ${asset} deployed + about $${round4(gas)} of gas`,
      time: '15 minutes',
    },
    {
      text: qualifying,
      cost: `$25 to $50 extra + about $${round4(gas)} of gas`,
      time: '10 minutes',
    },
    {
      text: watch,
      cost: `free to read, about $${round4(gas)} when you act`,
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days and make one small qualifying action every 7 days, so the wallet lands in several of the protocol's snapshots.`,
      cost: `the $${capital} stays at work, about $${round4(gas * 4)} over ${hold} days`,
      time: `${hold} days`,
    },
    {
      text: onWatchlist
        ? `Before withdrawing, claim rewards only on the protocol's own page and never from a direct message; unwind, then write the dates and transaction hashes in a farm log.`
        : `Before withdrawing, check the protocol's own exit route and fees; unwind, then write the dates and transaction hashes in a farm log so the position can be repeated.`,
      cost: 'one or two withdrawal fees, no claim fee',
      time: '20 minutes',
    },
  ];
  return steps.map(stepText);
}

/** The live-token protocols, by market cap, for the dashboard's live view. */
export function liveRows(snapshot: Snapshot, model: ModelConstants = MODEL): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, model.live_rows)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    peer_multiple: row.model.peer_multiple,
    peer_count: row.model.peer_count,
    category_median: row.model.category_median,
    watchlist: watchlist.has(row.slug),
    venue: row.venue,
    risk: row.risk,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const peers = peerModel(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const watchRows = board.filter((r) => watchlist.has(r.slug));
  const implied = watchRows.map((r) => r.implied_value_usd).sort((a, b) => a - b);
  const mid = implied.length === 0 ? 0 : implied[Math.floor((implied.length - 1) / 2)]!;
  const used = new Set(board.map((r) => r.model.peer_category));
  const peerTable = [...used]
    .map((c) => peers.by_category[c] ?? {
      category: c,
      n: 0,
      median: peers.global_median,
      multiple: round4(clamp(peers.global_median, model.multiple_floor, model.multiple_cap)),
    })
    .sort((a, b) => b.n - a.n || a.category.localeCompare(b.category));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watchlist.has(r.slug)).length,
    live_size: liveRows(snapshot, model).length,
    global_median: peers.global_median,
    watchlist_tvl_usd: watchRows.reduce((sum, r) => sum + r.tvl_usd, 0),
    board_tvl_usd: board.reduce((sum, r) => sum + r.tvl_usd, 0),
    median_implied_usd: mid,
    top_implied_usd: board[0]?.implied_value_usd ?? 0,
    peers: peerTable,
    rows: board.map((r) => radarRow(r, watchlist)),
    live: liveRows(snapshot, model),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
