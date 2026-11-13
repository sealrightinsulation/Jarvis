// Inline icons. Stroke icons on a 16 grid; status icons differ by SHAPE as well as colour.

const P = {
  refresh: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3',
  ask: 'M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z',
  mic: 'M8 2.5a2 2 0 0 1 2 2v3a2 2 0 0 1-4 0v-3a2 2 0 0 1 2-2zM4 7.5a4 4 0 0 0 8 0M8 11.5v2',
  speaker: 'M2.5 6.5h2.5l3.5-3v9l-3.5-3h-2.5zM11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4',
  stop: 'M4 4h8v8h-8z',
  close: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
  plus: 'M8 3v10M3 8h10',
  edit: 'M3 13l.6-2.8 7.4-7.4 2.2 2.2-7.4 7.4zM9.8 4l2.2 2.2',
  trash: 'M3 4.5h10M6.5 4.5v-2h3v2M4.5 4.5l.6 8.5h5.8l.6-8.5M6.8 7v4M9.2 7v4',
  chevron: 'M6 3.5l4.5 4.5-4.5 4.5',
  down: 'M3.5 6l4.5 4.5 4.5-4.5',
  up: 'M3.5 10l4.5-4.5 4.5 4.5',
  link: 'M6.5 9.5l3-3M7 4.5l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7l-1.2 1.2M9 11.5l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7l1.2-1.2',
  plug: 'M6 2.5v3M10 2.5v3M4.5 5.5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11.5v2',
  calendar: 'M2.5 4h11v9.5h-11zM2.5 7h11M5.5 2.5v3M10.5 2.5v3',
  send: 'M2.5 8l11-5-4 11-2-4.5z',
  check: 'M3 8.5l3.2 3.2 6.8-7.2',
  target: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  flag: 'M4 14v-11.5h8l-1.5 3 1.5 3h-8',
  floor: 'M2.5 2.5h11v11h-11zM2.5 7h5v6.5M7.5 2.5v2.5M10.5 7h3',
  sun: 'M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M3.6 12.4l1-1M11.4 4.6l1-1',
};

export function Icon({ name, size = 16, title }) {
  const d = P[name];
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" role={title ? 'img' : 'presentation'} aria-hidden={title ? undefined : 'true'} aria-label={title}>
      <path d={d} />
    </svg>
  );
}

const STATUS_COLOR = { good: 'var(--good)', clear: 'var(--good)', watch: 'var(--warn)', serious: 'var(--serious)', alert: 'var(--crit)', blind: 'var(--blind)', info: 'var(--accent)', none: 'var(--blind)' };
const STATUS_WORD = { good: 'Good', clear: 'Clear', watch: 'Watch', serious: 'Serious', alert: 'Needs action', blind: 'No data', info: 'Info', none: 'Not rated' };

/** Status mark: check-circle (good), diamond (watch), triangle (alert), dashed ring (blind). */
export function StatusIcon({ status = 'none', size = 14, label }) {
  const c = STATUS_COLOR[status] || STATUS_COLOR.none;
  const word = label || STATUS_WORD[status] || status;
  let body;
  if (status === 'good' || status === 'clear') {
    body = (
      <>
        <circle cx="8" cy="8" r="6.5" fill={c} />
        <path d="M5 8.3l2.1 2.1 4-4.3" fill="none" stroke="var(--sheet)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </>
    );
  } else if (status === 'watch' || status === 'serious') {
    body = (
      <>
        <path d="M8 1.2l6.8 6.8-6.8 6.8-6.8-6.8z" fill={c} />
        <path d="M8 4.8v3.6M8 10.6v.6" fill="none" stroke="#0b0b0b" stroke-width="1.6" stroke-linecap="round" />
      </>
    );
  } else if (status === 'alert') {
    body = (
      <>
        <path d="M8 1.5l7 12.5h-14z" fill={c} stroke={c} stroke-width="1" stroke-linejoin="round" />
        <path d="M8 6v3.6M8 11.6v.4" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" />
      </>
    );
  } else if (status === 'info') {
    body = (
      <>
        <circle cx="8" cy="8" r="6.5" fill={c} />
        <path d="M8 7.2v4M8 4.6v.4" fill="none" stroke="var(--sheet)" stroke-width="1.6" stroke-linecap="round" />
      </>
    );
  } else {
    body = (
      <>
        <circle cx="8" cy="8" r="6" fill="none" stroke={c} stroke-width="1.5" stroke-dasharray="2.6 2.2" />
        <path d="M5.2 10.8l5.6-5.6" fill="none" stroke={c} stroke-width="1.5" stroke-linecap="round" />
      </>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={word} style="flex:none">
      {body}
    </svg>
  );
}

export const statusWord = (s) => STATUS_WORD[s] || s;
