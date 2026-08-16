# Q2See

[![CI](https://github.com/dallascrilley/q2see-demo/actions/workflows/ci.yml/badge.svg)](https://github.com/dallascrilley/q2see-demo/actions/workflows/ci.yml)

> **Signed contract. No invoice. Nobody's panicking yet. They will be.**

Q2See is a Quote-to-Cash flow inspector. It visualizes contract → quote → invoice → renewal as an interactive SVG flow graph, flags broken handoffs, and surfaces exactly where revenue leaks before legal finds it. It is a **hybrid proof**: a real backend parses an actual CRM/billing export you upload — mapping each opportunity's lifecycle and running six broken-handoff detection rules over *your* rows — while live Salesforce/Stripe OAuth is explicitly out of scope.

**Live demo:** [demos.dallascrilley.com/q2see](https://demos.dallascrilley.com/q2see) — explore the synthetic sample, or upload a real Quote-to-Cash export and watch it get inspected server-side.

## Real vs. synthetic — the honest boundary

| Capability | Source |
|---|---|
| Parse a real CRM/billing export (CSV or JSON, one row per opportunity) | **Live** — server-side parsing of your uploaded export |
| Six broken-handoff rules: orphaned contract, orphaned quote, amount mismatch, currency mismatch, missing renewal owner, term gap | **Live** — run in the backend on real input |
| Flow graph + findings from an upload | **Live** — derived entirely from the uploaded rows |
| Sample workspace (no upload) | Synthetic — `public/q2see/data/*.json` |
| Live Salesforce / HubSpot / Stripe connection | Out of scope — no OAuth; it's a point-in-time uploaded export, not a live feed |
| Automated remediation | Out of scope — Q2See surfaces the break; a human decides the fix |

The synthetic sample lets a reviewer try it instantly; uploading a real export proves the parsing and detection logic works on genuine pipeline data.

## The backend

[`functions/q2see/analyze.js`](functions/q2see/analyze.js) is a **Cloudflare Pages Function** — `POST /q2see/analyze`. It:

- accepts **either** a flattened CSV export (one row per opportunity, lifecycle columns inline) **or** a canonical JSON dataset / array of rows, and auto-detects which;
- maps synonym-tolerant columns (`opportunity_id`, `arr`, `quote_status`, `contract_executed_at`, `invoice_amount`, `renewal_owner`, …) into the five Q2C object types, so a Salesforce/HubSpot/raw export maps without hand-editing headers;
- runs **six broken-handoff detection rules** over the parsed rows — `orphaned_contract` (executed, never invoiced), `orphaned_quote` (approved, no contract), `amount_mismatch` (invoice vs. quote+tax), `currency_mismatch`, `missing_renewal_owner` (unowned / at-risk renewal), `term_gap` (invoice past due and unpaid);
- builds the flow graph edges, coloring each by the severity of any finding on its downstream object;
- is **stateless** — the request body is the only input; nothing is stored.

```bash
curl -X POST https://demos.dallascrilley.com/q2see/analyze \
  -H 'content-type: application/json' \
  --data-binary @<(jq -Rs '{raw: ., name:"sample-q2c-export.csv"}' public/q2see/sample-q2c-export.csv)
```

The parsing and detection logic are pure functions, exported and unit-tested in [`tests/q2see-analyze.test.js`](tests/q2see-analyze.test.js).

### Reproduce the orphaned-contract finding

The analyzer expects one flattened lifecycle row per opportunity. This exact CSV is also the live `/ops` probe; paste it into **Import your data** or post it to `/q2see/analyze` to get one critical `orphaned_contract` finding. Keep the final `invoice_id` value empty — that is the missing downstream handoff being tested.

```csv
opportunity_id,account,stage,arr,quote_id,quote_status,quote_amount,quote_currency,contract_id,contract_status,contract_executed_at,term_start,term_end,invoice_id
OPP-PROBE,Ops Probe Co,Closed Won,48000,Q-PROBE,Accepted,48000,USD,C-PROBE,Executed,2026-05-01,2026-05-01,2027-05-01,
```

If an upload maps records but produces no lifecycle links, the response includes an `inputHint` with the required relationship columns instead of silently implying a healthy pipeline.

## Run locally

```bash
pnpm install
pnpm test                                    # unit tests for the parser + rules engine
pnpm dev                                     # static UI only — http://localhost:4321 (synthetic sample)
pnpm build && npx wrangler pages dev dist    # UI + live /q2see/analyze — http://localhost:8788
```

Uploads reach the backend only under `wrangler pages dev` (port **8788**); `pnpm dev` (port 4321) serves the synthetic UI alone.

## What it proves

- **RevOps systems depth** — models the full quote-to-cash lifecycle and the handoffs between opportunity, quote, contract, invoice, and renewal, then detects where each handoff breaks.
- **Defensive ingestion** — CSV and two JSON shapes auto-detected, synonym-tolerant column mapping, malformed input rejected with clear errors.
- **Graph visualization** — renders hierarchical business data as a pan/zoom SVG canvas with directed edges and severity-weighted nodes.
- **Honest system boundaries** — the live/synthetic and "no OAuth, point-in-time export" lines are explicit in the UI's import panel, the API response (`source`, `inputFormat`), and this README.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the data model, the detection rules, the backend design, and tradeoffs.

## License

MIT
