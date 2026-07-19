/**
 * Q2See — server-side Quote-to-Cash analyzer (Cloudflare Pages Function).
 *
 * Accepts a real CRM/billing export — a single flattened CSV (one row per
 * opportunity, lifecycle columns inline) or a canonical JSON DataSet — and
 * computes the contract→quote→invoice→renewal flow graph plus broken-handoff
 * findings ENTIRELY from the uploaded rows. No synthetic data, no secrets, no
 * third-party OAuth: you paste/upload your own export, the server parses and
 * inspects it, and hands back the same DataSet shape the client renders.
 *
 * Honest boundary: this analyzes an uploaded export (a point-in-time snapshot),
 * not a live CRM connection. The detection rules are real; the data is yours.
 *
 * The pure helpers below are exported so they can be unit-tested without a
 * network or a Workers runtime (see ../../tests/q2see-analyze.test.js).
 */

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...init.headers,
    },
    ...init,
  });
}

// ─── CSV parsing ──────────────────────────────────────────────────────────────

/** RFC-4180-ish CSV parser: handles quoted fields, embedded commas, and "" escapes. */
export function parseCsv(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((c) => c.trim() !== '')) rows.push(row); }
  if (rows.length < 2) return [];

  const header = rows[0].map((h) => normalizeKey(h));
  return rows.slice(1).map((cells) => {
    const obj = {};
    header.forEach((key, idx) => { if (key) obj[key] = (cells[idx] ?? '').trim(); });
    return obj;
  });
}

function normalizeKey(raw) {
  return String(raw || '').trim().toLowerCase().replace(/[\s\-./]+/g, '_').replace(/[^\w]/g, '');
}

/** Pull the first present value among a list of synonym column names. */
function pick(rowObj, ...keys) {
  for (const key of keys) {
    const v = rowObj[key];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function num(value) {
  if (value === undefined || value === null) return 0;
  const n = Number.parseFloat(String(value).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function nullableDate(value) {
  const v = String(value || '').trim();
  return v ? v : null;
}

function daysBetween(fromIso, toIso) {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

// ─── Row → canonical objects ────────────────────────────────────────────────────

/**
 * Convert flattened CRM-export rows (one row per opportunity, lifecycle columns
 * inline) into the five Q2C object arrays. Synonym-tolerant column matching so a
 * Salesforce/HubSpot/raw export maps without hand-editing headers.
 */
export function rowsToDataset(rows) {
  const opportunities = [];
  const quotes = [];
  const contracts = [];
  const invoices = [];
  const renewals = [];

  rows.forEach((r, i) => {
    const oppId = pick(r, 'opportunity_id', 'opp_id', 'opportunity', 'deal_id', 'id') || `OPP-${i + 1}`;
    const account = pick(r, 'account', 'account_name', 'customer', 'entity', 'company') || oppId;
    const arr = num(pick(r, 'arr', 'arr_usd', 'amount', 'acv', 'value'));

    opportunities.push({
      id: oppId,
      name: pick(r, 'opportunity_name', 'deal_name', 'name') || account,
      account,
      stage: pick(r, 'stage', 'opportunity_stage') || 'Unknown',
      arr_usd: arr,
      close_date: pick(r, 'close_date', 'closed_at') || '',
      owner_id: pick(r, 'owner', 'owner_id', 'opportunity_owner') || '',
    });

    const quoteId = pick(r, 'quote_id', 'quote');
    if (quoteId) {
      quotes.push({
        id: quoteId,
        opportunity_id: oppId,
        status: pick(r, 'quote_status') || 'Unknown',
        amount_usd: num(pick(r, 'quote_amount', 'quote_total', 'quote_arr')) || arr,
        currency: (pick(r, 'quote_currency') || 'USD').toUpperCase(),
        tax_rate: num(pick(r, 'quote_tax_rate', 'tax_rate')),
        created_at: pick(r, 'quote_created_at', 'quote_date') || '',
        approved_at: nullableDate(pick(r, 'quote_approved_at')),
      });
    }

    const contractId = pick(r, 'contract_id', 'contract');
    if (contractId) {
      contracts.push({
        id: contractId,
        quote_id: quoteId,
        opportunity_id: oppId,
        status: pick(r, 'contract_status') || 'Unknown',
        executed_at: nullableDate(pick(r, 'contract_executed_at', 'executed_at', 'signed_at')),
        term_start: pick(r, 'term_start', 'contract_start') || '',
        term_end: pick(r, 'term_end', 'contract_end') || '',
        arr_usd: num(pick(r, 'contract_arr', 'contract_amount')) || arr,
        entity: account,
      });
    }

    const invoiceId = pick(r, 'invoice_id', 'invoice');
    if (invoiceId) {
      const dueAt = pick(r, 'invoice_due_at', 'due_at', 'due_date') || '';
      const paidAt = nullableDate(pick(r, 'invoice_paid_at', 'paid_at'));
      invoices.push({
        id: invoiceId,
        contract_id: contractId,
        quote_id: quoteId,
        status: pick(r, 'invoice_status') || 'Unknown',
        amount_usd: num(pick(r, 'invoice_amount', 'invoice_total')),
        currency: (pick(r, 'invoice_currency') || 'USD').toUpperCase(),
        issued_at: pick(r, 'invoice_issued_at', 'issued_at', 'invoice_date') || '',
        due_at: dueAt,
        paid_at: paidAt,
        days_overdue: 0, // filled in detectFindings relative to asOf
        _due_at: dueAt,
        _paid: !!paidAt,
      });
    }

    const renewalId = pick(r, 'renewal_id', 'renewal');
    if (renewalId) {
      renewals.push({
        id: renewalId,
        contract_id: contractId,
        renewal_date: pick(r, 'renewal_date') || '',
        owner_id: nullableDate(pick(r, 'renewal_owner', 'renewal_owner_id')),
        status: pick(r, 'renewal_status') || 'Unknown',
        arr_usd: num(pick(r, 'renewal_arr', 'renewal_amount')) || arr,
        days_until_renewal: 0, // filled in detectFindings relative to asOf
      });
    }
  });

  return { opportunities, quotes, contracts, invoices, renewals };
}

// ─── Detection rules ────────────────────────────────────────────────────────────

const APPROVED_QUOTE = /\b(accepted|approved|signed|won)\b/i;
const EXECUTED_CONTRACT = /\b(executed|active|signed|live)\b/i;
const VOID_INVOICE = /\b(void|cancelled|canceled|draft)\b/i;

/** Reference "today" for overdue/days-until math: caller-supplied, else latest date in data. */
function deriveAsOf(dataset) {
  let max = 0;
  const consider = (iso) => { const t = Date.parse(iso); if (Number.isFinite(t) && t > max) max = t; };
  dataset.invoices.forEach((inv) => { consider(inv.issued_at); consider(inv._due_at); });
  dataset.contracts.forEach((c) => consider(c.term_start));
  return max ? new Date(max).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

/**
 * Inspect the canonical dataset and return broken-handoff findings, computed
 * purely from the rows. Mutates days_overdue / days_until_renewal onto records.
 */
export function detectFindings(dataset, asOf) {
  const today = asOf || deriveAsOf(dataset);
  const findings = [];
  let seq = 0;
  const nextId = () => `F-${String(++seq).padStart(2, '0')}`;
  const oppOf = (id) => dataset.opportunities.find((o) => o.id === id);

  // Refresh time-relative fields on the records the client renders.
  for (const inv of dataset.invoices) {
    const overdue = inv._due_at && !inv._paid ? daysBetween(inv._due_at, today) : 0;
    inv.days_overdue = overdue && overdue > 0 ? overdue : 0;
  }
  for (const ren of dataset.renewals) {
    const d = daysBetween(today, ren.renewal_date);
    ren.days_until_renewal = d == null ? 0 : d;
  }

  // 1. Orphaned contract — executed, but no invoice exists for it (revenue leak).
  for (const c of dataset.contracts) {
    const executed = EXECUTED_CONTRACT.test(c.status) || c.executed_at;
    const hasInvoice = dataset.invoices.some((inv) => inv.contract_id === c.id);
    if (executed && !hasInvoice) {
      const acct = oppOf(c.opportunity_id)?.account || c.entity || c.id;
      const sinceDays = c.executed_at ? daysBetween(c.executed_at, today) : null;
      findings.push({
        id: nextId(), severity: 'critical', type: 'orphaned_contract',
        title: 'Invoice never created',
        account: acct,
        affected_ids: [c.id, c.quote_id, c.opportunity_id].filter(Boolean),
        ghost: { type: 'invoice', for_contract: c.id, account: acct, arr_usd: c.arr_usd },
        system_owner: 'CPQ → billing sync',
        description: `Contract ${c.id} ($${c.arr_usd.toLocaleString()} ARR) is executed but has no invoice in the export${sinceDays != null ? ` — ${sinceDays} days and counting` : ''}. The customer is using the product without being billed.`,
        fix: 'Confirm the contract→billing automation is running, then manually trigger invoice creation for this contract and add a health-check alert so a paused sync surfaces within minutes, not months.',
      });
    }
  }

  // 2. Amount mismatch — invoice total diverges from quote total beyond tax.
  for (const inv of dataset.invoices) {
    if (VOID_INVOICE.test(inv.status)) continue;
    const quote = dataset.quotes.find((q) => q.id === inv.quote_id);
    if (!quote || !quote.amount_usd || !inv.amount_usd) continue;
    const expected = quote.amount_usd * (1 + (quote.tax_rate || 0));
    const delta = Math.abs(inv.amount_usd - expected);
    if (delta > Math.max(1, expected * 0.02)) {
      const contract = dataset.contracts.find((c) => c.id === inv.contract_id);
      const acct = oppOf(contract?.opportunity_id || quote.opportunity_id)?.account || inv.id;
      findings.push({
        id: nextId(), severity: 'critical', type: 'amount_mismatch',
        title: 'Invoice billed at wrong amount',
        account: acct,
        affected_ids: [inv.id, quote.id].filter(Boolean),
        system_owner: 'Billing',
        description: `Invoice ${inv.id} billed $${inv.amount_usd.toLocaleString()} but quote ${quote.id} (with tax) is $${Math.round(expected).toLocaleString()} — a $${Math.round(delta).toLocaleString()} gap.`,
        fix: 'Reconcile the invoice against the approved quote, issue a credit/rebill for the difference, and pin the billing amount to the quote of record.',
      });
    }
  }

  // 3. Currency mismatch — invoice currency differs from quote currency.
  for (const inv of dataset.invoices) {
    const quote = dataset.quotes.find((q) => q.id === inv.quote_id);
    if (!quote || !quote.currency || !inv.currency) continue;
    if (inv.currency !== quote.currency) {
      const acct = oppOf(quote.opportunity_id)?.account || inv.id;
      findings.push({
        id: nextId(), severity: 'warning', type: 'currency_mismatch',
        title: `Currency mismatch — ${inv.currency} invoice on ${quote.currency} quote`,
        account: acct,
        affected_ids: [inv.id, quote.id].filter(Boolean),
        system_owner: 'CPQ currency config',
        description: `Invoice ${inv.id} is in ${inv.currency} while quote ${quote.id} was approved in ${quote.currency}. FX drift will make the booked and billed ARR disagree.`,
        fix: 'Lock the invoice currency to the quote currency in the CPQ→billing mapping and re-issue this invoice in the contracted currency.',
      });
    }
  }

  // 4. Orphaned quote — approved/accepted, but no contract was created.
  for (const q of dataset.quotes) {
    if (!APPROVED_QUOTE.test(q.status)) continue;
    const hasContract = dataset.contracts.some((c) => c.quote_id === q.id || c.opportunity_id === q.opportunity_id);
    if (!hasContract) {
      const acct = oppOf(q.opportunity_id)?.account || q.id;
      findings.push({
        id: nextId(), severity: 'warning', type: 'orphaned_quote',
        title: 'Approved quote — no contract',
        account: acct,
        affected_ids: [q.id, q.opportunity_id].filter(Boolean),
        system_owner: 'CPQ → CLM handoff',
        description: `Quote ${q.id} is ${q.status} but never produced a contract. Either the deal stalled silently or the contract step was skipped.`,
        fix: 'Check whether the opportunity actually closed; if so, generate the contract from the approved quote and add a guard that blocks "approved with no contract" from aging.',
      });
    }
  }

  // 5. Renewal at risk — owner missing or status flagged, money on the line soon.
  for (const ren of dataset.renewals) {
    const unowned = !ren.owner_id;
    const flagged = /\b(at[\s_-]?risk|churn|red)\b/i.test(ren.status);
    if (unowned || flagged) {
      const contract = dataset.contracts.find((c) => c.id === ren.contract_id);
      const acct = oppOf(contract?.opportunity_id)?.account || ren.id;
      const soon = ren.days_until_renewal != null && ren.days_until_renewal <= 60;
      findings.push({
        id: nextId(), severity: 'at-risk', type: 'missing_renewal_owner',
        title: unowned ? `Renewal owner null — $${ren.arr_usd.toLocaleString()} unattended` : `Renewal flagged ${ren.status}`,
        account: acct,
        affected_ids: [ren.id, ren.contract_id].filter(Boolean),
        system_owner: 'Renewals / CS',
        description: `Renewal ${ren.id} ($${ren.arr_usd.toLocaleString()} ARR) is ${unowned ? 'unassigned' : ren.status}${soon ? ` and due in ${ren.days_until_renewal} days` : ''}. Nobody is driving it.`,
        fix: 'Assign a renewal owner now and route at-risk renewals into a CS play with enough runway before the term ends.',
      });
    }
  }

  // 6. Term gap — invoice past due and unpaid (cash not collected).
  for (const inv of dataset.invoices) {
    if (inv._paid || VOID_INVOICE.test(inv.status)) continue;
    if (inv.days_overdue > 0) {
      const contract = dataset.contracts.find((c) => c.id === inv.contract_id);
      const acct = oppOf(contract?.opportunity_id)?.account || inv.id;
      findings.push({
        id: nextId(), severity: 'warning', type: 'term_gap',
        title: `Invoice ${inv.days_overdue} days overdue`,
        account: acct,
        affected_ids: [inv.id, inv.contract_id].filter(Boolean),
        system_owner: 'AR / collections',
        description: `Invoice ${inv.id} ($${inv.amount_usd.toLocaleString()}) is ${inv.days_overdue} days past due and unpaid. Aging AR ties up cash and signals a stuck account.`,
        fix: 'Trigger the dunning sequence, confirm the bill-to contact is current, and escalate if the customer is also up for renewal.',
      });
    }
  }

  return findings;
}

// ─── Edges ──────────────────────────────────────────────────────────────────────

/** Build the flow edges, coloring each by whether its downstream object has a finding. */
export function buildEdges(dataset, findings) {
  const brokenIds = new Set();
  const warnIds = new Set();
  const riskIds = new Set();
  for (const f of findings) {
    const bucket = f.severity === 'critical' ? brokenIds : f.severity === 'warning' ? warnIds : riskIds;
    for (const id of f.affected_ids) bucket.add(id);
  }
  const statusFor = (...ids) => {
    if (ids.some((id) => brokenIds.has(id))) return 'broken';
    if (ids.some((id) => riskIds.has(id))) return 'at-risk';
    if (ids.some((id) => warnIds.has(id))) return 'warning';
    return 'healthy';
  };
  const findingFor = (...ids) => findings.find((f) => f.affected_ids.some((a) => ids.includes(a)))?.id ?? null;

  const edges = [];
  const push = (from, to, fromType, toType) => {
    if (!from || !to) return;
    edges.push({ from_id: from, to_id: to, from_type: fromType, to_type: toType, status: statusFor(from, to), finding_id: findingFor(from, to) });
  };
  for (const q of dataset.quotes) push(q.opportunity_id, q.id, 'opportunity', 'quote');
  for (const c of dataset.contracts) push(c.quote_id || c.opportunity_id, c.id, 'quote', 'contract');
  for (const inv of dataset.invoices) push(inv.contract_id || inv.quote_id, inv.id, 'contract', 'invoice');
  for (const ren of dataset.renewals) push(ren.contract_id, ren.id, 'contract', 'renewal');
  // Ghost edge from each orphaned contract to its missing-invoice node so the
  // break is drawn, not just implied by an absent edge. Node id matches the
  // client's `MISSING-INV-<contract>` convention.
  for (const f of findings) {
    if (f.type !== 'orphaned_contract' || !f.ghost) continue;
    edges.push({ from_id: f.ghost.for_contract, to_id: `MISSING-INV-${f.ghost.for_contract}`, from_type: 'contract', to_type: 'invoice', status: 'broken', finding_id: f.id });
  }
  return edges;
}

// ─── Orchestration ──────────────────────────────────────────────────────────────

/** Detect CSV vs canonical-JSON, normalize, detect findings, build edges. */
export function analyze(raw, asOf) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('Upload a CSV export or paste a JSON dataset.');
  }
  let dataset;
  const trimmed = raw.trim();
  let inputFormat;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed;
    try { parsed = JSON.parse(trimmed); } catch { throw new Error('Input looks like JSON but does not parse.'); }
    if (Array.isArray(parsed)) {
      dataset = rowsToDataset(parsed);
      inputFormat = 'json-rows';
    } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.opportunities)) {
      dataset = {
        opportunities: parsed.opportunities || [],
        quotes: parsed.quotes || [],
        contracts: parsed.contracts || [],
        invoices: (parsed.invoices || []).map((i) => ({ ...i, _due_at: i.due_at, _paid: !!i.paid_at })),
        renewals: parsed.renewals || [],
      };
      inputFormat = 'json-dataset';
    } else {
      throw new Error('Unsupported JSON shape — expected an array of rows or a {opportunities,...} dataset.');
    }
  } else {
    const rows = parseCsv(trimmed);
    if (!rows.length) throw new Error('Could not parse any rows from the CSV — check the header row.');
    dataset = rowsToDataset(rows);
    inputFormat = 'csv';
  }

  const findings = detectFindings(dataset, asOf);
  const edges = buildEdges(dataset, findings);
  const opportunityIds = new Set(dataset.opportunities.map((opportunity) => opportunity.id));
  const quoteIds = new Set(dataset.quotes.map((quote) => quote.id));
  const contractIds = new Set(dataset.contracts.map((contract) => contract.id));
  const linkedEntities =
    dataset.quotes.filter((quote) => opportunityIds.has(quote.opportunity_id)).length +
    dataset.contracts.filter((contract) => contract.quote_id && quoteIds.has(contract.quote_id)).length +
    dataset.invoices.filter((invoice) => invoice.contract_id && contractIds.has(invoice.contract_id)).length +
    dataset.renewals.filter((renewal) => renewal.contract_id && contractIds.has(renewal.contract_id)).length;
  const inputHint = linkedEntities === 0
    ? {
      code: 'no-linked-entities',
      message: 'Records were parsed, but no quote-to-contract or contract-to-invoice links were found. For the orphaned-contract probe, include opportunity_id, quote_id, contract_id, contract_status, contract_executed_at, and leave invoice_id blank.',
      requiredColumns: ['opportunity_id', 'quote_id', 'contract_id', 'contract_status', 'contract_executed_at', 'invoice_id'],
    }
    : undefined;

  // Strip internal scratch fields before returning to the client.
  const invoices = dataset.invoices.map(({ _due_at, _paid, ...rest }) => rest);

  return {
    source: 'uploaded',
    inputFormat,
    opportunities: dataset.opportunities,
    quotes: dataset.quotes,
    contracts: dataset.contracts,
    invoices,
    renewals: dataset.renewals,
    edges,
    findings,
    ...(inputHint ? { inputHint } : {}),
    stats: {
      opportunities: dataset.opportunities.length,
      quotes: dataset.quotes.length,
      contracts: dataset.contracts.length,
      invoices: invoices.length,
      renewals: dataset.renewals.length,
      linkedEntities,
      findings: findings.length,
      critical: findings.filter((f) => f.severity === 'critical').length,
    },
  };
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { raw, name } = body || {};
    const result = analyze(raw);
    return json({ ...result, name: typeof name === 'string' && name ? name : 'uploaded-export.csv' });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Analysis failed.' }, { status: 400 });
  }
}
