# Q2See Architecture

## Stack

- **Astro 5** — static site generator
- **TypeScript** — vanilla TS, no framework
- **SVG** — all graphics are inline SVG, no Canvas, no D3, no external charting library
- **No backend, no API keys, no environment variables**

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
| `src/pages/index.astro` | Shell: nav, banner, filter bar, graph canvas, inspector, findings rail |
| `src/components/app.ts` | Bootstrap, data loading, layout computation, SVG rendering, pan/zoom, inspector |
| `src/styles/q2see.css` | All styles: shell, graph, nodes, edges, inspector, responsive breakpoints |

## What was cut for scope

- **Force-directed or Sugiyama layout** — fixed column layout only
- **Real-time updates** — static snapshot only
- **Multi-entity graphs** — single Q2C pipeline only
- **Export / print** — no PDF or image export

## How to extend to production

A production version would need:
1. CRM connectors (Salesforce, HubSpot, NetSuite) for live data
2. A layout engine that handles >100 nodes without overlap
3. Time-series playback ("watch this deal move through the pipeline over 90 days")
4. Alerting on broken handoffs ("Contract X signed 30 days ago, no invoice created")
5. Role-based views (sales sees opportunities, finance sees invoices, ops sees the full graph)
