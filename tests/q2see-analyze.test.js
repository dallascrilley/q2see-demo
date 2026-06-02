import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseCsv, rowsToDataset, detectFindings, buildEdges, analyze } from '../functions/q2see/analyze.js';

const here = dirname(fileURLToPath(import.meta.url));
const sampleCsv = readFileSync(join(here, '../public/q2see/sample-q2c-export.csv'), 'utf8');

// Anchor "today" so overdue / days-until math is deterministic across machines.
const AS_OF = '2026-06-04';

test('parseCsv handles quoted fields with embedded commas', () => {
  const rows = parseCsv('a,b\n"Orion Payments, Inc.",10\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].a, 'Orion Payments, Inc.');
  assert.equal(rows[0].b, '10');
});

test('parseCsv is synonym/case tolerant on headers and skips blank lines', () => {
  const rows = parseCsv('Opportunity ID,ARR\n\nOPP-1,1000\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].opportunity_id, 'OPP-1');
  assert.equal(rows[0].arr, '1000');
});

test('rowsToDataset only emits lifecycle objects that have an id', () => {
  const ds = rowsToDataset(parseCsv(sampleCsv));
  assert.equal(ds.opportunities.length, 8);
  // Brightwave (row 4) has a quote but no contract/invoice/renewal.
  assert.ok(ds.quotes.find((q) => q.id === 'Q-902'));
  assert.equal(ds.contracts.find((c) => c.opportunity_id === 'OPP-7704'), undefined);
  // Crestline contract exists but its invoice does not.
  assert.ok(ds.contracts.find((c) => c.id === 'C-1042'));
  assert.equal(ds.invoices.find((i) => i.contract_id === 'C-1042'), undefined);
});

test('detectFindings surfaces exactly the six planted broken handoffs', () => {
  const ds = rowsToDataset(parseCsv(sampleCsv));
  const findings = detectFindings(ds, AS_OF);
  const byType = (t) => findings.filter((f) => f.type === t);

  assert.equal(byType('orphaned_contract').length, 1, 'Crestline: executed contract, no invoice');
  assert.equal(byType('amount_mismatch').length, 1, 'Orion: $24k invoice on $26.4k quote');
  assert.equal(byType('currency_mismatch').length, 1, 'Halfmoon: CAD invoice on USD quote');
  assert.equal(byType('orphaned_quote').length, 1, 'Brightwave: accepted quote, no contract');
  assert.equal(byType('missing_renewal_owner').length, 1, 'Northwind: null renewal owner');
  assert.equal(byType('term_gap').length, 1, 'Pinnacle: overdue unpaid invoice');

  assert.equal(findings.filter((f) => f.severity === 'critical').length, 2);
});

test('detectFindings does not flag the two clean deals', () => {
  const ds = rowsToDataset(parseCsv(sampleCsv));
  const findings = detectFindings(ds, AS_OF);
  const flagged = new Set(findings.flatMap((f) => f.affected_ids));
  for (const id of ['OPP-7707', 'C-1065', 'INV-2230', 'OPP-7708', 'C-1070', 'INV-2240']) {
    assert.equal(flagged.has(id), false, `${id} should be healthy`);
  }
});

test('overdue and days-until math is anchored to asOf', () => {
  const ds = rowsToDataset(parseCsv(sampleCsv));
  detectFindings(ds, AS_OF);
  const overdue = ds.invoices.find((i) => i.id === 'INV-2210');
  assert.equal(overdue.days_overdue, 45); // 2026-04-20 → 2026-06-04
  const paid = ds.invoices.find((i) => i.id === 'INV-2240');
  assert.equal(paid.days_overdue, 0, 'paid invoice is never overdue');
  const ren = ds.renewals.find((r) => r.id === 'REN-457');
  assert.equal(ren.days_until_renewal, 16); // 2026-06-04 → 2026-06-20
});

test('orphaned_contract finding carries a ghost invoice marker for the graph', () => {
  const ds = rowsToDataset(parseCsv(sampleCsv));
  const findings = detectFindings(ds, AS_OF);
  const orphan = findings.find((f) => f.type === 'orphaned_contract');
  assert.equal(orphan.ghost.type, 'invoice');
  assert.equal(orphan.ghost.for_contract, 'C-1042');
  assert.equal(orphan.ghost.arr_usd, 48000);
});

test('buildEdges colors a downstream-of-broken edge as broken', () => {
  const ds = rowsToDataset(parseCsv(sampleCsv));
  const findings = detectFindings(ds, AS_OF);
  const edges = buildEdges(ds, findings);
  // OPP-7701 → Q-771 → C-1042 chain is part of the orphaned_contract finding.
  const e = edges.find((x) => x.to_id === 'C-1042');
  assert.equal(e.status, 'broken');
  assert.ok(e.finding_id);
});

test('analyze accepts raw CSV and returns a client-ready dataset', () => {
  const out = analyze(sampleCsv, AS_OF);
  assert.equal(out.source, 'uploaded');
  assert.equal(out.inputFormat, 'csv');
  assert.equal(out.stats.findings, 6);
  assert.equal(out.stats.critical, 2);
  // internal scratch fields must not leak to the client
  assert.equal('_due_at' in out.invoices[0], false);
  assert.equal('_paid' in out.invoices[0], false);
});

test('analyze accepts a canonical JSON dataset too', () => {
  const csvOut = analyze(sampleCsv, AS_OF);
  const jsonOut = analyze(JSON.stringify({
    opportunities: csvOut.opportunities,
    quotes: csvOut.quotes,
    contracts: csvOut.contracts,
    invoices: csvOut.invoices,
    renewals: csvOut.renewals,
  }), AS_OF);
  assert.equal(jsonOut.inputFormat, 'json-dataset');
  assert.equal(jsonOut.stats.findings, 6);
});

test('analyze rejects empty and malformed input', () => {
  assert.throws(() => analyze(''), /Upload a CSV/);
  assert.throws(() => analyze('{ not json'), /does not parse/);
  assert.throws(() => analyze('just one line no header'), /Could not parse/);
});
