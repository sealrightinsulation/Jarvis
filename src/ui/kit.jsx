// Shared UI kit. Every sheet is built from these so the whole drawing set reads as one system.

import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import { Icon, StatusIcon, statusWord } from './icons.jsx';

const cx = (...a) => a.filter(Boolean).join(' ');

/** Maps any status vocabulary to a pill/dot modifier. */
export function tone(status) {
  switch (status) {
    case 'good':
    case 'clear':
    case 'live':
      return 'good';
    case 'watch':
    case 'partial':
      return 'watch';
    case 'serious':
      return 'serious';
    case 'alert':
      return 'alert';
    case 'info':
      return 'info';
    default:
      return 'blind';
  }
}

export function Pill({ status = 'blind', children, icon = true }) {
  const t = tone(status);
  return (
    <span class={`pill pill--${t}`}>
      {icon && <StatusIcon status={t === 'info' ? 'info' : t} size={11} />}
      {children || statusWord(t)}
    </span>
  );
}

export function Button({ kind, small, icon, children, ...rest }) {
  return (
    <button type="button" class={cx('btn', kind && `btn--${kind}`, small && 'btn--sm')} {...rest}>
      {icon && <Icon name={icon} size={small ? 13 : 15} />}
      {children}
    </button>
  );
}

/** Segmented control. options: [{value, label}] */
export function Seg({ options, value, onChange, label }) {
  return (
    <div class="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={o.value} aria-pressed={String(o.value === value)} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The title block that opens every sheet. meta: [[label, value], ...] */
export function TitleBlock({ no, title, lede, meta = [] }) {
  return (
    <header class="titleblock">
      <div class="titleblock__no">
        <small>Sheet</small>
        <strong>{no}</strong>
      </div>
      <div class="titleblock__title">
        <h1>{title}</h1>
        {lede && <p>{lede}</p>}
      </div>
      {meta.length > 0 && (
        <dl class="titleblock__meta">
          {meta.map(([k, v]) => [<dt key={`k${k}`}>{k}</dt>, <dd key={`v${k}`}>{v}</dd>])}
        </dl>
      )}
    </header>
  );
}

export function Panel({ title, note, actions, flush, footer, children, id, level = 2 }) {
  const H = `h${level}`;
  return (
    <section class="panel" id={id}>
      {(title || actions || note) && (
        <div class="panel__hd">
          <div class="row">
            {title && <H>{title}</H>}
            {note && <span class="panel__note">{note}</span>}
          </div>
          {actions && <div class="row">{actions}</div>}
        </div>
      )}
      <div class={cx('panel__bd', flush && 'panel__bd--flush')}>{children}</div>
      {footer && <div class="panel__ft">{footer}</div>}
    </section>
  );
}

export function Tiles({ children }) {
  return <div class="tiles">{children}</div>;
}

/** One vital number. `blind` renders the no-data treatment instead of a number. */
export function Tile({ label, value, hint, status, blind, onClick }) {
  const body = (
    <>
      <span class="tile__label">{label}</span>
      <span class={cx('tile__value', blind && 'tile__value--blind')}>{blind ? 'No data yet' : value}</span>
      {(hint || status) && (
        <span class="tile__hint row">
          {status && status !== 'none' && <StatusIcon status={tone(status)} size={12} />}
          <span class="grow">{hint}</span>
        </span>
      )}
    </>
  );
  return onClick ? (
    <button type="button" class="tile" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div class="tile">{body}</div>
  );
}

/** rows: [[label, value, {total?: boolean}]] */
export function KV({ rows }) {
  return (
    <dl class="kv">
      {rows.filter(Boolean).map(([k, v, o], i) => [
        <dt key={`k${i}`} class={o && o.total ? 'kv__total' : undefined}>{k}</dt>,
        <dd key={`v${i}`} class={o && o.total ? 'kv__total' : undefined}>{v}</dd>,
      ])}
    </dl>
  );
}

export function Meter({ value, max = 1, status, label }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const t = status ? tone(status) : null;
  return (
    <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(ratio * 100)} aria-label={label}>
      <div class={cx('meter__fill', t && t !== 'blind' && `meter__fill--${t === 'serious' ? 'watch' : t}`)} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div class="empty">
      {title && <strong>{title}</strong>}
      {children && <span>{children}</span>}
      {action}
    </div>
  );
}

export function Banner({ kind = 'info', children, action }) {
  return (
    <div class={`banner banner--${kind}`} role={kind === 'crit' ? 'alert' : 'status'}>
      <span class="grow">{children}</span>
      {action}
    </div>
  );
}

export function Skeleton({ lines = 3 }) {
  return (
    <div class="stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} class="skeleton" style={{ width: `${92 - i * 14}%`, height: '0.9em' }} />
      ))}
    </div>
  );
}

/**
 * Data table.
 * columns: [{key, label, align?: 'r', render?: (row) => node, sort?: (row) => value, width?}]
 * rows: object[]; rowKey?: (row) => string; onRow?: (row) => void; foot?: node[] (one per column)
 * initialSort?: {key, dir: 1|-1}; pageSize?: number (shows "Show all" beyond it)
 */
export function Table({ columns, rows, rowKey, onRow, foot, initialSort, pageSize = 12, empty, caption }) {
  const [sort, setSort] = useState(initialSort || null);
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const get = col.sort || ((r) => r[col.key]);
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x < y ? -1 : 1) * sort.dir;
    });
  }, [rows, sort, columns]);
  if (!rows.length) return empty || <Empty title="Nothing here yet" />;
  const shown = all ? sorted : sorted.slice(0, pageSize);
  return (
    <div class="stack" style={{ gap: 0 }}>
      <div class="scroll-x">
        <table class={cx('tbl', onRow && 'tbl--clickable')}>
          {caption && <caption class="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((c) => {
                const sortable = c.sort !== false;
                const active = sort && sort.key === c.key;
                return (
                  <th key={c.key} class={c.align === 'r' ? 'r' : undefined} style={c.width ? { width: c.width } : undefined} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                    {sortable ? (
                      <button type="button" onClick={() => setSort(active ? { key: c.key, dir: -sort.dir } : { key: c.key, dir: c.align === 'r' ? -1 : 1 })}>
                        {c.label}
                        {active && <Icon name={sort.dir === 1 ? 'up' : 'down'} size={10} />}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr
                key={rowKey ? rowKey(r) : i}
                onClick={onRow ? () => onRow(r) : undefined}
                tabIndex={onRow ? 0 : undefined}
                onKeyDown={onRow ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onRow(r)) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} class={c.align === 'r' ? 'r' : undefined}>
                    {c.render ? c.render(r) : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {foot && (
            <tfoot>
              <tr>
                {foot.map((f, i) => (
                  <td key={i} class={columns[i] && columns[i].align === 'r' ? 'r' : undefined}>
                    {f}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {sorted.length > pageSize && (
        <div class="panel__ft">
          <button type="button" class="btn btn--ghost btn--sm" onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${sorted.length}`}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The "you should know" checklist for a sheet.
 * items: [{id, label, coverage: 'live'|'partial'|'blind', health: 'good'|'watch'|'alert'|'none', display, detail, source, fix?: {label, go?}}]
 */
export function Items({ items, onFix }) {
  return (
    <div class="items">
      {items.map((it) => {
        const status = it.coverage === 'blind' ? 'blind' : it.health && it.health !== 'none' ? it.health : it.coverage === 'partial' ? 'watch' : 'good';
        const word = it.coverage === 'blind' ? 'No data' : it.coverage === 'partial' && (!it.health || it.health === 'none') ? 'Partial' : undefined;
        return (
          <div class="item" key={it.id}>
            <StatusIcon status={tone(status)} label={word} />
            <span class="item__label">{it.label}</span>
            <span class={cx('item__value', it.coverage === 'blind' && 'muted')}>{it.display || (it.coverage === 'blind' ? 'Not tracked yet' : '—')}</span>
            {it.fix && onFix ? (
              <button type="button" class="btn btn--ghost btn--sm" onClick={() => onFix(it)}>
                {it.fix.label}
              </button>
            ) : (
              <span />
            )}
            {(it.detail || it.source) && (
              <span class="item__detail">
                {it.detail}
                {it.detail && it.source ? ' · ' : ''}
                {it.source && <span class="mono">{it.source}</span>}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * What minions report.
 * findings: [{id, status: 'alert'|'watch'|'clear'|'blind', title, detail, who?, action?: {label, go}}]
 */
export function Findings({ findings, onAction, empty, limit }) {
  const [all, setAll] = useState(false);
  if (!findings.length) return empty || <Empty title="Nothing flagged" />;
  const shown = limit && !all ? findings.slice(0, limit) : findings;
  return (
    <div class="findings">
      {shown.map((f) => (
        <div class="finding" key={f.id}>
          <span class="finding__icon">
            <StatusIcon status={tone(f.status)} />
          </span>
          <div class="finding__text">
            <div class="finding__title">{f.title}</div>
            {f.detail && <div class="finding__detail">{f.detail}</div>}
            {f.who && <div class="finding__who">{f.who}</div>}
          </div>
          {f.action && onAction ? (
            <span class="finding__act">
              <Button small kind="ghost" onClick={() => onAction(f)}>
                {f.action.label}
              </Button>
            </span>
          ) : (
            <span />
          )}
        </div>
      ))}
      {limit && findings.length > limit && (
        <div class="panel__ft">
          <button type="button" class="btn btn--ghost btn--sm" onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${findings.length}`}
          </button>
        </div>
      )}
    </div>
  );
}

/** Right-hand drawer with focus handling. Escape closes it (and claims the key so reading aloud continues). */
export function Drawer({ title, onClose, wide, footer, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    if (el) {
      const first = el.querySelector('[data-autofocus], input, textarea, select, button');
      if (first && first.focus) first.focus();
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (prev && prev.focus) prev.focus();
    };
  }, []);
  return (
    <>
      <div class="scrim" onClick={onClose} />
      <aside class={cx('drawer', wide && 'drawer--wide')} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div class="drawer__hd">
          <h2>{title}</h2>
          <Button kind="ghost" icon="close" onClick={onClose} aria-label="Close" />
        </div>
        <div class="drawer__bd">{children}</div>
        {footer && <div class="drawer__ft">{footer}</div>}
      </aside>
    </>
  );
}

export function SourceNote({ children }) {
  return <span class="panel__note mono">{children}</span>;
}

/** Legend for charts and segmented bars. keys: [{label, color, line?}] */
export function Legend({ keys }) {
  return (
    <div class="legend">
      {keys.map((k) => (
        <span class="legend__key" key={k.label}>
          <span class={cx('legend__swatch', k.line && 'legend__swatch--line')} style={{ background: k.color }} />
          {k.label}
        </span>
      ))}
    </div>
  );
}

export { Icon, StatusIcon, cx };
