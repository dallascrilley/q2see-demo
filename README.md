# Q2See

> **Signed contract. No invoice. Nobody's panicking yet. They will be.**

Q2See is a client-side Quote-to-Cash flow inspector. It visualizes contract → quote → invoice → renewal as an interactive SVG flow graph, flags broken handoffs, and surfaces exactly where revenue leaks before legal finds it. Synthetic data, no CRM credentials.

**Live demo:** [demos.dallascrilley.com/q2see](https://demos.dallascrilley.com/q2see)

## What it proves

- **RevOps systems depth** — models the full quote-to-cash lifecycle and the handoffs between opportunity, quote, contract, invoice, and renewal.
- **Graph visualization** — renders hierarchical business data as a pan/zoom SVG canvas with directed edges and severity-weighted nodes.
- **Record-level inspection** — click any node to see the full object state and the specific finding that flagged it.
- **Broken-handoff detection** — finds contracts without invoices, quotes without follow-up, and renewals that never got scheduled.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:4321`. The demo loads synthetic Q2C data from `public/data/`.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for design decisions, data schema, and tradeoffs.

## Honest limits

- **No live CRM** — does not connect to Salesforce, HubSpot, or NetSuite.
- **Synthetic records only** — all companies, deals, and amounts are fictional.
- **Static snapshot** — shows one moment in time, not historical trends.
- **No automated remediation** — surfaces gaps; a human decides the fix.

## License

MIT
