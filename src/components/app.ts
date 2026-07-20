/**
 * Q2See — Quote-to-Cash Flow Inspector
 * Client-side app: SVG flow graph, inspector panel, findings rail, filter bar.
 * Vanilla TS + inline SVG. Zero npm dependencies beyond what's already in the repo.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface Opportunity {
  id: string; name: string; account: string; stage: string;
  arr_usd: number; close_date: string; owner_id: string;
}
interface Quote {
  id: string; opportunity_id: string; status: string;
  amount_usd: number; currency: string; tax_rate: number;
  created_at: string; approved_at: string | null;
}
interface Contract {
  id: string; quote_id: string; opportunity_id: string;
  status: string; executed_at: string | null;
  term_start: string; term_end: string; arr_usd: number; entity: string;
}
interface Invoice {
  id: string; contract_id: string; quote_id: string;
  status: string; amount_usd: number; currency: string;
  issued_at: string; due_at: string; paid_at: string | null;
  days_overdue: number;
}
interface Renewal {
  id: string; contract_id: string; renewal_date: string;
  owner_id: string | null; status: string;
  arr_usd: number; days_until_renewal: number;
}
interface HandoffEdge {
  from_id: string; to_id: string;
  from_type: string; to_type: string;
  status: 'healthy' | 'warning' | 'broken' | 'at-risk';
  finding_id: string | null;
}
interface Finding {
  id: string; severity: 'critical' | 'warning' | 'at-risk';
  type: string; title: string; account: string;
  description: string; system_owner: string; fix: string;
  affected_ids: string[];
  // Present on orphaned_contract findings: a missing downstream object to render
  // as a ghost node (synthetic data hardcodes this client-side; the import
  // backend emits it directly).
  ghost?: { type: string; for_contract: string; account: string; arr_usd: number };
}

interface DataSet {
  opportunities: Opportunity[];
  quotes: Quote[];
  contracts: Contract[];
  invoices: Invoice[];
  renewals: Renewal[];
  edges: HandoffEdge[];
  findings: Finding[];
}

// Node in the layout
interface LayoutNode {
  id: string;
  type: 'opportunity' | 'quote' | 'contract' | 'invoice' | 'renewal';
  label: string;       // short ID
  account: string;     // abbreviated name
  arr_usd: number;
  status: string;
  findingId: string | null;
  severity: 'healthy' | 'warning' | 'broken' | 'at-risk';
  cx: number; cy: number; w: number; h: number;
  isAggregate?: boolean;   // true for the collapsed "+N healthy" ghost marker
  aggregateCount?: number; // number of healthy records this represents
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const COL_ORDER = ['opportunity', 'quote', 'contract', 'invoice', 'renewal'] as const;
const COL_X = { opportunity: 110, quote: 310, contract: 510, invoice: 710, renewal: 910 };
// Signature (named-deal) nodes are larger for legibility
const NODE_W = 160;
const NODE_H = 56;
const NODE_GAP = 16;
// Aggregate ghost pill dimensions
const AGG_W = 160;
const AGG_H = 28;
const COL_HEADER_Y = 30;
const FIRST_NODE_Y = 60;
const SVG_PAD_RIGHT = 80;
const SVG_PAD_BOTTOM = 40;

// ─── App state ────────────────────────────────────────────────────────────────

let ds: DataSet | null = null;
let nodes: LayoutNode[] = [];
let activeNodeId: string | null = null;
let activeFilters: Set<string> = new Set(); // severity filters
let activeTypes: Set<string> = new Set(); // object-type filters (contract/invoice/renewal)
let activeFindingId: string | null = null;

// pan/zoom
let vpX = 0, vpY = 0, vpScale = 1;
let isPanning = false;
let panStart = { x: 0, y: 0 };

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadData(): Promise<DataSet> {
  const base = '/q2see/data';
  const [opportunities, quotes, contracts, invoices, renewals, edges, findings] =
    await Promise.all([
      fetch(`${base}/opportunities.json`).then(r => r.json()),
      fetch(`${base}/quotes.json`).then(r => r.json()),
      fetch(`${base}/contracts.json`).then(r => r.json()),
      fetch(`${base}/invoices.json`).then(r => r.json()),
      fetch(`${base}/renewals.json`).then(r => r.json()),
      fetch(`${base}/edges.json`).then(r => r.json()),
      fetch(`${base}/findings.json`).then(r => r.json()),
    ]);
  return { opportunities, quotes, contracts, invoices, renewals, edges, findings };
}

// ─── Rules evaluation ─────────────────────────────────────────────────────────
// Rules run on the client to keep filtering consistent.

function buildNodeSeverity(id: string, dataset: DataSet): { findingId: string | null; severity: 'healthy' | 'warning' | 'broken' | 'at-risk' } {
  for (const f of dataset.findings) {
    if (f.affected_ids.includes(id)) {
      const sev = f.severity === 'critical' ? 'broken'
                : f.severity === 'warning'  ? 'warning'
                : 'at-risk';
      return { findingId: f.id, severity: sev };
    }
  }
  return { findingId: null, severity: 'healthy' };
}

// ─── Layout computation ───────────────────────────────────────────────────────

function computeLayout(dataset: DataSet): LayoutNode[] {
  const result: LayoutNode[] = [];

  // All record IDs that appear in any finding — these are the "signature deals"
  const signatureIds = new Set<string>();
  for (const f of dataset.findings) {
    for (const id of f.affected_ids) signatureIds.add(id);
  }
  // The missing invoice ghost node is always a signature node
  signatureIds.add('MISSING-INV-C-1042');

  // Track Y positions per column
  const colY: Record<string, number> = {
    opportunity: FIRST_NODE_Y, quote: FIRST_NODE_Y, contract: FIRST_NODE_Y,
    invoice: FIRST_NODE_Y, renewal: FIRST_NODE_Y
  };

  // Add a signature node (named deal — full size, legible)
  function addSignatureNode(type: typeof COL_ORDER[number], id: string, label: string, account: string, arr: number, status: string): LayoutNode {
    const { findingId, severity } = buildNodeSeverity(id, dataset);
    const cx = COL_X[type];
    const cy = colY[type];
    colY[type] += NODE_H + NODE_GAP;
    const node: LayoutNode = { id, type, label, account, arr_usd: arr, status, findingId, severity, cx, cy: cy + NODE_H / 2, w: NODE_W, h: NODE_H };
    result.push(node);
    return node;
  }

  // Add the aggregate ghost pill after signature nodes for a column
  function addAggregateNode(type: typeof COL_ORDER[number], count: number): void {
    if (count <= 0) return;
    const cx = COL_X[type];
    const cy = colY[type];
    colY[type] += AGG_H + NODE_GAP;
    result.push({
      id: `AGG-${type}`,
      type,
      label: `+${count} healthy`,
      account: '',
      arr_usd: 0,
      status: 'healthy',
      findingId: null,
      severity: 'healthy',
      cx, cy: cy + AGG_H / 2,
      w: AGG_W, h: AGG_H,
      isAggregate: true,
      aggregateCount: count,
    });
  }

  // Sort: broken first, then warning, then at-risk, then healthy; within severity by arr desc
  function severityRank(id: string): number {
    const { severity } = buildNodeSeverity(id, dataset);
    return severity === 'broken' ? 0 : severity === 'warning' ? 1 : severity === 'at-risk' ? 2 : 3;
  }

  // ── Opportunities ──
  const opps = [...dataset.opportunities].sort((a, b) => {
    const ra = severityRank(a.id), rb = severityRank(b.id);
    if (ra !== rb) return ra - rb;
    return b.arr_usd - a.arr_usd;
  });
  let oppHealthyCount = 0;
  for (const opp of opps) {
    if (signatureIds.has(opp.id)) {
      addSignatureNode('opportunity', opp.id, opp.id, opp.name, opp.arr_usd, opp.stage);
    } else {
      oppHealthyCount++;
    }
  }
  addAggregateNode('opportunity', oppHealthyCount);

  // ── Quotes ──
  const quotes = [...dataset.quotes].sort((a, b) => {
    const ra = severityRank(a.id), rb = severityRank(b.id);
    if (ra !== rb) return ra - rb;
    return b.amount_usd - a.amount_usd;
  });
  let quoteHealthyCount = 0;
  for (const q of quotes) {
    if (signatureIds.has(q.id)) {
      const oppName = dataset.opportunities.find(o => o.id === q.opportunity_id)?.name ?? '';
      addSignatureNode('quote', q.id, q.id, oppName, q.amount_usd, q.status);
    } else {
      quoteHealthyCount++;
    }
  }
  addAggregateNode('quote', quoteHealthyCount);

  // ── Contracts ──
  const contracts = [...dataset.contracts].sort((a, b) => {
    const ra = severityRank(a.id), rb = severityRank(b.id);
    if (ra !== rb) return ra - rb;
    return b.arr_usd - a.arr_usd;
  });
  let contractHealthyCount = 0;
  for (const c of contracts) {
    if (signatureIds.has(c.id)) {
      const oppName = dataset.opportunities.find(o => o.id === c.opportunity_id)?.name ?? '';
      addSignatureNode('contract', c.id, c.id, oppName, c.arr_usd, c.status);
    } else {
      contractHealthyCount++;
    }
  }
  addAggregateNode('contract', contractHealthyCount);

  // ── Invoices ──
  const invoices = [...dataset.invoices].sort((a, b) => {
    const ra = severityRank(a.id), rb = severityRank(b.id);
    if (ra !== rb) return ra - rb;
    return b.amount_usd - a.amount_usd;
  });
  let invoiceHealthyCount = 0;
  for (const inv of invoices) {
    if (signatureIds.has(inv.id)) {
      const contract = dataset.contracts.find(c => c.id === inv.contract_id);
      const oppName = contract ? (dataset.opportunities.find(o => o.id === contract.opportunity_id)?.name ?? '') : '';
      addSignatureNode('invoice', inv.id, inv.id, oppName, inv.amount_usd, inv.status);
    } else {
      invoiceHealthyCount++;
    }
  }
  // Ghost invoice node for every "contract executed, no invoice" finding.
  // Synthetic findings name the contract via affected_ids; the import backend
  // emits an explicit `ghost` marker. Either way we render an empty invoice slot.
  for (const f of dataset.findings) {
    if (f.type !== 'orphaned_contract') continue;
    const contractId = f.ghost?.for_contract ?? f.affected_ids.find(id => dataset.contracts.some(c => c.id === id));
    if (!contractId) continue;
    const contract = dataset.contracts.find(c => c.id === contractId);
    const account = f.ghost?.account ?? f.account ?? (contract ? contract.entity : '');
    const arr = f.ghost?.arr_usd ?? contract?.arr_usd ?? 0;
    const cx = COL_X['invoice'];
    const cy = colY['invoice'];
    colY['invoice'] += NODE_H + NODE_GAP;
    result.push({ id: `MISSING-INV-${contractId}`, type: 'invoice', label: 'INV-????', account, arr_usd: arr, status: 'MISSING', findingId: f.id, severity: 'broken', cx, cy: cy + NODE_H / 2, w: NODE_W, h: NODE_H });
  }
  addAggregateNode('invoice', invoiceHealthyCount);

  // ── Renewals ──
  const renewals = [...dataset.renewals].sort((a, b) => {
    const ra = severityRank(a.id), rb = severityRank(b.id);
    if (ra !== rb) return ra - rb;
    return b.arr_usd - a.arr_usd;
  });
  let renewalHealthyCount = 0;
  for (const r of renewals) {
    if (signatureIds.has(r.id)) {
      const contract = dataset.contracts.find(c => c.id === r.contract_id);
      const oppName = contract ? (dataset.opportunities.find(o => o.id === contract.opportunity_id)?.name ?? '') : '';
      addSignatureNode('renewal', r.id, r.id, oppName, r.arr_usd, r.status);
    } else {
      renewalHealthyCount++;
    }
  }
  addAggregateNode('renewal', renewalHealthyCount);

  return result;
}

// ─── SVG rendering ────────────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

function renderGraph() {
  if (!ds) return;
  const svg = document.getElementById('q2-svg') as unknown as SVGSVGElement | null;
  if (!svg) return;

  const g = document.getElementById('q2-graph-g');
  if (!g) return;

  // Clear
  while (g.firstChild) g.removeChild(g.firstChild);

  // Map SVG user units 1:1 to screen pixels. All pan/zoom math (focusNode,
  // centerOnNode, wheel zoom) computes translates in pixel terms, so the
  // viewBox must match the element's pixel box. Previously it was set to the
  // content size (~1070x488) while #q2-svg is height:100% with
  // preserveAspectRatio="none", which stretched the graph ~2x vertically and
  // crammed it to the bottom of the canvas (read as blank at tall viewports).
  const svgRect = svg.getBoundingClientRect();
  const vw = svgRect.width || 1040;
  const vh = svgRect.height || 600;
  svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);

  // Defs: arrowheads
  const defs = svgEl('defs', {});
  for (const [cls, color] of [
    ['healthy', 'oklch(55% 0.08 145 / 0.6)'],
    ['warning', 'oklch(72% 0.18 80)'],
    ['broken',  'oklch(60% 0.22 25)'],
    ['at-risk', 'oklch(68% 0.20 55)'],
  ] as [string, string][]) {
    const marker = svgEl('marker', { id: `arrow-${cls}`, markerWidth: '6', markerHeight: '6', refX: '5', refY: '3', orient: 'auto' });
    const poly = svgEl('polygon', { points: '0 0, 6 3, 0 6', fill: color });
    marker.appendChild(poly);
    defs.appendChild(marker);
  }
  g.appendChild(defs);

  // Column header lines and labels
  for (const [type, cx] of Object.entries(COL_X) as [string, number][]) {
    const label = svgEl('text', {
      x: cx,
      y: COL_HEADER_Y - 4,
      'text-anchor': 'middle',
      class: 'q2-col-header',
      fill: 'oklch(55% 0.01 250)',
      'font-family': 'Geist Mono, monospace',
      'font-size': '9',
      'font-weight': '600',
    });
    label.textContent = type.toUpperCase();
    g.appendChild(label);
  }

  // Determine active severity filters
  const filterBroken  = activeFilters.has('critical');
  const filterWarning = activeFilters.has('warning');
  const filterRisk    = activeFilters.has('at-risk');
  const anyFilter     = filterBroken || filterWarning || filterRisk;
  const anyTypeFilter = activeTypes.size > 0;

  function nodeVisible(node: LayoutNode): boolean {
    if (anyTypeFilter && !activeTypes.has(node.type)) return false;
    if (!anyFilter) return true;
    if (filterBroken  && node.severity === 'broken')  return true;
    if (filterWarning && node.severity === 'warning')  return true;
    if (filterRisk    && node.severity === 'at-risk')  return true;
    return false;
  }

  // Build a set of rendered node IDs for edge filtering
  const renderedIds = new Set(nodes.filter(n => !n.isAggregate).map(n => n.id));

  // Edges — draw behind nodes; only show edges between rendered (signature) nodes
  const edgeGroup = svgEl('g', { id: 'q2-edges' });
  for (const edge of ds.edges) {
    // Skip edges where either endpoint is not a rendered signature node
    if (!renderedIds.has(edge.from_id) || !renderedIds.has(edge.to_id)) continue;

    const fromNode = nodes.find(n => n.id === edge.from_id);
    const toNode   = nodes.find(n => n.id === edge.to_id);
    if (!fromNode || !toNode) continue;

    // Filter visibility
    const edgeVis = !anyFilter || nodeVisible(fromNode) || nodeVisible(toNode);

    // Selected dimming
    let dimmed = false;
    if (activeNodeId) {
      dimmed = !(edge.from_id === activeNodeId || edge.to_id === activeNodeId);
    }

    const x1 = fromNode.cx + fromNode.w / 2;
    const y1 = fromNode.cy;
    const x2 = toNode.cx - toNode.w / 2;
    const y2 = toNode.cy;
    const cpx = (x1 + x2) / 2;

    const path = svgEl('path', {
      d: `M ${x1} ${y1} C ${cpx} ${y1}, ${cpx} ${y2}, ${x2} ${y2}`,
      class: `q2-edge ${edge.status}${dimmed ? ' dimmed' : ''}`,
      'marker-end': `url(#arrow-${edge.status})`,
      opacity: !edgeVis ? '0.05' : '',
    });
    edgeGroup.appendChild(path);
  }
  g.appendChild(edgeGroup);

  // Nodes — draw on top
  const nodeGroup = svgEl('g', { id: 'q2-nodes' });
  for (const node of nodes) {
    const vis = nodeVisible(node);

    // ── Aggregate ghost pill ──────────────────────────────────────────────
    if (node.isAggregate) {
      const aggOpacity = activeNodeId ? '0.18' : (!vis ? '0.06' : '0.35');
      const agg = svgEl('g', {
        class: 'q2-node-aggregate',
        opacity: aggOpacity,
      });
      const pill = svgEl('rect', {
        x: node.cx - node.w / 2,
        y: node.cy - node.h / 2,
        width: node.w,
        height: node.h,
        rx: node.h / 2,
        fill: 'none',
        stroke: 'oklch(55% 0.01 250)',
        'stroke-width': '1',
        'stroke-dasharray': '4 3',
      });
      agg.appendChild(pill);
      const aggLabel = svgEl('text', {
        x: node.cx,
        y: node.cy + 4,
        'text-anchor': 'middle',
        'font-family': 'Geist Mono, monospace',
        'font-size': '9',
        fill: 'oklch(48% 0.01 250)',
      });
      aggLabel.textContent = `+${node.aggregateCount} healthy records`;
      agg.appendChild(aggLabel);
      nodeGroup.appendChild(agg);
      continue;
    }

    // ── Signature (named deal) node ───────────────────────────────────────
    const isSelected = node.id === activeNodeId;
    const isDimmed   = activeNodeId ? !isSelected : false;

    const cls = [
      'q2-node',
      node.severity,
      isSelected ? 'selected' : '',
      isDimmed    ? 'dimmed'   : '',
    ].filter(Boolean).join(' ');

    const g2 = svgEl('g', {
      class: cls,
      'data-node-id': node.id,
      opacity: !vis ? '0.08' : '',
    });

    // Background rect
    const rect = svgEl('rect', {
      class: 'q2-node-rect',
      x: node.cx - node.w / 2,
      y: node.cy - node.h / 2,
      width: node.w,
      height: node.h,
      rx: 6,
    });
    g2.appendChild(rect);

    // Severity dot (top-right corner)
    if (node.severity !== 'healthy') {
      const dotColor = node.severity === 'broken' ? 'oklch(60% 0.22 25)'
                     : node.severity === 'warning' ? 'oklch(72% 0.18 80)'
                     : 'oklch(68% 0.20 55)';
      const dot = svgEl('circle', {
        cx: node.cx + node.w / 2 - 10,
        cy: node.cy - node.h / 2 + 10,
        r: '4',
        fill: dotColor,
        class: 'q2-node-dot',
      });
      g2.appendChild(dot);
    }

    // Account name — top text, prominent (the human-readable label)
    const accountText = node.id.startsWith('MISSING-') ? 'Crestline Digital' : node.account;
    const accLabel = svgEl('text', {
      x: node.cx,
      y: node.cy - 9,
      'text-anchor': 'middle',
      'font-family': 'Inter, sans-serif',
      'font-size': '11',
      'font-weight': '600',
      fill: 'oklch(95% 0.01 250)',
    });
    // Truncate long names
    accLabel.textContent = accountText.length > 18 ? accountText.slice(0, 17) + '…' : accountText;
    g2.appendChild(accLabel);

    // Record ID — bottom text, mono, muted-green
    const idLabel = svgEl('text', {
      x: node.cx,
      y: node.cy + 9,
      'text-anchor': 'middle',
      'font-family': 'Geist Mono, monospace',
      'font-size': '10',
      fill: 'oklch(72% 0.10 145)',
    });
    idLabel.textContent = node.label.length > 16 ? node.label.slice(0, 15) + '…' : node.label;
    g2.appendChild(idLabel);

    // MISSING node: extra "NOT CREATED" warning line
    if (node.id.startsWith('MISSING-')) {
      const missing = svgEl('text', {
        x: node.cx,
        y: node.cy + 23,
        'text-anchor': 'middle',
        'font-family': 'Geist Mono, monospace',
        'font-size': '8',
        fill: 'oklch(60% 0.22 25)',
      });
      missing.textContent = '⚠ NOT CREATED';
      g2.appendChild(missing);
    }

    g2.addEventListener('click', () => selectNode(node.id));
    nodeGroup.appendChild(g2);
  }
  g.appendChild(nodeGroup);

  applyTransform();
}

function applyTransform() {
  const g = document.getElementById('q2-graph-g');
  if (!g) return;
  g.setAttribute('transform', `translate(${vpX}, ${vpY}) scale(${vpScale})`);
}

// ─── Node selection ──────────────────────────────────────────────────────────

function selectNode(nodeId: string) {
  activeNodeId = nodeId;
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return;

  renderGraph();
  renderInspector(node);
  highlightFindingCard(node.findingId);
}

function selectFinding(finding: Finding) {
  // Find the primary affected node (first in affected_ids that matches a node)
  const nodeId = finding.affected_ids.find(id => nodes.some(n => n.id === id));
  if (nodeId) {
    activeNodeId = nodeId;
    const node = nodes.find(n => n.id === nodeId);
    if (node) {
      renderGraph();
      renderInspector(node);
      centerOnNode(node);
    }
  }
  highlightFindingCard(finding.id);
}

function highlightFindingCard(findingId: string | null) {
  document.querySelectorAll('.q2-finding-card').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-finding-id') === findingId);
  });
}

// ─── Inspector panel ──────────────────────────────────────────────────────────

function getNodeFinding(node: LayoutNode): Finding | null {
  if (!ds || !node.findingId) return null;
  return ds.findings.find(f => f.id === node.findingId) ?? null;
}

function getObjectDetail(node: LayoutNode): Record<string, string> {
  if (!ds) return {};

  const fields: Record<string, string> = {};
  const formatDate = (d: string | null) => d ? d.slice(0, 10) : '—';
  const formatCurrency = (n: number, cur = 'USD') => `$${n.toLocaleString()} ${cur}`;

  switch (node.type) {
    case 'opportunity': {
      const opp = ds.opportunities.find(o => o.id === node.id);
      if (opp) {
        fields['Account'] = opp.name;
        fields['Stage'] = opp.stage;
        fields['ARR'] = formatCurrency(opp.arr_usd);
        fields['Close date'] = formatDate(opp.close_date);
        fields['Owner'] = opp.owner_id;
      }
      break;
    }
    case 'quote': {
      const q = ds.quotes.find(x => x.id === node.id);
      if (q) {
        const opp = ds.opportunities.find(o => o.id === q.opportunity_id);
        fields['Account'] = opp?.name ?? '—';
        fields['Status'] = q.status;
        fields['Amount'] = formatCurrency(q.amount_usd, q.currency);
        fields['Currency'] = q.currency;
        fields['Created'] = formatDate(q.created_at);
        fields['Approved'] = formatDate(q.approved_at);
        fields['Linked opp'] = q.opportunity_id;
      }
      break;
    }
    case 'contract': {
      const c = ds.contracts.find(x => x.id === node.id);
      if (c) {
        const opp = ds.opportunities.find(o => o.id === c.opportunity_id);
        fields['Account'] = opp?.name ?? '—';
        fields['Entity'] = c.entity;
        fields['Status'] = c.status;
        fields['ARR'] = formatCurrency(c.arr_usd);
        fields['Executed'] = formatDate(c.executed_at);
        fields['Term start'] = formatDate(c.term_start);
        fields['Term end'] = formatDate(c.term_end);
        fields['Linked quote'] = c.quote_id;
      }
      break;
    }
    case 'invoice': {
      if (node.id.startsWith('MISSING-')) {
        fields['Account'] = 'Crestline Digital';
        fields['Status'] = 'NOT CREATED';
        fields['Contract'] = 'C-1042';
        fields['Expected'] = '$48,000 USD';
        fields['Days missed'] = '77';
      } else {
        const inv = ds.invoices.find(x => x.id === node.id);
        if (inv) {
          const contract = ds.contracts.find(c => c.id === inv.contract_id);
          const opp = ds.opportunities.find(o => o.id === contract?.opportunity_id);
          fields['Account'] = opp?.name ?? '—';
          fields['Status'] = inv.status;
          fields['Amount'] = formatCurrency(inv.amount_usd, inv.currency);
          fields['Currency'] = inv.currency;
          fields['Issued'] = formatDate(inv.issued_at);
          fields['Due'] = formatDate(inv.due_at);
          fields['Paid'] = formatDate(inv.paid_at);
          fields['Linked contract'] = inv.contract_id;
        }
      }
      break;
    }
    case 'renewal': {
      const r = ds.renewals.find(x => x.id === node.id);
      if (r) {
        const contract = ds.contracts.find(c => c.id === r.contract_id);
        const opp = ds.opportunities.find(o => o.id === contract?.opportunity_id);
        fields['Account'] = opp?.name ?? '—';
        fields['Status'] = r.status;
        fields['Renewal date'] = formatDate(r.renewal_date);
        fields['ARR'] = formatCurrency(r.arr_usd);
        fields['Owner'] = r.owner_id ?? 'NULL — unassigned';
        fields['Days until'] = String(r.days_until_renewal);
        fields['Contract'] = r.contract_id;
      }
      break;
    }
  }
  return fields;
}

// Verbatim B-01 inspector text (per spec §6)
function setB01Inspector() {
  const hdr = document.getElementById('q2-inspector-header-inner');
  const body = document.getElementById('q2-inspector-body');
  if (hdr) hdr.innerHTML = `
    <div class="q2-inspector-severity critical">● CRITICAL</div>
    <div class="q2-inspector-title">Invoice never created</div>`;
  if (body) body.innerHTML = `
    <div class="q2-field-group">
      <div class="q2-field-group-title">Record</div>
      <div class="q2-field"><span class="q2-field-key">Account</span><span class="q2-field-value">Crestline Digital</span></div>
      <div class="q2-field"><span class="q2-field-key">Object</span><span class="q2-field-value">Contract C-1042</span></div>
      <div class="q2-field"><span class="q2-field-key">ARR</span><span class="q2-field-value">$48,000 USD</span></div>
      <div class="q2-field"><span class="q2-field-key">Executed</span><span class="q2-field-value">2026-03-14</span></div>
      <div class="q2-field"><span class="q2-field-key">Upstream quote</span><span class="q2-field-value">Q-771 (Accepted, $48,000 USD, 2026-03-12)</span></div>
    </div>
    <div class="q2-finding-section">
      <div class="q2-finding-section-label what">WHAT BROKE</div>
      <p class="q2-finding-prose">No invoice was created downstream of this contract.<br>Stripe has no record of a charge or subscription for this customer.<br>The contract has been executed for 77 days. $48,000 has not been collected.</p>
    </div>
    <div class="q2-finding-section">
      <div class="q2-finding-section-label who">WHICH SYSTEM OWNS IT</div>
      <div class="q2-finding-system">Billing trigger: Workato recipe cpq-to-stripe-prod
Last successful run: 2026-03-11 at 14:22 UTC
Current status: PAUSED
Cause: Recipe was suspended during Stripe API key rotation (2026-03-12).
The rotation completed. The recipe was never resumed.</div>
    </div>
    <div class="q2-finding-section">
      <div class="q2-finding-section-label fix">THE FIX</div>
      <div class="q2-finding-fix">1. Go to Workato → Recipes → cpq-to-stripe-prod
2. Resume the recipe
3. Manually trigger the "Contract Executed" event for C-1042
4. Confirm invoice INV-xxxx appears in Stripe within 5 minutes
5. Add a recipe health-check alert: notify #rev-ops-alerts if recipe
   is paused for &gt; 24 hours</div>
    </div>`;
}

// Verbatim B-02 inspector text (per spec §6)
function setB02Inspector() {
  const hdr = document.getElementById('q2-inspector-header-inner');
  const body = document.getElementById('q2-inspector-body');
  if (hdr) hdr.innerHTML = `
    <div class="q2-inspector-severity critical">● CRITICAL</div>
    <div class="q2-inspector-title">Invoice billed at wrong amount</div>`;
  if (body) body.innerHTML = `
    <div class="q2-field-group">
      <div class="q2-field-group-title">Record</div>
      <div class="q2-field"><span class="q2-field-key">Account</span><span class="q2-field-value">Orion Payments, Inc.</span></div>
      <div class="q2-field"><span class="q2-field-key">Objects</span><span class="q2-field-value">Quote Q-889 → Invoice INV-2201</span></div>
      <div class="q2-field"><span class="q2-field-key">Quote amount</span><span class="q2-field-value">$26,400 USD</span></div>
      <div class="q2-field"><span class="q2-field-key">Invoice amount</span><span class="q2-field-value">$24,000 USD</span></div>
      <div class="q2-field"><span class="q2-field-key">Delta</span><span class="q2-field-value">-$2,400 (9.1%)</span></div>
      <div class="q2-field"><span class="q2-field-key">Invoice paid</span><span class="q2-field-value">Yes — 2026-04-02</span></div>
    </div>
    <div class="q2-finding-section">
      <div class="q2-finding-section-label what">WHAT BROKE</div>
      <p class="q2-finding-prose">The customer was charged $2,400 less than the approved quote amount.<br>The discount approval workflow in Salesforce CPQ ran after the Stripe invoice trigger had already fired, updating the quote amount retroactively without re-triggering billing.</p>
    </div>
    <div class="q2-finding-section">
      <div class="q2-finding-section-label who">WHICH SYSTEM OWNS IT</div>
      <div class="q2-finding-system">Quote: Salesforce CPQ
Invoice trigger: Zapier Zap "CPQ Quote Accepted → Stripe Invoice"
The Zap fires on Quote status = Accepted. The discount ran 4 minutes
later. The Zap had already fired and does not re-check the amount.</div>
    </div>
    <div class="q2-finding-section">
      <div class="q2-finding-section-label fix">THE FIX</div>
      <div class="q2-finding-fix">1. Add a 10-minute delay after "Quote Accepted" before triggering
   the Stripe invoice — allows discount approvals to resolve first
2. For INV-2201: issue a corrective invoice for $2,400 to Orion
   Payments, Inc. and confirm payment
3. Audit the last 90 days of invoices for amount deltas &gt; 2%
   against their upstream quote (this rule catches the population)</div>
    </div>`;
}

function renderInspector(node: LayoutNode) {
  const panel = document.getElementById('q2-inspector');
  const headerEl = document.getElementById('q2-inspector-header-inner');
  const bodyEl = document.getElementById('q2-inspector-body');
  if (!panel || !headerEl || !bodyEl) return;

  panel.classList.remove('hidden');

  // Use verbatim text for B-01 (the finding affects C-1042, Q-771, OPP-7701, and the ghost MISSING node)
  if (node.findingId === 'B-01' || node.id === 'MISSING-INV-C-1042') {
    setB01Inspector();
    return;
  }
  // Use verbatim text for B-02
  if (node.findingId === 'B-02') {
    setB02Inspector();
    return;
  }

  const finding = getNodeFinding(node);
  const fields = getObjectDetail(node);

  const sevLabel = finding
    ? (finding.severity === 'critical' ? 'CRITICAL' : finding.severity === 'warning' ? 'WARNING' : 'AT RISK')
    : 'HEALTHY';
  const sevCls = finding
    ? (finding.severity === 'critical' ? 'critical' : finding.severity === 'warning' ? 'warning' : 'at-risk')
    : 'healthy';

  const fieldRows = Object.entries(fields).map(([k, v]) =>
    `<div class="q2-field"><span class="q2-field-key">${k}</span><span class="q2-field-value">${v}</span></div>`
  ).join('');

  let findingSections = '';
  if (finding) {
    findingSections = `
      <div class="q2-finding-section">
        <div class="q2-finding-section-label what">WHAT BROKE</div>
        <p class="q2-finding-prose">${finding.description.replace(/\n/g, '<br>')}</p>
      </div>
      <div class="q2-finding-section">
        <div class="q2-finding-section-label who">WHICH SYSTEM OWNS IT</div>
        <div class="q2-finding-system">${finding.system_owner}</div>
      </div>
      <div class="q2-finding-section">
        <div class="q2-finding-section-label fix">THE FIX</div>
        <div class="q2-finding-fix">${finding.fix}</div>
      </div>`;
  } else {
    findingSections = `<div class="q2-healthy-indicator"><div class="q2-healthy-dot"></div><span class="q2-healthy-text">No handoff breaks detected on this record.</span></div>`;
  }

  headerEl.innerHTML = `
    <div class="q2-inspector-severity ${sevCls}">● ${sevLabel}</div>
    <div class="q2-inspector-title">${finding ? finding.title : node.type.charAt(0).toUpperCase() + node.type.slice(1) + ' — ' + node.label}</div>
  `;

  bodyEl.innerHTML = `
    <div class="q2-field-group">
      <div class="q2-field-group-title">Record</div>
      ${fieldRows}
    </div>
    ${findingSections}
  `;
}

// ─── Findings rail rendering ──────────────────────────────────────────────────

function renderFindingsRail() {
  if (!ds) return;
  const list = document.getElementById('q2-findings-list');
  if (!list) return;

  const ordered = [...ds.findings].sort((a, b) => {
    const rank = (f: Finding) => f.severity === 'critical' ? 0 : f.severity === 'warning' ? 1 : 2;
    return rank(a) - rank(b);
  });

  list.innerHTML = ordered.map(f => `
    <div class="q2-finding-card" data-finding-id="${f.id}" role="button" tabindex="0" aria-label="Finding ${f.id}: ${f.account}">
      <div class="q2-finding-dot ${f.severity}"></div>
      <div class="q2-finding-card-inner">
        <div class="q2-finding-card-id">${f.id}</div>
        <div class="q2-finding-card-account">${f.account}</div>
        <div class="q2-finding-card-desc">${f.title}</div>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.q2-finding-card').forEach(card => {
    const findingId = card.getAttribute('data-finding-id');
    const onClick = () => {
      const finding = ds?.findings.find(f => f.id === findingId);
      if (finding) selectFinding(finding);
    };
    card.addEventListener('click', onClick);
    card.addEventListener('keydown', (e: Event) => {
      if ((e as KeyboardEvent).key === 'Enter') onClick();
    });
  });
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

function initFilterBar() {
  document.querySelectorAll('.q2-filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const sev = pill.getAttribute('data-severity');
      const type = pill.getAttribute('data-type');

      if (sev) {
        if (activeFilters.has(sev)) {
          activeFilters.delete(sev);
        } else {
          activeFilters.add(sev);
        }
        pill.classList.toggle('active', activeFilters.has(sev));
        pill.setAttribute('aria-pressed', String(activeFilters.has(sev)));
      } else if (type) {
        if (activeTypes.has(type)) {
          activeTypes.delete(type);
        } else {
          activeTypes.add(type);
        }
        pill.classList.toggle('active', activeTypes.has(type));
        pill.setAttribute('aria-pressed', String(activeTypes.has(type)));
      }

      renderGraph();
    });
  });
}

// ─── Pan & zoom ───────────────────────────────────────────────────────────────

function initPanZoom() {
  const svg = document.getElementById('q2-svg');
  if (!svg) return;

  svg.addEventListener('wheel', (e: Event) => {
    const we = e as WheelEvent;
    we.preventDefault();
    const delta = we.deltaY > 0 ? 0.9 : 1.1;
    vpScale = Math.max(0.3, Math.min(3, vpScale * delta));

    // Zoom toward cursor
    const rect = svg.getBoundingClientRect();
    const mx = we.clientX - rect.left;
    const my = we.clientY - rect.top;
    vpX = mx - (mx - vpX) * delta;
    vpY = my - (my - vpY) * delta;

    applyTransform();
  }, { passive: false });

  svg.addEventListener('mousedown', (e: Event) => {
    const me = e as MouseEvent;
    if ((me.target as Element).closest('.q2-node')) return; // let node click handle
    isPanning = true;
    panStart = { x: me.clientX - vpX, y: me.clientY - vpY };
    svg.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!isPanning) return;
    vpX = e.clientX - panStart.x;
    vpY = e.clientY - panStart.y;
    applyTransform();
  });

  window.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      svg.style.cursor = 'grab';
    }
  });

  // Touch pan
  let lastTouch = { x: 0, y: 0 };
  svg.addEventListener('touchstart', (e: Event) => {
    const te = e as TouchEvent;
    if (te.touches.length === 1) {
      lastTouch = { x: te.touches[0].clientX, y: te.touches[0].clientY };
    }
  });
  svg.addEventListener('touchmove', (e: Event) => {
    const te = e as TouchEvent;
    te.preventDefault();
    if (te.touches.length === 1) {
      const dx = te.touches[0].clientX - lastTouch.x;
      const dy = te.touches[0].clientY - lastTouch.y;
      vpX += dx; vpY += dy;
      lastTouch = { x: te.touches[0].clientX, y: te.touches[0].clientY };
      applyTransform();
    }
  }, { passive: false });

  // Zoom buttons
  document.getElementById('q2-zoom-in')?.addEventListener('click', () => {
    vpScale = Math.min(3, vpScale * 1.2);
    applyTransform();
  });
  document.getElementById('q2-zoom-out')?.addEventListener('click', () => {
    vpScale = Math.max(0.3, vpScale * 0.8);
    applyTransform();
  });
  document.getElementById('q2-zoom-reset')?.addEventListener('click', () => {
    centerOnNode(nodes.find(n => n.id === 'C-1042') ?? nodes[0]);
  });
}

// ─── Center on node ───────────────────────────────────────────────────────────

const GRAPH_TOP_PAD = 28;

// Vertical offset for the graph group. This is a short, wide diagram, so when it
// fits inside the canvas we top-anchor it (avoids large empty ledger space above
// and below on tall viewports); only when it overflows do we center on the node.
function graphTop(rectHeight: number, nodeCy: number): number {
  const contentH = (nodes.length ? Math.max(...nodes.map(n => n.cy + n.h / 2)) : 0) * vpScale;
  if (contentH + GRAPH_TOP_PAD * 2 <= rectHeight) return GRAPH_TOP_PAD;
  return rectHeight / 2 - nodeCy * vpScale;
}

function centerOnNode(node: LayoutNode) {
  const svg = document.getElementById('q2-svg');
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const cx = rect.width / 2;
  vpX = cx - node.cx * vpScale;
  vpY = graphTop(rect.height, node.cy);
  applyTransform();
}

// ─── Synthetic banner ─────────────────────────────────────────────────────────

function initBanner() {
  const banner = document.getElementById('q2-banner');
  const dismiss = document.getElementById('q2-banner-dismiss');
  if (!banner || !dismiss) return;

  const dismissed = sessionStorage.getItem('q2-banner-dismissed');
  if (dismissed) banner.remove();

  dismiss.addEventListener('click', () => {
    sessionStorage.setItem('q2-banner-dismissed', '1');
    banner.remove();
  });
}

// ─── Inspector close ──────────────────────────────────────────────────────────

function initInspectorClose() {
  document.getElementById('q2-inspector-close')?.addEventListener('click', () => {
    activeNodeId = null;
    const panel = document.getElementById('q2-inspector');
    panel?.classList.add('hidden');
    highlightFindingCard(null);
    renderGraph();
  });
}


// ─── Main init ────────────────────────────────────────────────────────────────

// Recompute layout + redraw for the current `ds`, then focus the most severe node.
// Used both on first load (synthetic) and after a successful import.
function renderDataset(focusId?: string) {
  if (!ds) return;
  activeNodeId = null;
  nodes = computeLayout(ds);
  renderGraph();
  renderFindingsRail();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const target = focusId && nodes.some(n => n.id === focusId) ? focusId : firstSevereNodeId();
      if (target) focusNode(target);
    });
  });
}

// Pick the highest-severity rendered node to open the inspector on by default.
function firstSevereNodeId(): string | null {
  const rank = (s: string) => s === 'broken' ? 0 : s === 'at-risk' ? 1 : s === 'warning' ? 2 : 3;
  const candidates = nodes.filter(n => n.severity !== 'healthy' && !n.isAggregate)
    .sort((a, b) => rank(a.severity) - rank(b.severity) || b.arr_usd - a.arr_usd);
  return candidates[0]?.id ?? nodes.find(n => !n.isAggregate)?.id ?? null;
}

// Center + select a node (generalized from the old synthetic-only focusB01).
function focusNode(id: string) {
  const node = nodes.find(n => n.id === id);
  if (!node || !ds) return;
  vpScale = 0.82;
  const svg = document.getElementById('q2-svg');
  if (svg) {
    const rect = svg.getBoundingClientRect();
    vpX = rect.width * 0.5 - node.cx * vpScale;
    vpY = graphTop(rect.height, node.cy);
  }
  selectNode(id);
}

// ─── Import (real backend) ──────────────────────────────────────────────────────

function setMode(label: string, isUploaded: boolean) {
  const badge = document.getElementById('q2-nav-mode-badge');
  if (badge) {
    badge.textContent = label;
    badge.classList.toggle('q2-nav-badge--live', isUploaded);
  }
}

async function runImport(raw: string, name: string) {
  const status = document.getElementById('q2-import-status');
  if (status) { status.textContent = 'Analyzing…'; status.className = 'q2-import-status'; }
  try {
    const res = await fetch('/q2see/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ raw, name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `Server returned ${res.status}`);
    ds = {
      opportunities: data.opportunities, quotes: data.quotes, contracts: data.contracts,
      invoices: data.invoices, renewals: data.renewals, edges: data.edges, findings: data.findings,
    };
    renderDataset();
    setMode(`your data · ${data.stats.findings} findings`, true);
    if (status) {
      status.className = 'q2-import-status q2-import-status--ok';
      status.textContent = `Analyzed ${name}: ${data.stats.findings} findings across ${data.stats.opportunities} deals (${data.stats.critical} critical).`;
    }
    // Rewrite the synthetic-data banner to reflect the honest uploaded-data boundary.
    const banner = document.getElementById('q2-banner');
    if (banner) {
      banner.classList.add('q2-banner--live');
      const icon = banner.querySelector('.q2-banner-icon');
      const text = banner.querySelector('.q2-banner-text');
      if (icon) icon.textContent = 'LIVE';
      if (text) text.innerHTML = `<strong>Your data — ${data.stats.opportunities} deals checked from the file you uploaded.</strong> ` +
        `These findings came from ${name}, not demo data. ` +
        `Nothing is stored. This is a one-time export check — not a live CRM connection.`;
    }
    document.getElementById('q2-import-panel')?.classList.add('hidden');
    document.getElementById('q2-import-toggle')?.setAttribute('aria-expanded', 'false');
  } catch (err) {
    console.error('[Q2See] Import failed:', err);
    if (status) {
      status.className = 'q2-import-status q2-import-status--err';
      status.textContent = err instanceof Error ? err.message : 'Import failed.';
    }
  }
}

function initImport() {
  const toggle = document.getElementById('q2-import-toggle');
  const panel = document.getElementById('q2-import-panel');
  const fileInput = document.getElementById('q2-import-file') as HTMLInputElement | null;
  const textarea = document.getElementById('q2-import-text') as HTMLTextAreaElement | null;
  const analyzeBtn = document.getElementById('q2-import-analyze');
  const sampleBtn = document.getElementById('q2-import-sample');

  toggle?.addEventListener('click', () => {
    const opening = panel?.classList.toggle('hidden') === false;
    toggle.setAttribute('aria-expanded', String(opening));
  });

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { if (textarea) textarea.value = String(reader.result || ''); runImport(textarea?.value || '', file.name); };
    reader.readAsText(file);
  });

  analyzeBtn?.addEventListener('click', () => {
    const raw = textarea?.value?.trim();
    if (!raw) { const s = document.getElementById('q2-import-status'); if (s) { s.className = 'q2-import-status q2-import-status--err'; s.textContent = 'Add a CSV or JSON export first — choose a file or paste rows below.'; } return; }
    runImport(raw, 'pasted-export.csv');
  });

  sampleBtn?.addEventListener('click', async () => {
    try {
      const text = await fetch('/q2see/sample-q2c-export.csv').then(r => r.text());
      if (textarea) textarea.value = text;
      runImport(text, 'sample-q2c-export.csv');
    } catch {
      const s = document.getElementById('q2-import-status'); if (s) { s.className = 'q2-import-status q2-import-status--err'; s.textContent = 'Could not load sample.'; }
    }
  });
}

async function init() {
  try {
    initFilterBar();
    initPanZoom();
    initBanner();
    initInspectorClose();
    initImport();

    ds = await loadData();
    renderDataset('C-1042'); // synthetic default focus
  } catch (err) {
    console.error('[Q2See] Failed to load data:', err);
    const wrap = document.getElementById('q2-graph-wrap');
    if (wrap) {
      wrap.innerHTML = '<div style="padding:2rem;color:oklch(60% 0.22 25);font-family:monospace">Failed to load Q2See data. Check console.</div>';
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
