// Charts. Built to the dataviz rules: thin marks, hairline grid, one axis, a legend whenever
// there are two series, a hover/focus readout that lists every series, and a table view of the
// same numbers under every chart so nothing is gated behind a pointer.

import { useState, useRef, useEffect, useLayoutEffect } from 'preact/hooks';
import { moneyShort, money } from '../app/format.js';
import { Legend } from './kit.jsx';

function useWidth(ref, fallback = 640) {
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const next = Math.max(260, Math.floor(el.clientWidth));
      setW((prev) => (Math.abs(prev - next) > 1 ? next : prev));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return w;
}

/** Clean axis ticks covering [min, max] and including zero. */
export function niceTicks(min, max, count = 4) {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (hi === lo) return [0, 1];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const start = Math.floor(lo / step) * step;
  const ticks = [];
  for (let v = start; v <= hi + step * 0.001; v += step) ticks.push(Math.round(v * 100) / 100);
  if (ticks[ticks.length - 1] < hi) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function TableView({ labels, series, format }) {
  return (
    <details class="more">
      <summary>Show as a table</summary>
      <div class="scroll-x">
        <table class="tbl">
          <thead>
            <tr>
              <th />
              {series.map((s) => (
                <th class="r" key={s.label}>{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((l, i) => (
              <tr key={l + i}>
                <td>{l}</td>
                {series.map((s) => (
                  <td class="r" key={s.label}>{s.values[i] === null || s.values[i] === undefined ? '—' : format(s.values[i])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Tip({ x, width, title, rows, format }) {
  const left = Math.min(Math.max(8, x + 12), Math.max(8, width - 190));
  return (
    <div class="chart__tip" style={{ left: `${left}px`, top: '4px' }} role="status">
      <strong>{title}</strong>
      {rows.map((r) => (
        <div key={r.label} class="row" style={{ gap: '6px', flexWrap: 'nowrap' }}>
          <span class="legend__swatch legend__swatch--line" style={{ background: r.color }} />
          <span class="tnum" style={{ fontWeight: 600 }}>{r.value === null || r.value === undefined ? '—' : format(r.value)}</span>
          <span class="muted">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Columns over time. One or two series (side by side). Negative values hang below the baseline.
 * props: labels string[], series [{label, color, values: (number|null)[]}], height?, format?,
 *        title (accessible name), highlightLast? (mark the current, partial period)
 */
export function Columns({ labels, series, height = 200, format = money, tick = moneyShort, title, partialLast }) {
  const ref = useRef(null);
  const width = useWidth(ref);
  const [hover, setHover] = useState(null);
  const pad = { l: 46, r: 8, t: 10, b: 22 };
  const all = series.flatMap((s) => s.values.filter((v) => v !== null && v !== undefined));
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all, 1));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const ih = height - pad.t - pad.b;
  const iw = width - pad.l - pad.r;
  const y = (v) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;
  const band = iw / Math.max(1, labels.length);
  const n = series.length;
  const bw = Math.min(24, Math.max(3, (band - 6) / n - 2));
  const every = Math.ceil(labels.length / Math.max(2, Math.floor(iw / 44)));
  const base = y(0);
  return (
    <div class="stack" style={{ gap: '8px' }}>
      {n > 1 && <Legend keys={series.map((s) => ({ label: s.label, color: s.color }))} />}
      <div class="chart" ref={ref} onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'} stroke-width="1" />
              <text x={pad.l - 6} y={y(t) + 3.5} text-anchor="end">{tick(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => {
            const cx = pad.l + band * i + band / 2;
            const groupW = n * bw + (n - 1) * 2;
            return (
              <g key={l + i}>
                {series.map((s, k) => {
                  const v = s.values[i];
                  if (v === null || v === undefined || v === 0) return null;
                  const x = cx - groupW / 2 + k * (bw + 2);
                  const top = Math.min(y(v), base);
                  const h = Math.max(1, Math.abs(y(v) - base));
                  const r = Math.min(4, bw / 2, h);
                  // rounded data-end, square at the baseline
                  const d = v >= 0 ? `M${x},${base}V${top + r}q0,${-r} ${r},${-r}h${bw - 2 * r}q${r},0 ${r},${r}V${base}z` : `M${x},${base}V${top + h - r}q0,${r} ${r},${r}h${bw - 2 * r}q${r},0 ${r},${-r}V${base}z`;
                  return <path key={s.label} d={d} fill={s.color} opacity={hover !== null && hover !== i ? 0.45 : partialLast && i === labels.length - 1 ? 0.6 : 1} />;
                })}
                {i % every === 0 && (
                  <text x={cx} y={height - 6} text-anchor="middle">{l}</text>
                )}
                <rect x={pad.l + band * i} y={pad.t} width={band} height={ih} fill="transparent" tabIndex={0} aria-label={`${l}: ${series.map((s) => `${s.label} ${s.values[i] === null || s.values[i] === undefined ? 'no data' : format(s.values[i])}`).join(', ')}`} onPointerMove={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
              </g>
            );
          })}
        </svg>
        {hover !== null && <Tip x={pad.l + band * hover + band / 2} width={width} title={`${labels[hover]}${partialLast && hover === labels.length - 1 ? ' (so far)' : ''}`} rows={series.map((s) => ({ label: s.label, color: s.color, value: s.values[hover] }))} format={format} />}
      </div>
      <TableView labels={labels} series={series} format={format} />
    </div>
  );
}

/**
 * Lines over time with a crosshair. props: labels, series [{label, color, values, area?}],
 * refLines? [{value, label}], height?, format?, title
 */
export function Lines({ labels, series, refLines = [], height = 220, format = money, tick = moneyShort, title }) {
  const ref = useRef(null);
  const width = useWidth(ref);
  const [hover, setHover] = useState(null);
  const pad = { l: 50, r: 14, t: 12, b: 22 };
  const all = [...series.flatMap((s) => s.values.filter((v) => v !== null && v !== undefined)), ...refLines.map((r) => r.value)];
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all, 1));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const ih = height - pad.t - pad.b;
  const iw = width - pad.l - pad.r;
  const x = (i) => pad.l + (labels.length > 1 ? (iw * i) / (labels.length - 1) : iw / 2);
  const y = (v) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;
  const every = Math.ceil(labels.length / Math.max(2, Math.floor(iw / 52)));
  const pathOf = (vals) => vals.map((v, i) => (v === null || v === undefined ? null : `${i === 0 || vals[i - 1] === null || vals[i - 1] === undefined ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join('');
  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * width;
    const i = Math.round(((px - pad.l) / Math.max(1, iw)) * (labels.length - 1));
    setHover(Math.max(0, Math.min(labels.length - 1, i)));
  };
  return (
    <div class="stack" style={{ gap: '8px' }}>
      {(series.length > 1 || refLines.length > 0) && <Legend keys={[...series.map((s) => ({ label: s.label, color: s.color, line: true })), ...refLines.map((r) => ({ label: r.label, color: 'var(--chart-axis)', line: true }))]} />}
      <div class="chart" ref={ref} onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} onPointerMove={onMove} tabIndex={0} onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setHover((h) => Math.min(labels.length - 1, (h ?? -1) + 1));
          if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? labels.length) - 1));
        }} onBlur={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'} stroke-width="1" />
              <text x={pad.l - 6} y={y(t) + 3.5} text-anchor="end">{tick(t)}</text>
            </g>
          ))}
          {refLines.map((r) => (
            <line key={r.label} x1={pad.l} x2={width - pad.r} y1={y(r.value)} y2={y(r.value)} stroke="var(--chart-axis)" stroke-width="1.5" />
          ))}
          {labels.map((l, i) => (i % every === 0 ? <text key={l + i} x={x(i)} y={height - 6} text-anchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}>{l}</text> : null))}
          {series.map((s) => {
            const first = s.values.findIndex((v) => v !== null && v !== undefined);
            const lastIdx = s.values.length - 1;
            return (
              <g key={s.label}>
                {s.area && first >= 0 && <path d={`${pathOf(s.values)}L${x(lastIdx)},${y(0)}L${x(first)},${y(0)}z`} fill={s.color} opacity="0.1" />}
                <path d={pathOf(s.values)} fill="none" stroke={s.color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
                {s.values[lastIdx] !== null && s.values[lastIdx] !== undefined && <circle cx={x(lastIdx)} cy={y(s.values[lastIdx])} r="4" fill={s.color} stroke="var(--sheet)" stroke-width="2" />}
              </g>
            );
          })}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--ink-3)" stroke-width="1" />
              {series.map((s) => (s.values[hover] === null || s.values[hover] === undefined ? null : <circle key={s.label} cx={x(hover)} cy={y(s.values[hover])} r="4" fill={s.color} stroke="var(--sheet)" stroke-width="2" />))}
            </g>
          )}
        </svg>
        {hover !== null && <Tip x={x(hover)} width={width} title={labels[hover]} rows={series.map((s) => ({ label: s.label, color: s.color, value: s.values[hover] }))} format={format} />}
      </div>
      <TableView labels={labels} series={series} format={format} />
    </div>
  );
}

/** One whole split into parts (thin). parts: [{label, value, color}] */
export function SegBar({ parts, format = money, title }) {
  const shown = parts.filter((p) => p.value > 0);
  const total = shown.reduce((t, p) => t + p.value, 0);
  if (!total) return null;
  return (
    <div class="stack" style={{ gap: '6px' }}>
      <div class="segbar" role="img" aria-label={`${title}: ${shown.map((p) => `${p.label} ${format(p.value)}`).join(', ')}`}>
        {shown.map((p) => (
          <span key={p.label} title={`${p.label}: ${format(p.value)}`} style={{ flex: `${p.value} 0 0`, background: p.color, borderRadius: '2px' }} />
        ))}
      </div>
      <div class="legend">
        {shown.map((p) => (
          <span class="legend__key" key={p.label}>
            <span class="legend__swatch" style={{ background: p.color }} />
            {p.label} <strong class="tnum" style={{ color: 'var(--ink)' }}>{format(p.value)}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Horizontal ranked bars (customers, suppliers). rows: [{label, value, note?}] */
export function Ranked({ rows, format = money, color = 'var(--s1)', title, max: maxRows = 10 }) {
  const list = rows.slice(0, maxRows);
  const top = Math.max(1, ...list.map((r) => Math.abs(r.value)));
  return (
    <div class="stack" style={{ gap: '6px' }} role="list" aria-label={title}>
      {list.map((r) => (
        <div key={r.label} role="listitem" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 11rem) minmax(0, 1fr) auto', gap: '10px', alignItems: 'center', fontSize: 'var(--t-sm)' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>{r.label}</span>
          <span style={{ height: '10px', background: 'var(--well)', display: 'block' }}>
            <span style={{ display: 'block', height: '100%', width: `${(Math.abs(r.value) / top) * 100}%`, background: r.color || color, borderRadius: '0 4px 4px 0' }} />
          </span>
          <span class="tnum" style={{ fontWeight: 600 }}>{format(r.value)}{r.note ? <span class="muted" style={{ fontWeight: 400 }}> {r.note}</span> : null}</span>
        </div>
      ))}
    </div>
  );
}
