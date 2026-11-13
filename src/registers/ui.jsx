// Generic table + form for every register and settings document, driven by schemas.js.

import { useState, useEffect, useMemo } from 'preact/hooks';
import { REGISTER_BY_KEY, SETTINGS_DOCS, COMPANIES, inScope } from './schemas.js';
import { Panel, Table, Button, Empty, Drawer, Pill } from '../ui/kit.jsx';
import { money, pct, shortDate, toNum, isoWeekId, isoDate } from '../app/format.js';

const COMPANY_OPTIONS = [['both', 'Both companies'], ['ab', COMPANIES.ab.name], ['sr', COMPANIES.sr.name]];

function optionLabel(field, value) {
  const opts = field.type === 'company' ? COMPANY_OPTIONS : field.options || [];
  const hit = opts.find((o) => o[0] === value);
  return hit ? hit[1] : value || '';
}

/** How a stored value reads in a table cell. */
export function displayValue(field, value, registers, now) {
  if (value === undefined || value === null || value === '') return '';
  switch (field.type) {
    case 'money':
      return money(value);
    case 'percent':
      return pct(value, toNum(value) !== null && toNum(value) * 100 % 1 ? 1 : 0);
    case 'date':
      return shortDate(value, now);
    case 'bool':
      return value ? 'Yes' : 'No';
    case 'rating':
      return `${value} / 5`;
    case 'select':
    case 'company':
      return optionLabel(field, value);
    case 'multi':
      return (Array.isArray(value) ? value : []).map((v) => optionLabel(field, v)).join(', ');
    case 'ref': {
      const target = REGISTER_BY_KEY[field.ref];
      const row = (registers[field.ref] || []).find((r) => r.id === value);
      return row && target ? target.describe(row) : '';
    }
    default:
      return String(value);
  }
}

function Field({ field, value, onChange, registers, id }) {
  const common = { id, name: field.key, required: !!field.required };
  let control;
  switch (field.type) {
    case 'textarea':
      control = <textarea {...common} value={value ?? ''} onInput={(e) => onChange(e.currentTarget.value)} />;
      break;
    case 'money':
    case 'number':
      control = <input {...common} type="number" inputMode="decimal" step="any" value={value ?? ''} onInput={(e) => onChange(e.currentTarget.value === '' ? null : Number(e.currentTarget.value))} />;
      break;
    case 'percent':
      control = <input {...common} type="number" inputMode="decimal" step="any" min="0" max="100" placeholder="%" value={value === null || value === undefined || value === '' ? '' : Math.round(Number(value) * 10000) / 100} onInput={(e) => onChange(e.currentTarget.value === '' ? null : Number(e.currentTarget.value) / 100)} />;
      break;
    case 'date':
      control = <input {...common} type="date" value={value ?? ''} onInput={(e) => onChange(e.currentTarget.value || null)} />;
      break;
    case 'month':
      control = <input {...common} type="month" value={value ?? ''} onInput={(e) => onChange(e.currentTarget.value || null)} />;
      break;
    case 'week':
      control = <input {...common} type="text" pattern="\d{4}-W\d{2}" placeholder="2026-W46" value={value ?? ''} onInput={(e) => onChange(e.currentTarget.value)} />;
      break;
    case 'bool':
      return (
        <div class="field">
          <span class="field__label">{field.label}</span>
          <label class="check">
            <input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.currentTarget.checked)} />
            <span>{value ? 'Yes' : 'No'}</span>
          </label>
          {field.help && <span class="field__help">{field.help}</span>}
        </div>
      );
    case 'rating':
      control = (
        <select {...common} value={value ?? ''} onChange={(e) => onChange(e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}>
          <option value="">Not rated</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>{n}{n === 1 ? ' (poor)' : n === 3 ? ' (fine)' : n === 5 ? ' (excellent)' : ''}</option>
          ))}
        </select>
      );
      break;
    case 'select':
    case 'company': {
      const opts = field.type === 'company' ? COMPANY_OPTIONS : field.options;
      control = (
        <select {...common} value={value ?? ''} onChange={(e) => onChange(e.currentTarget.value || null)}>
          <option value="">Choose…</option>
          {opts.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      );
      break;
    }
    case 'multi': {
      const set = new Set(Array.isArray(value) ? value : []);
      return (
        <div class={`field${field.wide ? ' field--wide' : ''} field--wide`}>
          <span class="field__label">{field.label}</span>
          <div class="row">
            {field.options.map(([v, l]) => (
              <label class="check" key={v}>
                <input type="checkbox" checked={set.has(v)} onChange={(e) => {
                  const next = new Set(set);
                  if (e.currentTarget.checked) next.add(v);
                  else next.delete(v);
                  onChange([...next]);
                }} />
                <span>{l}</span>
              </label>
            ))}
          </div>
        </div>
      );
    }
    case 'ref': {
      const target = REGISTER_BY_KEY[field.ref];
      const rows = registers[field.ref] || [];
      control = (
        <select {...common} value={value ?? ''} onChange={(e) => onChange(e.currentTarget.value || null)}>
          <option value="">{rows.length ? 'Choose…' : `Nothing in ${target.title.toLowerCase()} yet`}</option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>{target.describe(r)}</option>
          ))}
        </select>
      );
      break;
    }
    default:
      control = <input {...common} type="text" value={value ?? ''} onInput={(e) => onChange(e.currentTarget.value)} />;
  }
  return (
    <div class={`field${field.wide ? ' field--wide' : ''}`}>
      <label for={id}>{field.label}{field.required ? ' *' : ''}</label>
      {control}
      {field.help && <span class="field__help">{field.help}</span>}
    </div>
  );
}

/** Table of one register with an Add button. Rows open the form. */
export function RegisterPanel({ regKey, registers, scope = 'all', actions, title, note, pageSize = 8, filter, canEdit = true, ready = true, now }) {
  const schema = REGISTER_BY_KEY[regKey];
  const all = registers[regKey] || [];
  const rows = useMemo(() => all.filter((r) => inScope(r, scope) && (!filter || filter(r))), [all, scope, filter]);
  const fields = schema.columns.map((k) => schema.fields.find((f) => f.key === k)).filter(Boolean);
  const columns = fields.map((f) => ({
    key: f.key,
    label: f.label.replace(/ \(.*\)$/, ''),
    align: ['money', 'number', 'percent', 'rating'].includes(f.type) ? 'r' : undefined,
    render: (r) => displayValue(f, r[f.key], registers, now),
    sort: (r) => (['money', 'number', 'percent', 'rating'].includes(f.type) ? toNum(r[f.key]) : displayValue(f, r[f.key], registers, now).toLowerCase() || null),
  }));
  return (
    <Panel
      id={`reg-${regKey}`}
      title={title || schema.title}
      note={note || (rows.length ? `${rows.length} on file` : undefined)}
      actions={canEdit && <Button small icon="plus" onClick={() => actions.openRegister(regKey, {})}>Add {schema.singular}</Button>}
      flush={rows.length > 0}
    >
      {!ready ? (
        <Empty title="Loading your records…" />
      ) : rows.length ? (
        <Table columns={columns} rows={rows} rowKey={(r) => r.id} onRow={canEdit ? (r) => actions.openRegister(regKey, { id: r.id }) : undefined} pageSize={pageSize} caption={schema.title} />
      ) : (
        <Empty title={schema.emptyTitle} action={canEdit && <Button kind="primary" icon="plus" onClick={() => actions.openRegister(regKey, {})}>Add {schema.singular}</Button>}>
          {schema.emptyText}
        </Empty>
      )}
    </Panel>
  );
}

/** Add / edit one record in a drawer. */
export function RegisterForm({ regKey, id, preset, registers, onSave, onDelete, onClose, now }) {
  const schema = REGISTER_BY_KEY[regKey];
  const existing = id ? (registers[regKey] || []).find((r) => r.id === id) : null;
  const [draft, setDraft] = useState(() => {
    const base = {};
    for (const f of schema.fields) {
      if (f.default !== undefined) base[f.key] = f.default;
      if (f.type === 'week') base[f.key] = isoWeekId(now);
      if (f.type === 'date' && f.required) base[f.key] = isoDate(now);
    }
    return { ...base, ...(preset || {}), ...(existing || {}) };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const missing = schema.fields.filter((f) => f.required && (draft[f.key] === undefined || draft[f.key] === null || draft[f.key] === ''));
  const submit = async (e) => {
    e.preventDefault();
    if (missing.length) {
      setError(`Fill in: ${missing.map((f) => f.label).join(', ')}.`);
      return;
    }
    setBusy(true);
    setError('');
    const { id: _drop, ...data } = draft;
    const res = await onSave(regKey, id || null, data);
    setBusy(false);
    if (res && res.ok === false) setError(res.message || 'Could not save.');
    else onClose();
  };
  return (
    <Drawer title={`${existing ? 'Edit' : 'Add'} ${schema.singular}`} onClose={onClose} wide>
      <form class="stack" onSubmit={submit} style={{ gap: 'var(--sp-4)' }}>
        <div class="form">
          {schema.fields.map((f) => (
            <Field key={f.key} field={f} id={`f-${regKey}-${f.key}`} value={draft[f.key]} registers={registers} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
          ))}
        </div>
        {error && <div class="banner banner--crit" role="alert">{error}</div>}
        <div class="row row--between">
          <div class="row">
            <Button kind="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
            <Button onClick={onClose}>Cancel</Button>
          </div>
          {existing &&
            (confirmDelete ? (
              <div class="row">
                <span class="muted">Delete this for good?</span>
                <Button kind="danger" onClick={async () => {
                  setBusy(true);
                  const res = await onDelete(regKey, id);
                  setBusy(false);
                  if (res && res.ok === false) setError(res.message || 'Could not delete.');
                  else onClose();
                }}>Yes, delete</Button>
                <Button onClick={() => setConfirmDelete(false)}>Keep</Button>
              </div>
            ) : (
              <Button kind="ghost" icon="trash" onClick={() => setConfirmDelete(true)}>Delete</Button>
            ))}
        </div>
      </form>
    </Drawer>
  );
}

/** One settings document as a form in a drawer. */
export function SettingsForm({ docId, values, onSave, onClose, focusField }) {
  const doc = SETTINGS_DOCS.find((d) => d.id === docId) || SETTINGS_DOCS[0];
  const [draft, setDraft] = useState({ ...(values || {}) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!focusField) return;
    const el = document.getElementById(`s-${doc.id}-${focusField}`);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      if (el.focus) el.focus();
    }
  }, []);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await onSave(doc.id, draft);
    setBusy(false);
    if (res && res.ok === false) setError(res.message || 'Could not save.');
    else onClose();
  };
  return (
    <Drawer title={doc.title} onClose={onClose} wide>
      <form class="stack" onSubmit={submit} style={{ gap: 'var(--sp-5)' }}>
        {doc.groups.map((g) => (
          <fieldset key={g.title} style={{ border: 0, padding: 0, margin: 0 }} class="stack">
            <legend style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--t-lg)', letterSpacing: '0.05em', textTransform: 'uppercase', padding: 0 }}>{g.title}</legend>
            {g.help && <p class="muted" style={{ fontSize: 'var(--t-sm)', maxWidth: '70ch' }}>{g.help}</p>}
            <div class="form">
              {g.fields.map((f) => (
                <Field key={f.key} field={f} id={`s-${doc.id}-${f.key}`} value={draft[f.key]} registers={{}} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
              ))}
            </div>
          </fieldset>
        ))}
        {error && <div class="banner banner--crit" role="alert">{error}</div>}
        <div class="row">
          <Button kind="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Drawer>
  );
}

export { Pill };
