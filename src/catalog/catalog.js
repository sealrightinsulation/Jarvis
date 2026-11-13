// The owner's checklist: everything Jake said a CEO should know, as one catalogue.
// Each sheet (domain) owns a set of items. A domain's compute() must return a result for every
// item id listed here; anything it cannot work out is reported as a blind spot, never guessed.
//
// `feeds` says where an answer can come from:
//   qbo      QuickBooks Online (Seal Right Insulations Inc, Advanced Builds Inc)
//   jt       JobTread (Advanced Builds)
//   mail     Gmail saved searches       cal   Google Calendar
//   reg:<k>  one of Jarvis's own registers (see src/registers/schemas.js)
//   set      a setting the owner types in once (see settings in schemas.js)

export const DOMAINS = [
  { key: 'fin', sheet: 'A-01', title: 'Financial health', lede: 'Revenue, profit, what is owed either way, tax, debt, and how much is safe to spend.' },
  { key: 'job', sheet: 'A-02', title: 'Job profitability', lede: 'Whether every project is making or losing money, measured against what was quoted.' },
  { key: 'ppl', sheet: 'A-03', title: 'People', lede: 'Who is performing, who is not, and who can run a crew without you.' },
  { key: 'sal', sheet: 'A-04', title: 'Sales and pipeline', lede: 'Where the next dollar of revenue is coming from.' },
  { key: 'ops', sheet: 'A-05', title: 'Operations', lede: 'What is being built this week, by whom, and what is slipping.' },
  { key: 'csh', sheet: 'A-06', title: 'Cash management', lede: 'Cash today, cash coming, cash going, thirteen weeks ahead.' },
  { key: 'cus', sheet: 'A-07', title: 'Customers', lede: 'Who matters most, who pays, and who needs a call from you.' },
  { key: 'eqp', sheet: 'A-08', title: 'Equipment and vehicles', lede: 'What you own, what it costs each month, and when it needs attention.' },
  { key: 'lgl', sheet: 'A-09', title: 'Legal and compliance', lede: 'Contracts, insurance, WSIB and anything that can expose the company.' },
  { key: 'pur', sheet: 'A-10', title: 'Purchasing and suppliers', lede: 'Where the money goes, who may spend it, and where pricing can improve.' },
  { key: 'org', sheet: 'A-11', title: 'Structure and leadership', lede: 'Who decides what, so the company does not depend on you being there.' },
  { key: 'str', sheet: 'A-12', title: 'Growth and strategy', lede: 'Targets, risks and where the company should be in one, three and five years.' },
  { key: 'wkr', sheet: 'A-13', title: 'Weekly review', lede: 'The once-a-week walk through the numbers that turns all of this into a habit.' },
];

const I = (id, label, feeds, reg) => ({ id, domain: id.split('.')[0], label, feeds, reg: reg || null });

export const ITEMS = [
  // A-01 Financial health
  I('fin.revenue', 'Total revenue (monthly, quarterly, annually)', ['qbo']),
  I('fin.gross_profit_jobs', 'Gross profit on every job', ['jt']),
  I('fin.net_profit', 'Net profit and operating expenses', ['qbo', 'reg:obligations'], 'obligations'),
  I('fin.cash_reserves', 'Cash flow and cash reserves', ['qbo', 'set']),
  I('fin.receivables', 'Accounts receivable (who owes you money)', ['qbo', 'jt']),
  I('fin.payables', 'Accounts payable (who you owe)', ['qbo', 'jt']),
  I('fin.payroll', 'Payroll obligations', ['qbo', 'set']),
  I('fin.tax', 'Tax obligations (HST, payroll deductions, corporate taxes)', ['qbo', 'set']),
  I('fin.loans', 'Outstanding loans and credit facilities', ['qbo', 'reg:loans'], 'loans'),
  I('fin.equipment_financing', 'Equipment financing and monthly commitments', ['reg:equipment', 'reg:loans', 'reg:obligations'], 'equipment'),
  I('fin.breakeven', 'Your break-even point', ['qbo', 'reg:obligations', 'set'], 'obligations'),
  I('fin.safe_to_spend', 'How much money you can safely spend', ['qbo', 'set', 'reg:obligations']),
  I('fin.reinvest', 'How much money you can afford to reinvest', ['qbo', 'set']),

  // A-02 Job profitability
  I('job.quoted', 'Original quoted price', ['jt']),
  I('job.labour', 'Actual labour costs', ['jt']),
  I('job.material', 'Material costs', ['jt']),
  I('job.equipment', 'Equipment costs', ['jt']),
  I('job.fuel_travel', 'Fuel and travel expenses', ['jt']),
  I('job.subs', 'Subcontractor costs', ['jt']),
  I('job.change_orders', 'Additional work and change orders', ['jt']),
  I('job.est_vs_actual', 'Estimated versus actual profit', ['jt']),
  I('job.hours', 'Labour hours budgeted versus actual', ['jt']),
  I('job.percent_complete', 'Percentage of job completed', ['jt']),
  I('job.remaining_cost', 'Remaining costs to finish', ['jt']),

  // A-03 People
  I('ppl.attendance', 'Employee attendance', ['jt', 'reg:scorecards'], 'scorecards'),
  I('ppl.hours', 'Hours worked', ['jt', 'reg:scorecards'], 'scorecards'),
  I('ppl.productivity', 'Productivity', ['reg:scorecards'], 'scorecards'),
  I('ppl.quality', 'Quality of workmanship', ['reg:scorecards'], 'scorecards'),
  I('ppl.attitude', 'Attitude and work ethic', ['reg:scorecards'], 'scorecards'),
  I('ppl.safety', 'Safety compliance', ['reg:scorecards'], 'scorecards'),
  I('ppl.strengths', 'Individual strengths and weaknesses', ['reg:people'], 'people'),
  I('ppl.wage_vs_value', 'Employee wages compared to value produced', ['reg:people', 'reg:scorecards'], 'people'),
  I('ppl.independent', 'Who can be trusted to work independently', ['reg:people'], 'people'),
  I('ppl.supervisor', 'Who is capable of becoming a supervisor', ['reg:people'], 'people'),
  I('ppl.underperforming', 'Who is consistently underperforming', ['reg:scorecards'], 'scorecards'),

  // A-04 Sales and pipeline
  I('sal.pipeline', 'Current sales pipeline', ['jt']),
  I('sal.upcoming', 'Upcoming projects', ['jt']),
  I('sal.signed', 'Contracts signed', ['jt']),
  I('sal.quotes_out', 'Quotes outstanding', ['jt', 'qbo']),
  I('sal.acceptance', 'Quote acceptance rate', ['jt', 'qbo']),
  I('sal.avg_size', 'Average project size', ['jt', 'qbo']),
  I('sal.cac', 'Customer acquisition costs', ['reg:marketing'], 'marketing'),
  I('sal.repeat', 'Repeat customer percentage', ['qbo', 'jt']),
  I('sal.major', 'Major customer relationships', ['qbo', 'reg:customer_notes'], 'customer_notes'),
  I('sal.tenders', 'Upcoming tenders', ['reg:tenders', 'mail'], 'tenders'),
  I('sal.competitors', 'Competitor pricing', ['reg:competitors'], 'competitors'),
  I('sal.forecast', 'Revenue forecast for the next 3, 6 and 12 months', ['jt', 'qbo']),

  // A-05 Operations
  I('ops.active_jobs', 'What jobs are currently active', ['jt']),
  I('ops.crews', 'What crews are assigned to each job', ['jt', 'reg:people'], 'people'),
  I('ops.production', 'Daily production numbers', ['jt']),
  I('ops.equipment_avail', 'Equipment availability', ['reg:equipment'], 'equipment'),
  I('ops.inventory', 'Material inventory', ['reg:inventory'], 'inventory'),
  I('ops.delays', 'Job delays', ['jt']),
  I('ops.conflicts', 'Scheduling conflicts', ['jt']),
  I('ops.breakdowns', 'Equipment breakdowns', ['reg:maintenance'], 'maintenance'),
  I('ops.rework', 'Rework and deficiencies', ['reg:issues', 'jt'], 'issues'),
  I('ops.supervision', 'Site supervision', ['jt', 'cal', 'reg:people'], 'people'),
  I('ops.daily_reporting', 'Daily reporting', ['jt']),
  I('ops.timelines', 'Job completion timelines', ['jt']),

  // A-06 Cash management
  I('csh.today', 'Cash available today', ['qbo', 'set']),
  I('csh.week', 'Cash expected this week', ['qbo', 'jt']),
  I('csh.month', 'Cash expected this month', ['qbo', 'jt']),
  I('csh.payroll', 'Upcoming payroll', ['set']),
  I('csh.supplier_payments', 'Upcoming supplier payments', ['jt', 'qbo', 'reg:obligations'], 'obligations'),
  I('csh.terms', 'Customer payment terms', ['qbo', 'jt']),
  I('csh.overdue', 'Overdue invoices', ['qbo', 'jt']),
  I('csh.credit_lines', 'Available lines of credit', ['reg:loans'], 'loans'),
  I('csh.cards', 'Credit card balances', ['qbo', 'reg:loans'], 'loans'),
  I('csh.project_financing', 'Financing requirements for large projects', ['jt']),
  I('csh.cash_to_complete', 'Cash required to complete contracted work', ['jt']),
  I('csh.forecast13', 'Cash flow forecast, 13 weeks ahead', ['qbo', 'jt', 'set', 'reg:obligations']),

  // A-07 Customers
  I('cus.top_revenue', 'Top 10 customers by revenue', ['qbo', 'jt']),
  I('cus.top_profit', 'Top 10 customers by profitability', ['jt']),
  I('cus.pay_on_time', 'Which customers pay on time', ['qbo']),
  I('cus.difficult', 'Which customers are difficult to work with', ['reg:customer_notes'], 'customer_notes'),
  I('cus.complaints', 'Customer complaints', ['reg:issues', 'mail'], 'issues'),
  I('cus.warranty', 'Warranty claims', ['reg:issues'], 'issues'),
  I('cus.repeat_opps', 'Repeat business opportunities', ['qbo', 'jt', 'reg:customer_notes']),
  I('cus.satisfaction', 'Customer satisfaction', ['reg:customer_notes'], 'customer_notes'),
  I('cus.commitments', 'Outstanding commitments', ['jt', 'reg:customer_notes']),
  I('cus.gc_relationships', 'Relationships with general contractors and developers', ['reg:customer_notes', 'cal'], 'customer_notes'),

  // A-08 Equipment and vehicles
  I('eqp.inventory', 'Complete equipment inventory', ['reg:equipment'], 'equipment'),
  I('eqp.vehicles', 'Vehicle inventory and ownership', ['reg:equipment'], 'equipment'),
  I('eqp.payments', 'Monthly equipment payments', ['reg:equipment'], 'equipment'),
  I('eqp.maintenance', 'Maintenance schedules', ['reg:equipment'], 'equipment'),
  I('eqp.repairs', 'Repair costs', ['reg:maintenance'], 'maintenance'),
  I('eqp.utilization', 'Equipment utilization', ['reg:equipment'], 'equipment'),
  I('eqp.insurance', 'Insurance coverage', ['reg:equipment', 'reg:policies'], 'equipment'),
  I('eqp.depreciation', 'Depreciation', ['reg:equipment'], 'equipment'),
  I('eqp.replacement', 'Replacement schedules', ['reg:equipment'], 'equipment'),
  I('eqp.downtime', 'Equipment downtime', ['reg:maintenance'], 'maintenance'),
  I('eqp.roi', 'Return on investment for new purchases', ['reg:equipment'], 'equipment'),

  // A-09 Legal and compliance
  I('lgl.employment', 'Employment agreements', ['reg:contracts'], 'contracts'),
  I('lgl.subcontractor', 'Subcontractor agreements', ['reg:contracts'], 'contracts'),
  I('lgl.customer_contracts', 'Customer contracts', ['jt', 'reg:contracts'], 'contracts'),
  I('lgl.payment_terms', 'Payment terms', ['qbo', 'jt']),
  I('lgl.liability', 'Liability insurance', ['reg:policies'], 'policies'),
  I('lgl.wsib', "Workers' compensation (WSIB)", ['reg:policies', 'mail'], 'policies'),
  I('lgl.vehicle_insurance', 'Commercial vehicle insurance', ['reg:policies'], 'policies'),
  I('lgl.health_safety', 'Health and safety requirements', ['reg:policies'], 'policies'),
  I('lgl.building_code', 'Building code requirements', ['reg:policies', 'mail'], 'policies'),
  I('lgl.fire_regs', 'Fire and building regulations', ['reg:policies'], 'policies'),
  I('lgl.warranty', 'Warranty obligations', ['reg:contracts', 'reg:issues'], 'contracts'),
  I('lgl.disputes', 'Outstanding legal disputes', ['reg:issues', 'mail'], 'issues'),
  I('lgl.liabilities', 'Contractual liabilities', ['reg:contracts'], 'contracts'),

  // A-10 Purchasing and suppliers
  I('pur.approved', 'Approved suppliers', ['jt', 'reg:suppliers'], 'suppliers'),
  I('pur.pricing', 'Material pricing', ['jt', 'reg:suppliers'], 'suppliers'),
  I('pur.terms', 'Supplier payment terms', ['reg:suppliers'], 'suppliers'),
  I('pur.discounts', 'Volume discounts', ['reg:suppliers'], 'suppliers'),
  I('pur.credit_limits', 'Credit limits', ['reg:suppliers'], 'suppliers'),
  I('pur.po_approvals', 'Purchase order approvals', ['jt']),
  I('pur.unauthorized', 'Unauthorized purchases', ['jt', 'qbo']),
  I('pur.waste', 'Material waste', ['jt', 'reg:inventory'], 'inventory'),
  I('pur.inventory', 'Inventory levels', ['reg:inventory'], 'inventory'),
  I('pur.reliability', 'Supplier reliability', ['reg:suppliers'], 'suppliers'),
  I('pur.negotiate', 'Opportunities to negotiate better pricing', ['jt', 'qbo', 'reg:suppliers']),
  I('pur.limits', 'Purchasing approval limits', ['set']),

  // A-11 Structure and leadership
  I('org.chart', 'Organizational chart', ['reg:roles'], 'roles'),
  I('org.responsibilities', 'Clearly defined job responsibilities', ['reg:roles'], 'roles'),
  I('org.reporting', 'Who reports to whom', ['reg:roles'], 'roles'),
  I('org.authority', 'Who has authority to make decisions', ['reg:roles'], 'roles'),
  I('org.overtime', 'Who approves overtime', ['reg:roles'], 'roles'),
  I('org.purchases', 'Who approves purchases', ['reg:roles'], 'roles'),
  I('org.crews', 'Who manages crews', ['reg:roles'], 'roles'),
  I('org.customer_issues', 'Who handles customer issues', ['reg:roles'], 'roles'),
  I('org.scheduling', 'Who handles scheduling', ['reg:roles'], 'roles'),
  I('org.payroll', 'Who handles payroll', ['reg:roles'], 'roles'),
  I('org.quality', 'Who is responsible for quality control', ['reg:roles'], 'roles'),
  I('org.succession', 'Succession planning', ['reg:roles'], 'roles'),

  // A-12 Growth and strategy
  I('str.revenue_target', 'Annual revenue targets', ['set', 'qbo']),
  I('str.profit_target', 'Annual profit targets', ['set', 'qbo']),
  I('str.opportunities', 'Growth opportunities', ['reg:initiatives'], 'initiatives'),
  I('str.services', 'New services', ['reg:initiatives'], 'initiatives'),
  I('str.markets', 'New geographic markets', ['reg:initiatives', 'jt'], 'initiatives'),
  I('str.hiring', 'Hiring requirements', ['reg:initiatives', 'reg:people'], 'initiatives'),
  I('str.equipment_plan', 'Equipment investment plans', ['reg:initiatives', 'reg:equipment'], 'initiatives'),
  I('str.financing', 'Financing strategy', ['set', 'reg:loans']),
  I('str.competitors', 'Competitor analysis', ['reg:competitors'], 'competitors'),
  I('str.concentration', 'Customer concentration risks', ['qbo', 'jt']),
  I('str.valuation', 'Business valuation', ['qbo', 'set']),
  I('str.exit', 'Long-term exit strategy', ['set']),
  I('str.personal_goals', 'Personal financial goals', ['set']),
  I('str.horizons', 'Where the company should be in 1, 3 and 5 years', ['set']),

  // A-13 Weekly review
  I('wkr.this_week', "This week's review completed", ['reg:weekly'], 'weekly'),
  I('wkr.streak', 'Weekly review habit (last 8 weeks)', ['reg:weekly'], 'weekly'),
  I('wkr.decisions', 'Open decisions and follow-ups from past reviews', ['reg:weekly'], 'weekly'),
];

export const ITEMS_BY_DOMAIN = DOMAINS.reduce((acc, d) => {
  acc[d.key] = ITEMS.filter((i) => i.domain === d.key);
  return acc;
}, {});

export const DOMAIN_BY_KEY = Object.fromEntries(DOMAINS.map((d) => [d.key, d]));
export const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
