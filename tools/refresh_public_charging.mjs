#!/usr/bin/env node
/**
 * Refresh public_charging_ni.json from charge point operators' open data feeds.
 *
 * Under the Public Charge Point Regulations 2023 (which extend to Northern Ireland)
 * operators must publish reference data — including price — free of charge, in a
 * machine readable format, with no terms and conditions attached. In practice that
 * means an OCPI 2.2.1 endpoint. Where an operator has given us the URL of theirs,
 * we put it in the operator's `open_data.ocpi_versions_url` and this script pulls
 * the current per-kWh prices from it.
 *
 * Operators with no usable feed are left exactly as they are, so hand-checked rows
 * survive a run. Nothing is invented: if a feed can't be read, the run says so and
 * moves on.
 *
 *   node tools/refresh_public_charging.mjs [--dry-run] [--only=esb-ecars]
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(HERE, '..', 'public_charging_ni.json');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY = (args.find(a => a.startsWith('--only=')) || '').split('=')[1] || null;
const TIMEOUT_MS = 20000;
const USER_AGENT = 'EVANI-public-charging-refresh/1.0 (+https://evani.uk)';

const log = (...a) => console.log(...a);
const warn = (...a) => console.warn('  !', ...a);

async function getJson(url, token) {
  const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT };
  if (token) headers.Authorization = `Token ${token}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

/** OCPI wraps payloads as { data, status_code, ... }; some feeds return the array bare. */
function unwrap(body) {
  if (body && typeof body === 'object' && 'data' in body) return body.data;
  return body;
}

/** versions document -> the URL of the newest version we understand */
function pickVersion(versions) {
  const supported = ['2.3.0', '2.2.1', '2.2', '2.1.1'];
  for (const want of supported) {
    const hit = (versions || []).find(v => v.version === want);
    if (hit) return { version: hit.version, url: hit.url };
  }
  return null;
}

function findEndpoint(endpoints, identifier) {
  return (endpoints || []).find(e =>
    e.identifier === identifier && (!e.role || e.role === 'CPO' || e.role === 'SENDER')
  );
}

/** Walk an OCPI list endpoint, following the Link header until it runs out. */
async function fetchPaged(url, token, cap = 20) {
  const out = [];
  let next = url;
  for (let page = 0; next && page < cap; page++) {
    const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT };
    if (token) headers.Authorization = `Token ${token}`;
    const res = await fetch(next, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${next}`);
    const items = unwrap(await res.json());
    if (Array.isArray(items)) out.push(...items); else break;
    const link = res.headers.get('link') || '';
    const m = link.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    next = m ? m[1] : null;
  }
  return out;
}

const BANDS = [
  { band: 'ac', max: 22 },
  { band: 'fast', max: 49 },
  { band: 'rapid', max: 149 },
  { band: 'ultra', max: Infinity }
];

function bandFromPower(kw) {
  if (typeof kw !== 'number' || !isFinite(kw) || kw <= 0) return null;
  return (BANDS.find(b => kw <= b.max) || BANDS[BANDS.length - 1]).band;
}

/** OCPI tariff `type` maps loosely onto how a driver actually pays. */
function accessFromTariffType(type) {
  if (type === 'AD_HOC_PAYMENT') return 'contactless';
  if (type === 'PROFILE_CHEAP' || type === 'PROFILE_FAST' || type === 'PROFILE_GREEN') return 'subscription';
  return 'payg_app';
}

/**
 * Pull the per-kWh energy price out of an OCPI tariff.
 * price_component.price is excluding VAT; `vat` is the percentage to add.
 * Returns pence per kWh including VAT, or null if the tariff has no energy element.
 */
function energyPriceP(tariff) {
  const currency = (tariff.currency || 'GBP').toUpperCase();
  if (currency !== 'GBP') return null;

  let best = null;
  for (const el of tariff.elements || []) {
    for (const pc of el.price_components || []) {
      if (pc.type !== 'ENERGY') continue;
      if (typeof pc.price !== 'number') continue;
      const vat = typeof pc.vat === 'number' ? pc.vat : 0;
      const pence = pc.price * (1 + vat / 100) * 100;
      const maxPower = el.restrictions?.max_power ?? el.restrictions?.min_power ?? null;
      const cand = { pence, band: bandFromPower(maxPower) };
      // Prefer the unrestricted element; it's the headline rate a driver sees.
      if (best === null || (best.band !== null && cand.band === null)) best = cand;
    }
  }
  if (!best) return null;
  return { pence: Math.round(best.pence * 10) / 10, band: best.band };
}

function tariffLabel(tariff, band) {
  const name = (tariff.tariff_alt_text || []).find(t => t.text)?.text;
  if (name) return name.slice(0, 60);
  const byBand = { ac: 'AC, up to 22 kW', fast: 'Fast, 23–49 kW', rapid: 'Rapid, 50–149 kW', ultra: 'Ultra rapid, 150 kW+' };
  return byBand[band] || 'Standard rate';
}

async function refreshOperator(op, today) {
  const feed = op.open_data || {};
  if (!feed.ocpi_versions_url) {
    log(`  – ${op.name}: no open data endpoint on file, leaving as is`);
    return false;
  }

  const token = feed.token_env && process.env[feed.token_env] ? process.env[feed.token_env] : null;
  if (feed.auth_required && !token) {
    warn(`${op.name}: feed needs a token and ${feed.token_env || 'none'} is not set, leaving as is`);
    return false;
  }

  const versions = unwrap(await getJson(feed.ocpi_versions_url, token));
  const chosen = pickVersion(versions);
  if (!chosen) throw new Error('no OCPI version we understand');

  const details = unwrap(await getJson(chosen.url, token));
  const tariffsEp = findEndpoint(details.endpoints, 'tariffs');
  if (!tariffsEp) throw new Error(`OCPI ${chosen.version} feed exposes no tariffs module`);

  const tariffs = await fetchPaged(tariffsEp.url, token);
  const rows = [];
  for (const t of tariffs) {
    const priced = energyPriceP(t);
    if (!priced) continue;
    const band = priced.band || null;
    const access = accessFromTariffType(t.type);
    const key = `${band}|${access}`;
    if (rows.some(r => `${r.band}|${r.access}` === key)) continue;
    rows.push({
      label: tariffLabel(t, band),
      band,
      access,
      price_p_per_kwh: priced.pence,
      confidence: 'api'
    });
  }

  if (rows.length === 0) throw new Error('tariffs module returned nothing priceable in GBP');

  rows.sort((a, b) => a.price_p_per_kwh - b.price_p_per_kwh);
  op.tariffs = rows;
  op.source_type = 'api';
  op.source_url = feed.ocpi_versions_url;
  op.confidence = 'api';
  op.verified_on = today;
  op.open_data.status = 'open';
  log(`  ✓ ${op.name}: ${rows.length} rate${rows.length === 1 ? '' : 's'} from OCPI ${chosen.version}`);
  return true;
}

async function main() {
  const raw = await readFile(DATA_FILE, 'utf8');
  const data = JSON.parse(raw);
  const today = new Date().toISOString().slice(0, 10);

  let changed = 0;
  let failed = 0;

  log(`Refreshing ${data.operators.length} operators…`);
  for (const op of data.operators) {
    if (ONLY && op.id !== ONLY) continue;
    try {
      if (await refreshOperator(op, today)) changed++;
    } catch (err) {
      failed++;
      warn(`${op.name}: ${err.message}`);
    }
  }

  if (changed === 0) {
    log(`\nNothing to update (${failed} feed${failed === 1 ? '' : 's'} errored). File left untouched.`);
    return;
  }

  data.last_updated = today;
  data.last_updated_display = new Date(today + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  });

  const next = JSON.stringify(data, null, 2) + '\n';
  if (DRY_RUN) {
    log(`\nDry run: ${changed} operator${changed === 1 ? '' : 's'} would change, ${failed} errored.`);
    return;
  }
  await writeFile(DATA_FILE, next);
  log(`\nUpdated ${changed} operator${changed === 1 ? '' : 's'}, ${failed} errored.`);
}

main().catch(err => {
  console.error('Refresh failed:', err);
  process.exit(1);
});
