export const GUIDED_TOURS = {
  q2see: {
    repoLabel: 'Q2See',
    repoUrl: 'https://github.com/dallascrilley/q2see-demo',
    steps: [
      {
        label: 'Start with an export',
        body: 'Upload or paste a quote-to-cash CSV/JSON export; the sample shows opportunities, quotes, contracts, invoices, and renewals in one flow.',
      },
      {
        label: 'Run the backend parser',
        body: 'Analyze export posts the file to the Cloudflare backend, normalizes lifecycle columns, and flags broken handoffs server-side.',
      },
      {
        label: 'Read the break',
        body: 'The graph and inspector show the exact stuck record, severity, source fields, and why revenue is leaking before the renewal path reaches finance.',
      },
    ],
  },
} as const;
