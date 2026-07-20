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
        label: 'Run the check',
        body: 'Click Analyze. The server reads your file and flags where the handoff broke — no setup, nothing stored.',
      },
      {
        label: 'Read the break',
        body: 'Click a red node or a finding card to see what broke, who owns it, and the fix.',
      },
    ],
  },
} as const;
