// The one place that names the connectors and the exact tools this page may call.
// It is imported by the page (to address calls) and by build.mjs (to emit dist/capabilities.json,
// which is what gets declared when the page is published). Keep it minimal and READ-ONLY:
// every tool listed here is only ever called with read/list/search/report arguments.

export const SERVERS = {
  qbo: 'Intuit QuickBooks Labs',
  jt: 'Jobtread',
  gcal: 'Google Calendar',
};

export const CONNECTOR_LABEL = {
  qbo: 'QuickBooks',
  jt: 'JobTread',
  gcal: 'Google Calendar',
};

export const TOOLS = {
  qbo: [
    'reports_profit_and_loss',
    'reports_balance_sheet',
    'reports_run',
    'transactions_search',
    'bank_feed_list_connections',
    'bank_feed_list_transactions',
    'reconciliation_list_accounts',
  ],
  jt: [
    'jobtread_jobs',
    'jobtread_multi_job_comparison',
    'jobtread_documents',
    'jobtread_payments',
    'jobtread_tasks',
    'jobtread_daily_logs',
    'jobtread_time_report',
    'jobtread_get_users',
  ],
  gcal: ['list_events'],
};

/** Capabilities to declare at publish time. */
export function capabilities() {
  return {
    mcp: {
      servers: Object.keys(SERVERS).map((k) => ({ server: SERVERS[k], tools: TOOLS[k] })),
    },
    // Everything Jarvis remembers (wages, scorecards, insurance, targets) is readable and
    // writable only by the owner and people he makes an Editor.
    db: { rules: [{ path: '', read: 'admin', write: 'admin' }] },
    user: {},
    sample: {},
    tts: {},
    dictation: {},
  };
}

export const permissionNames = () => Object.values(SERVERS).map((s) => `mcp:${s}`);
