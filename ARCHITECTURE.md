# Q2See Architecture

## Stack

- **Astro 5** — static site generator
- **TypeScript** — vanilla TS, no framework
- **SVG** — all graphics are inline SVG, no Canvas, no D3, no external charting library
- **Cloudflare Pages Function** — one serverless endpoint for real CRM/billing-export analysis
- **No API keys, no environment variables, no stored state** — uploads are processed in-request and discarded

## Live backend

`functions/q2see/analyze.js` handles `POST /q2see/analyze` and runs the Quote-to-Cash analysis server-side on data you upload:

1. **Auto-detect input shape** — a flattened CSV export (one row per opportunity, lifecycle columns inline), an array of row objects, or a canonical `{opportunities, quotes, contracts, invoices, renewals}` dataset. Malformed input is rejected with a specific error.
2. **Map rows to the five Q2C object types** with synonym-tolerant column matching (`rowsToDataset`), so a Salesforce/HubSpot/raw export maps without hand-editing headers.
3. **Run the six detection rules** (`detectFindings`, below) over the parsed rows, deriving a reference "today" from the latest date in the data so overdue / days-until math is deterministic.
4. **Build the flow graph edges** (`buildEdges`), coloring each by the severity of any finding on its downstream object, including a "ghost" edge from each orphaned contract to its missing invoice.
5. **Return** the dataset, edges, findings, and stats with `source: "uploaded"` and the detected `inputFormat`.

The pipeline is stateless and identical whether the input is the synthetic sample or a real uploaded export — the sample is just the zero-friction path. Pure helpers (`parseCsv`, `rowsToDataset`, `detectFindings`, `buildEdges`, `analyze`) are exported and unit-tested in `tests/q2see-analyze.test.js`.

## The detection rules

`detectFindings()` runs six broken-handoff rules over the canonical dataset:

| Rule | Severity | Fires when |
|---|---|---|
| `orphaned_contract` | critical | Contract is executed but no invoice exists for it (revenue leak) |
| `amount_mismatch` | critical | Invoice total diverges from quote total (incl. tax) beyond a 2% tolerance |
| `currency_mismatch` | warning | Invoice currency differs from the approved quote currency |
| `orphaned_quote` | warning | Quote is approved/accepted but never produced a contract |
| `missing_renewal_owner` | at-risk | Renewal has no owner, or its status is flagged at-risk/churn |
| `term_gap` | warning | Invoice is past due and unpaid (cash not collected) |

Each finding carries `account`, `affected_ids`, a human-readable `description`, the `system_owner` that should fix it, and a concrete `fix` — so the graph node, the inspector, and the findings rail all render the same record-level evidence.

## Why SVG instead of Canvas or D3

The graph is a static business-process visualization, not a dynamic network diagram. SVG gives us:
- DOM event handling on every node (click, hover, focus)
- CSS styling for states (healthy, warning, broken)
- Accessibility via ARIA roles on SVG elements
- No 300 KB D3 dependency

## Data model

```typescript
interface Opportunity { id: string; name: string; amount: number; stage: string; closeDate: string; accountId: string; }
interface Quote { id: string; opportunityId: string; amount: number; status: string; sentDate: string; }
interface Contract { id: string; quoteId: string; status: string; signedDate: string; termMonths: number; }
interface Invoice { id: string; contractId: string; amount: number; status: string; dueDate: string; }
interface Renewal { id: string; contractId: string; status: string; scheduledDate: string; }
interface HandoffEdge { from: string; to: string; type: string; }
interface Finding { id: string; nodeId: string; severity: 'healthy' | 'warning' | 'broken' | 'at-risk'; message: string; }
```

## Layout algorithm

The graph uses a deterministic column layout:
- 5 columns: opportunity → quote → contract → invoice → renewal
- Column x-positions are fixed (`COL_X`)
- Nodes within a column are stacked vertically with a fixed gap
- Aggregate "ghost" pills collapse multiple nodes into one when space is tight
- Edges are drawn as cubic Bézier curves between node centers

This is not a force-directed layout. It is a **business-process layout** — the x-axis is time/order, the y-axis is density. The result is instantly readable by anyone who has seen a Gantt chart or a process flow.

## Pan and zoom

Implemented with CSS transforms on a viewport group:
- Mouse drag pans
- Wheel zooms (with clamped min/max scale)
- Touch pinch-zoom is not implemented (mobile is read-only)
- `transform` is GPU-accelerated; 60fps on modern laptops

## Key design decisions

### 1. Severity as node state
Every node has a computed severity based on its findings and its downstream connectivity. A contract with no invoice is not just a missing edge — it is a `broken` node with a red border. This makes the problem visible at a glance without reading every finding.

### 2. Inspector panel for deep dives
Clicking a node opens an inspector with the full object record and the specific finding. This two-level design (graph for overview, inspector for detail) scales to hundreds of records without cluttering the canvas.

### 3. Filter bar for triage
Severity filters (healthy, warning, broken, at-risk) let the user focus on the problems. A revenue-ops lead can hide all green nodes and see only the broken handoffs in one click.

## File map

| File | Responsibility |
|---|---|
| `functions/q2see/analyze.js` | Live Pages Function: CSV/JSON parsing, row mapping, six detection rules, edge building |
| `tests/q2see-analyze.test.js` | Unit tests for the parser + rules engine, anchored to a fixed "today" |
| `src/pages/index.astro` | Shell: nav, import panel, banner, filter bar, graph canvas, inspector, findings rail |
| `src/components/app.ts` | Bootstrap, synthetic data loading, import → `POST /q2see/analyze`, layout, SVG rendering, pan/zoom, inspector |
| `src/styles/q2see.css` | All styles: shell, import panel, graph, nodes, edges, inspector, responsive breakpoints |
| `public/q2see/data/*.json` | Synthetic sample dataset (the no-upload path) |
| `public/q2see/sample-q2c-export.csv` | Sample CRM export the "Load sample export" button posts to the backend |

## What is live vs. cut for scope

**Live:** CSV/JSON parsing and all six detection rules run server-side on real uploaded Quote-to-Cash exports (see [Live backend](#live-backend)).

Cut for scope:
- **Live CRM/billing OAuth** — analysis runs on an uploaded export (a point-in-time snapshot), not a live Salesforce / HubSpot / Stripe connection
- **Automated remediation** — Q2See surfaces the break and the suggested fix; a human acts on it
- **Force-directed or Sugiyama layout** — fixed business-process column layout only
- **Time-series playback** — single point-in-time snapshot, not historical trends
- **Persistent storage** — each request is independent; nothing is stored

## How to extend to production

The upload path already proves parsing + detection on real data. A production version would add:
1. CRM/billing connectors (Salesforce, HubSpot, NetSuite, Stripe) for live, continuous ingestion
2. A layout engine that handles >100 nodes without overlap
3. Time-series playback ("watch this deal move through the pipeline over 90 days")
4. Alerting on broken handoffs ("Contract X signed 30 days ago, no invoice created")
5. Role-based views (sales sees opportunities, finance sees invoices, ops sees the full graph)
