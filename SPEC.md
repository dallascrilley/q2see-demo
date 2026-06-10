# Q2See — Quote-to-Cash Flow Inspector

> **Signed contract. No invoice. Nobody's panicking yet. They will be.**

| Field | Value |
|---|---|
| **Slug** | `q2see` |
| **Lane fit** | L1 (MarTech / RevOps) primary, L2 secondary |
| **Live route** | `demos.dallascrilley.com/q2see` |
| **Status** | Spec drafted; Buildability 4 |
| **Build estimate** | ~2 weeks |
| **Accent token** | `--accent: oklch(65% 0.19 145)` — cash-register green |

---

## 1. Positioning

**Hook:** "Signed contract. No invoice. Nobody's panicking yet. They will be."

**Tagline:** "One flow graph. Every broken handoff. Before legal finds it first."

**Microcopy voice sample** (inspector panel, critical finding header):
> *Crestline Digital signed on March 14. The invoice never existed. Here's the exact moment the plumbing broke — and the one-line fix.*

**30-second proof:** Dallas Crilley opens Q2See. A navigable flow graph fills the screen — 142 opportunities threading through quotes, contracts, invoices, and renewals in five columns, with edges color-coded by handoff health. Three nodes pulse red. He clicks the brightest one. The inspector panel opens: **Crestline Digital. $48,000 ARR. Contract executed 2026-03-14. Zero invoices downstream. Root cause: Workato recipe `cpq-to-stripe-prod` was paused for a Stripe API key rotation and never resumed. Revenue at risk: $48,000.** A RevOps hiring manager watching this thinks: *he has debugged a broken Q2C pipeline. He understands it at the record level, the system level, and the trigger level — not just the dashboard level.*

**The wedge line:** "I owned the system. I did not integrate against it."

**Role signal it sends:** Q2C architecture ownership. This is not a reporting demo — it is a systems-inspection demo. Reporting tells you revenue leaked. Inspection tells you *where the plumbing broke, which system owns the break, and what the fix is*. That is the work of a Revenue Systems Engineer or BSA who owns the CPQ/CLM/billing layer — not an analyst who reads Clari.

**Portfolio fit:** Q2See is the only product in the demo-lab slate that touches the revenue-cycle side of RevOps. Siblings — Tracewell (incident timeline), Apexlint (code-diagnostic), Funnelguard (funnel/lifecycle) — each own a distinct surface. Q2See owns the flow-graph identity. It expands the credibility wedge without doubling the existing products.

---

## 2. Problem & evidence

Quote-to-cash is the highest-stakes RevOps seam. When it breaks, real dollars disappear — not bad data, not wrong attribution, but un-invoiced contracts and un-billed renewals that nobody notices for weeks.

**Cited job-posting evidence:**

- **OpenSesame (BSA):** *"Lead Salesforce strategy and architecture — particularly Sales Cloud and CPQ — owning configuration, integrations, and data integrity while driving scalability, automation, and AI-enabled quote-to-cash innovation."*
- **Elation Health (Salesforce Admin/BSA):** *"You are the primary technical expert for our quote to cash process."*
- **Webflow (BSA):** *"Hands-on experience with Salesforce, Marketo, Outreach, Gong, Clari, Ironclad, and Zendesk... Salesforce CPQ or Revenue Cloud, and Ironclad CLM."*

**The core failure mode:** Ironclad + Salesforce CPQ + Stripe + the renewal motion is custom every time. There is no opinionated middleware that treats the full chain as one observable unit. The pain manifests as: *"we have 12 signed contracts that did not trigger invoicing — find them."* That is a custom SOQL query + a CSV + a meeting. Q2See replaces that meeting.

**Why current tools fail — and which system actually owns each handoff:**

| Handoff | System that owns it | Why the tool fails to surface breaks |
|---|---|---|
| Quote → Contract | Salesforce CPQ / Ironclad CLM | CPQ surfaces quote state; Ironclad surfaces signature state. No native join to confirm the contract-exec trigger fired into billing. |
| Contract → Invoice | Billing trigger (Workato / Zapier / custom) | Stripe and Zuora surface invoices. Neither knows the upstream contract that *should* have triggered them. Orphaned contracts are invisible. |
| Invoice → Renewal | Renewal logic (SFDC renewal object / Gainsight) | Clari and BoostUp report renewal risk. Neither exposes the record-level break (null owner, wrong renewal date, term gap). |

Nobody renders the full chain as a navigable, per-record graph where you can click a broken handoff and get a structured, system-attributed diagnosis. That is the white space Q2See occupies.

---

## 3. Target role & proof narrative

**Primary buyer:** Revenue Systems Engineer / Salesforce BSA / RevOps Architect. Secondary: AI Automation Engineer hiring manager who wants to see systems ownership.

**What 30 seconds proves to a hiring manager:**

1. The candidate understands the *objects* — Contract, Quote, Invoice, Renewal are not interchangeable nouns. They have distinct owners, states, and linking keys. Q2See models them correctly.
2. The candidate understands the *handoffs* — Quote→Contract requires an executed signature; Contract→Invoice requires a billing trigger; Invoice→Renewal requires a contract term + owner assignment. Each handoff is an explicit edge in the graph, not an implied relationship.
3. The candidate can *diagnose, not just report* — clicking a flagged node produces a structured finding: severity, broken field, system that owns it, proposed fix. This is the work of someone who has debugged a broken Q2C pipeline, not someone who has read about one.
4. The candidate understands *data integrity as a system property* — the planted breaks are the actual failure modes (orphaned contract, quote/invoice amount mismatch, currency/tax mismatch, missing renewal owner) that appear in production Q2C bugs.

**The moat line it earns:** *"I owned the system, I did not integrate against it."*

### Objection → proof table

| Hiring concern | Role | How Q2See answers it |
|---|---|---|
| "Does he know CPQ, not just Salesforce?" | BSA / Rev Systems Eng | Graph correctly distinguishes Quote (CPQ-owned) from Contract (CLM-owned) as separate objects with separate linking keys. Inspector names the owning system per field. |
| "Has he actually debugged a billing break?" | Rev Systems Eng | B-01 finding cites a specific Workato recipe name, the exact API key rotation that caused it, and the resume-trigger fix — not generic "trigger never fired." |
| "Is this just a Salesforce admin who read about Q2C?" | RevOps Architect | The data model has `HandoffEdge` as a first-class type with its own `status` and `finding_id`. The system owner attribution is per-field, not per-record. |
| "Can he build systems-level tooling, not just configure?" | AI Automation Eng | Rules-as-pure-functions in `rules.ts`, dagre layout, React Flow custom nodes — this is engineering, not config. |
| "Is the data real enough to trust?" | Any | Synthetic data banner is persistent, dismissible, and frames itself as a trust signal ("We planted these breaks. Here's how we know they're real ones."). |

---

## 4. The demo — core flow

The demo is a single-page application: a **flow graph** on the left (2/3 viewport), an **inspector panel** on the right (1/3 viewport), and a **findings rail** pinned to the bottom. The graph is the hero — it is visible before the user reads a single word.

### Flow graph

The graph renders the Q2C chain as a directed acyclic graph with five node types:

```
[Opportunity] → [Quote] → [Contract] → [Invoice] → [Renewal]
```

Nodes are rectangular with clipped corners (6px radius), sized by ARR (min 40×24px, max 120×60px). Each node shows: abbreviated account name, object ID, and a severity dot in the top-right corner. Edges are cubic bezier curves with 3px stroke, routed horizontally between columns. Edge color encodes handoff health:

- **Healthy** `oklch(55% 0.08 145)` muted green — handoff complete, amounts reconciled, dates consistent
- **Warning** `oklch(72% 0.18 80)` amber — soft mismatch (currency differs, date gap < 30 days)
- **Broken** `oklch(60% 0.22 25)` red-orange — hard break (orphaned record, amount delta > 1%, null owner within 30-day window)
- **At-risk** `oklch(68% 0.20 55)` orange — renewal ≤ 30 days with no assigned owner

**On load:** the graph centers on the B-01 node (Crestline Digital, Contract C-1042), which is already highlighted in red with a 4px pulsing glow. The inspector panel is pre-populated with the B-01 finding. The user does not have to hunt for the problem — it hunts for them.

The graph is fully navigable: zoom, pan, click any node to open the inspector. A **filter bar** narrows by severity, object type, date range, and named account.

### The signature interaction — clicking a broken handoff node

This is the one moment the demo must nail. When the user clicks Contract node C-1042 (Crestline Digital):

1. The node gains a white outer ring (2px, `oklch(92% 0.01 250)`).
2. All edges not connected to C-1042 fade to 20% opacity.
3. The inspector panel slides in from the right (150ms, `cubic-bezier(0.16, 1, 0.3, 1)`).
4. The inspector header shows: **CRITICAL** badge (red) + "Invoice never created."
5. Below the header:

```
Account:        Crestline Digital
Object:         Contract C-1042
ARR:            $48,000
Executed:       2026-03-14
Upstream quote: Q-771 (Accepted, $48,000)

WHAT BROKE
No invoice was ever created downstream of this contract.
Stripe has no record of a charge or subscription for this customer.

WHICH SYSTEM OWNS IT
Billing trigger: Workato recipe cpq-to-stripe-prod
Last successful run: 2026-03-11
Current status: PAUSED (recipe was suspended during Stripe API key
rotation on 2026-03-12 and never resumed)

THE FIX
1. Resume recipe cpq-to-stripe-prod in Workato
2. Manually trigger the contract → invoice action for C-1042
3. Verify invoice INV-xxxx appears in Stripe within 5 minutes
4. Add a recipe health-check alert so this doesn't happen silently again
```

This is the unforgettable moment. A RevOps hiring manager watching this demo does not see a graph library — they see someone who has sat in the incident room when a contract didn't invoice and knows exactly how to find the break.

### Inspector panel — healthy node view

For a healthy node, the inspector shows:
- Object type, ID, status, owner, amounts, dates
- Upstream and downstream links (clickable — centers graph on that node)
- Last sync timestamp per system

### Findings rail

All six active findings in a scrollable bottom strip. Each entry: severity dot + one-line description + affected record ID + **"Jump to node"** link that centers the graph and opens the inspector. Default sort: Critical → Warning → At-risk.

### Planted handoff breaks — the six flagship findings

These are the demo's narrative spine. Each represents a real class of Q2C production bug.

| ID | Account | Type | Severity | Story |
|---|---|---|---|---|
| **B-01** | Crestline Digital | Orphaned contract | Critical | Contract C-1042 ($48,000 ARR) executed 2026-03-14. Workato recipe `cpq-to-stripe-prod` was paused during a Stripe API key rotation on 2026-03-12 and never resumed. Invoice never created. The customer has been using the product for 77 days without being billed. |
| **B-02** | Orion Payments, Inc. | Amount mismatch | Critical | Quote Q-889 was approved at $26,400. Invoice INV-2201 was created at $24,000 — a $2,400 (9.1%) delta. Root cause: the discount approval in CPQ ran after the invoice trigger fired. Stripe charged the wrong amount. No one noticed because the payment succeeded. |
| **B-03** | Halfmoon Labs | Term / renewal date gap | Warning | Contract C-1019 term ends 2026-07-01. Renewal REN-441 is dated 2026-07-15 — a 14-day gap. The billing schedule was set up from the renewal date, not the contract end date. The customer has a 2-week window where their subscription is technically expired but their access is still live. |
| **B-04** | Vantage GTM | Orphaned quote | Warning | Quote Q-912 ($18,500 ARR, Approved) has no downstream contract. Opportunity OPP-7731 was marked Closed Won 47 days ago. Sales rep created a second quote to fix a discount and forgot to close the first. Both are "Approved" in CPQ. CLM has no contract for either. |
| **B-05** | Parabola Works | Currency mismatch | Warning | Quote Q-844 denominated in USD ($31,200). Invoice INV-2189 denominated in CAD — no FX conversion recorded. The Canadian entity was set up mid-deal after the quote was approved. Billing picked up the entity's default currency without reconciling against the quote. |
| **B-06** | Sable Collective | Missing renewal owner | At-risk | Renewal REN-457 expires 2026-06-14 (15 days). `owner_id` is null. Original CSM departed 2026-04-01; territory was redistributed but the renewal record was never reassigned. No one has called the account. |

### Interactive vs. illustrative

- Node click, pan/zoom, filter bar, inspector panel, findings-rail jump links: **fully interactive**
- "Connect Salesforce CPQ" and "Connect Stripe" OAuth flows: **illustrative** (modal opens, "Connect" button closes it, connection shows as active with a plausible last-sync timestamp)
- All data is synthetic — see §9 for the persistent banner copy

---

## 5. Brand / visual direction

**Name:** Q2See — the pun is intentional: Quote-to-Cash + "to see." Lowercase `q2see` in product contexts; "Q2See" in titles.

**Tagline:** "One flow graph. Every broken handoff. Before legal finds it first."

### Visual identity — the flow graph as signature

Q2See's visual identity is a **navigable DAG on a near-black surface**. This is not a dashboard, not a BI tool, not a card grid. It is a diagnostic console. The graph is the whole product — everything else (inspector, findings rail) is contextual chrome that appears in response to interaction.

**The signature look in one sentence:** dark precision-instrument — the revenue chain as circuit diagram, broken nodes glowing like fault indicators on a server rack.

### Palette

| Token | Value | Use |
|---|---|---|
| `--surface` | `oklch(12% 0.01 250)` | App background — near-black, blue-gray cast |
| `--surface-raised` | `oklch(17% 0.01 250)` | Inspector panel, findings rail |
| `--surface-border` | `oklch(25% 0.02 250)` | Node borders, panel dividers |
| `--node-healthy` | `oklch(55% 0.08 145)` | Healthy node + edge |
| `--node-warning` | `oklch(72% 0.18 80)` | Warning node + edge |
| `--node-broken` | `oklch(60% 0.22 25)` | Critical node + edge — pulsing glow |
| `--node-atrisk` | `oklch(68% 0.20 55)` | At-risk node + edge |
| `--accent` | `oklch(65% 0.19 145)` | CTA, "Jump to node" links, active filter pill |
| `--text-primary` | `oklch(92% 0.01 250)` | Body copy, inspector prose |
| `--text-muted` | `oklch(55% 0.01 250)` | Labels, metadata, timestamps |
| `--text-mono` | `oklch(80% 0.04 145)` | Node IDs, field values, code snippets — slightly green cast |

### Typography

- **Geist Mono** — node labels, record IDs, field values, finding code fragments. The mono register signals "system data" and distinguishes Q2See from generic analytics tools.
- **Inter** — inspector prose, filter labels, banner copy, finding descriptions. The sans register signals "explanation" — the system talking to a human.
- **Hierarchy:** 11px Geist Mono for node labels; 13px Inter for inspector body; 16px Inter 500 for inspector headers; 20px Inter 600 for finding severity headline.

### Node shape and edge styling

- Nodes: `60px × 32px` minimum, rectangular with `6px` border-radius. Border: `1px solid var(--surface-border)`. Healthy nodes have no fill — they are near-transparent (`oklch(17% 0.01 250)`) against the dark surface. Broken/warning nodes have a `2px` colored border and a `0 0 8px 2px` box-shadow in the severity color at 60% opacity.
- Critical nodes add a `pulse` animation: `box-shadow` oscillates between 4px and 10px spread over 2s ease-in-out infinite.
- Edges: `3px` cubic bezier, `stroke-linecap: round`. Healthy edges are `oklch(55% 0.08 145)` at 40% opacity (they are infrastructure — don't call attention to them). Broken/warning edges are full opacity.
- On hover: the node border brightens by ~15% L; connected edges brighten to full opacity; unconnected edges fade to 15%.
- On selected: white outer ring `2px` + all unconnected edges at 10% opacity.

### Anti-template bar

- No card grids. No stat-panel hero rows. No CTA button above the fold.
- First viewport: the live graph, centered on the most critical finding, already interactive.
- The findings rail is the only persistent chrome. The inspector appears on demand.
- The landing page (at `/q2see`) leads with the problem statement, not the product name. The first heading is a question the hiring manager has asked in real life.

---

## 6. Data model + synthetic records

### Schema

```typescript
type Opportunity = {
  id: string;            // "OPP-xxxx"
  name: string;          // account name
  account: string;       // legal entity
  stage: "Closed Won" | "Closed Lost";
  arr_usd: number;
  close_date: string;    // ISO date
  owner_id: string;
};

type Quote = {
  id: string;            // "Q-xxxx"
  opportunity_id: string;
  status: "Draft" | "Approved" | "Sent" | "Accepted";
  amount_usd: number;
  currency: "USD" | "CAD" | "EUR" | "GBP";
  tax_rate: number;      // 0.0–0.3
  created_at: string;
  approved_at: string | null;
};

type Contract = {
  id: string;            // "C-xxxx"
  quote_id: string;
  opportunity_id: string;
  status: "Draft" | "Executed" | "Expired" | "Cancelled";
  executed_at: string | null;
  term_start: string;
  term_end: string;
  arr_usd: number;
  entity: string;        // legal entity name
};

type Invoice = {
  id: string;            // "INV-xxxx"
  contract_id: string;
  quote_id: string;
  status: "Draft" | "Sent" | "Paid" | "Overdue" | "Void";
  amount_usd: number;
  currency: "USD" | "CAD" | "EUR" | "GBP";
  issued_at: string;
  due_at: string;
  paid_at: string | null;
  days_overdue: number;
};

type Renewal = {
  id: string;            // "REN-xxxx"
  contract_id: string;
  renewal_date: string;
  owner_id: string | null;
  status: "Scheduled" | "At Risk" | "Churned" | "Renewed";
  arr_usd: number;
  days_until_renewal: number;  // computed
};

// First-class type — not implied by the records themselves
type HandoffEdge = {
  from_id: string;
  to_id: string;
  from_type: "opportunity" | "quote" | "contract" | "invoice" | "renewal";
  to_type: "opportunity" | "quote" | "contract" | "invoice" | "renewal";
  status: "healthy" | "warning" | "broken" | "at-risk";
  finding_id: string | null;
};

// Finding produced by rule evaluation — the system speaking
type Finding = {
  id: string;            // "B-01" etc.
  severity: "critical" | "warning" | "at-risk";
  type: string;          // "orphaned_contract" | "amount_mismatch" | etc.
  title: string;
  account: string;
  description: string;   // plain English — no jargon
  system_owner: string;  // "Workato recipe cpq-to-stripe-prod"
  fix: string;           // specific, actionable, step-numbered
  affected_ids: string[];
};
```

### Named accounts — the cast

| Account | Segment | ARR | Story context |
|---|---|---|---|
| **Crestline Digital** | Mid-Market | $48,000 | SaaS company; Stripe billing; the B-01 invoice orphan |
| **Orion Payments, Inc.** | Mid-Market | $26,400 | Fintech; CPQ discount applied after trigger fired; B-02 amount mismatch |
| **Halfmoon Labs** | SMB | $14,400 | Dev tools startup; multi-entity setup; B-03 term gap |
| **Vantage GTM** | SMB | $18,500 | Sales tech company; rep created two quotes; B-04 orphaned quote |
| **Parabola Works** | SMB | $31,200 | Data ops company; Canadian entity added mid-deal; B-05 currency mismatch |
| **Sable Collective** | Enterprise | $96,000 | Agency holding company; CSM departed mid-Q2; B-06 renewal owner null |
| Remaining ~34 accounts | Mix | $8k–$120k | Healthy records providing context and volume |

### Synthetic dataset scale

- **40 Opportunities** — SMB / Mid-Market / Enterprise mix; USD and CAD; close dates 2025-10-01 to 2026-05-01
- **52 Quotes** — most opps have 1–2 quotes; ~8 in "Approved" state with no downstream contract (the orphaned-quote population)
- **38 Contracts** — executed, 12–36 month terms; 4 without downstream invoices (including C-1042)
- **34 Invoices** — most contracts have 1 invoice; 2 amount mismatches; 1 currency mismatch
- **28 Renewals** — 3 with null owner; 1 with term gap; 2 in `At Risk` status
- **6 HandoffEdges flagged** — one per B-01 through B-06
- **6 Findings** — pre-computed; each with system_owner and step-numbered fix

### Exact inspector text for B-01 (builder implements verbatim)

```
CRITICAL — Invoice never created

Account:        Crestline Digital
Object:         Contract C-1042
ARR:            $48,000 USD
Executed:       2026-03-14
Upstream quote: Q-771 (Accepted, $48,000 USD, 2026-03-12)

WHAT BROKE
No invoice was created downstream of this contract.
Stripe has no record of a charge or subscription for this customer.
The contract has been executed for 77 days. $48,000 has not been collected.

WHICH SYSTEM OWNS IT
Billing trigger: Workato recipe cpq-to-stripe-prod
Last successful run: 2026-03-11 at 14:22 UTC
Current status: PAUSED
Cause: Recipe was suspended during Stripe API key rotation (2026-03-12).
The rotation completed. The recipe was never resumed.

THE FIX
1. Go to Workato → Recipes → cpq-to-stripe-prod
2. Resume the recipe
3. Manually trigger the "Contract Executed" event for C-1042
4. Confirm invoice INV-xxxx appears in Stripe within 5 minutes
5. Add a recipe health-check alert: notify #rev-ops-alerts if recipe
   is paused for > 24 hours
```

### Exact inspector text for B-02 (builder implements verbatim)

```
CRITICAL — Invoice billed at wrong amount

Account:        Orion Payments, Inc.
Objects:        Quote Q-889 → Invoice INV-2201
Quote amount:   $26,400 USD
Invoice amount: $24,000 USD
Delta:          -$2,400 (9.1%)
Invoice paid:   Yes — 2026-04-02

WHAT BROKE
The customer was charged $2,400 less than the approved quote amount.
The discount approval workflow in Salesforce CPQ ran after the Stripe
invoice trigger had already fired, updating the quote amount
retroactively without re-triggering billing.

WHICH SYSTEM OWNS IT
Quote: Salesforce CPQ
Invoice trigger: Zapier Zap "CPQ Quote Accepted → Stripe Invoice"
The Zap fires on Quote status = Accepted. The discount ran 4 minutes
later. The Zap had already fired and does not re-check the amount.

THE FIX
1. Add a 10-minute delay after "Quote Accepted" before triggering
   the Stripe invoice — allows discount approvals to resolve first
2. For INV-2201: issue a corrective invoice for $2,400 to Orion
   Payments, Inc. and confirm payment
3. Audit the last 90 days of invoices for amount deltas > 2%
   against their upstream quote (this rule catches the population)
```

Two data paths are supported:

1. A synthetic sample dataset in `public/q2see/data/`, hydrated on first load so reviewers can inspect the flow immediately.
2. A real import path through `POST /q2see/analyze`, where a Cloudflare Pages Function parses an uploaded CSV or JSON export server-side, maps each row into Q2C objects, runs the six detection rules, and returns a graph plus findings.

---

## 7. Technical architecture

### Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Astro static page plus Cloudflare Pages Function | Static shell, real import backend |
| Component layer | Vanilla TypeScript | Lightweight graph, import controls, inspector, and findings rail |
| Graph rendering | Inline SVG | Deterministic flow graph without a heavy runtime |
| Styling | CSS custom properties + scoped CSS | No Tailwind noise; tokens match brand palette |
| Sample data | Static JSON fixtures in `public/q2see/data/` | Zero-friction review path |
| Imported data | `functions/q2see/analyze.js` | Server-side parsing and detection over uploaded CSV/JSON |
| Deploy | Wrangler / Cloudflare Pages | Static UI plus Pages Function at `/q2see/analyze` |
| TypeScript | Strict mode | Existing demo standard |

### Graph rendering approach

The shipped UI renders the five object types in an inline SVG graph. Layout is computed in the client component from either the bundled sample or the backend response. Five columns represent opportunity, quote, contract, invoice, and renewal; within each column, nodes are sorted by revenue and finding severity.

On mount: the graph loads the sample dataset and preselects a critical finding. On import: the browser posts the uploaded export to `/q2see/analyze`, then swaps the graph, findings rail, and boundary banner to the user's uploaded data.

Each node receives its data object and finding state. Flagged nodes receive severity classes that drive border color, glow, and pulse animation. The inspector panel reads the selected node from the component state and renders the corresponding explanation and next action.

### Rules as data

All six handoff break rules are pure functions exported from `functions/q2see/analyze.js`, so they can run inside a Cloudflare Pages Function and in unit tests without a Workers runtime:

```typescript
type RuleResult = { finding: Finding | null };
type Rule = (records: DataSet) => RuleResult[];

export const orphanedContractRule: Rule = (ds) =>
  ds.contracts
    .filter(c => c.status === "Executed")
    .filter(c => !ds.invoices.some(i => i.contract_id === c.id))
    .map(c => ({ finding: buildFinding("B-01", c) }));

export const amountMismatchRule: Rule = (ds) =>
  ds.invoices
    .filter(inv => {
      const quote = ds.quotes.find(q => q.id === inv.quote_id);
      if (!quote) return false;
      const delta = Math.abs(inv.amount_usd - quote.amount_usd) / quote.amount_usd;
      return delta > 0.01;
    })
    .map(inv => ({ finding: buildFinding("B-02", inv) }));
```

The bundled sample includes precomputed JSON so the first screen appears immediately. Uploaded exports are analyzed by the Pages Function, and the returned dataset becomes the graph/finding source in the browser. The same pure helpers are covered by `tests/q2see-analyze.test.js`.

### File structure

```
src/
  pages/
    q2see/
      index.astro       # page shell, import panel, graph mount
  components/
    q2see/
      app.ts            # sample loading, import POST, SVG graph, inspector
functions/
  q2see/
    analyze.js          # CSV/JSON parsing, six detection rules, edge building
tests/
  q2see-analyze.test.js # parser and rules tests
public/
  q2see/
    sample-q2c-export.csv
    data/
      opportunities.json
      quotes.json
      contracts.json
      invoices.json
      renewals.json
      findings.json
      edges.json
styles/
  q2see.css
```

---

## 8. Scope: in / out

### In

- Static Astro site at `demos.dallascrilley.com/q2see`
- Real Cloudflare Pages Function backend at `POST /q2see/analyze`
- Five-node-type flow graph with zoom/pan/click navigation
- Six handoff-break rules, each producing structured findings on the sample or an uploaded export
- Auto-center on most critical finding on load
- Inspector panel: healthy + flagged node detail (verbatim text per §6)
- Findings rail: all active anomalies, "jump to node" links
- Filter bar: by severity, object type
- Synthetic sample banner plus uploaded-data boundary state
- Landing/marketing one-pager at `/q2see/` with problem framing, demo CTA, honest limits
- Responsive layout (desktop primary; tablet functional; mobile read-only fallback)

### Out

- Real Salesforce CPQ / Ironclad / Stripe OAuth connections (architecture documented, not wired)
- Editable records or "fix" actions that persist changes
- Database, API keys, or secrets of any kind
- Multi-user / workspace / auth layer
- CSV export from the analyzed result (nice-to-have, deferred)
- Animated Sankey view (expensive; the graph is sufficient)

---

## 9. Synthetic data banner — copy and design

The banner is the demo's honesty signal. It is persistent (not dismissible on the landing page), dismissible per session inside the app (via `sessionStorage`), and written in the same voice as the inspector panel.

**Banner copy (app view, top of viewport):**

> **Synthetic data — these breaks are real, these accounts aren't.**
> Every finding in this demo was planted from a pattern that actually appears in production Q2C systems. The account names are fictional. The failure modes are not.
> [Dismiss for this session ×]

**Banner copy (landing page, below the hero):**

> **A note on the data:** The default Q2See sample uses synthetic records. You can also upload a point-in-time Quote-to-Cash CSV or JSON export, which the backend parses and inspects server-side. There is no live Salesforce, Stripe, or Workato OAuth connection, no storage, and no remediation writeback. The six handoff breaks are reproductions of real failure patterns — the kind of breaks that appear when CPQ, CLM, and billing run on separate triggers with no shared observable layer. The tool is a proof of concept, not a production product.

This framing is a senior tell. A candidate who plants specific, realistic breaks and explains what class of production bug each represents is demonstrating domain ownership — not hiding behind "synthetic data" as an apology.

---

## 10. Acceptance criteria

| AC | Criterion | Pass condition |
|---|---|---|
| AC-1 | Loads over HTTPS | `https://demos.dallascrilley.com/q2see` returns 200 with valid TLS |
| AC-2 | Graph renders on load | Five node columns visible; at least 30 nodes rendered; graph centered on B-01 |
| AC-3 | B-01 pre-highlighted | Crestline Digital / C-1042 is red-glowing with inspector pre-populated on first load |
| AC-4 | Node click opens inspector | Clicking any node opens inspector with correct object data in < 100ms |
| AC-5 | All six findings in rail | B-01 through B-06 appear in findings rail with correct severity and account name |
| AC-6 | Findings link to nodes | "Jump to node" centers graph on correct node and opens inspector |
| AC-7 | Inspector verbatim text | B-01 and B-02 inspector text matches §6 verbatim copy exactly |
| AC-8 | Synthetic data banner present | Banner visible on first app load; dismisses per session; returns on new session |
| AC-9 | No secrets in source | `wrangler pages deploy` dry-run produces no secret/key warnings |
| AC-10 | Filter bar narrows graph | "Critical" filter hides non-critical nodes and edges |
| AC-11 | Responsive at 768px | Graph and inspector remain usable at tablet breakpoint |
| AC-12 | System owner named in finding | Every flagged node inspector names the owning system (CPQ / CLM / Workato / Zapier / etc.) |

---

## 11. Build sequence

### Phase 1 — Foundation (Days 1–3)

- Scaffold Astro page at `/q2see` and `/q2see/app`
- Define TypeScript types (`types.ts`)
- Author synthetic JSON fixtures — named accounts per §6 cast table; exact values for B-01/B-02 verbatim findings
- Implement six rules (`rules.ts`) and validate they produce the correct findings against fixtures
- Stand up React Flow in a bare Preact island; confirm nodes render from fixture data
- Implement dagre layout (`layout.ts`); validate five-column layout with full 142-node fixture

### Phase 2 — Graph + Inspector (Days 4–7)

- Build five custom node components per visual spec (§5 node shape, severity classes, pulse animation)
- Wire edge rendering with severity-colored strokes at specified opacity
- Build Inspector panel — healthy node view first, then flagged node view with verbatim finding text
- Build Findings rail — severity icons, account names, "jump to node" links
- Wire auto-center on B-01 at mount
- Wire atom: clicking a node or a finding both open the inspector and center the graph

### Phase 3 — Filter, banner, marketing shell (Days 8–10)

- Filter bar (severity + object type)
- Synthetic data banner with voiced copy per §9
- Landing page at `/q2see/` — problem framing using the "Signed contract. No invoice." hook; the six flagship findings listed with account names; demo CTA; honest limits section
- CSS pass: dark-surface tokens, node glow animations, inspector typography, mono/sans register separation
- Responsive pass: 768px breakpoint, mobile read-only fallback

### Phase 4 — Polish + deploy (Days 11–14)

- Wrangler Pages deploy configuration
- HTTPS + custom domain routing (`demos.dallascrilley.com/q2see`)
- Lighthouse pass (LCP < 2.5s, CLS < 0.1)
- Acceptance criteria verification pass (all 12 ACs green)
- Anti-template design review: does the first viewport look like a diagnostic console, not a dashboard template?

---

## 12. Open questions / risks

| Item | Risk | Note |
|---|---|---|
| React Flow bundle size | Medium | `@xyflow/react` adds ~80–120 kb gzipped. Total JS budget is 300 kb. Mitigate: dynamic import the island. Verify with `pnpm build --analyze` in Phase 1. |
| Dagre layout quality | Low | Dagre produces reasonable layered layouts; may need manual y-position overrides for dense columns. Validate in Phase 1 with full fixture before committing. |
| "Dark aesthetic" readability | Low | Run `pa11y` against inspector panel copy; all text must be `oklch(92% …)` or higher on `oklch(12% …)` surface. Mono labels at 11px are the highest-risk line. |
| "This looks like a Figma mockup" | Medium | Mitigate: node click interaction < 100ms; use real field values from fixture (no placeholder text); findings rail updates correctly when filter changes. The verbatim inspector text in §6 is the primary mitigation — placeholder text is the tell. |
| Synthetic data believability | Low | The named account cast (§6) and the verbatim Workato recipe name in B-01 are the primary believability signals. Do not use generic "Company A" style placeholders anywhere. |
| React Flow vs. plain SVG | Low | If React Flow proves awkward, fall back to a plain SVG renderer with CSS animations. More build work but cleaner bundle. |
