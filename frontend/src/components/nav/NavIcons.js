/** Architectural / financial nav seals — engraved structure, gilt metal, paper light. */

function Svg({ id, size = 36, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-gold`} x1="8" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFF8D4" />
          <stop offset="28%" stopColor="#F2D68A" />
          <stop offset="62%" stopColor="#C9A227" />
          <stop offset="100%" stopColor="#7A5A0E" />
        </linearGradient>
        <linearGradient id={`${id}-paper`} x1="10" y1="6" x2="36" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#D7E8EC" />
        </linearGradient>
        <linearGradient id={`${id}-ink`} x1="8" y1="6" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1A4F5E" />
          <stop offset="100%" stopColor="#061A23" />
        </linearGradient>
        <filter id={`${id}-glow`} x="-18%" y="-18%" width="136%" height="136%">
          <feDropShadow dx="0" dy="0.8" stdDeviation="0.7" floodColor="#C9A227" floodOpacity="0.4" />
        </filter>
      </defs>
      <g filter={`url(#${id}-glow)`}>{children}</g>
    </svg>
  );
}

const g = (id) => `url(#${id}-gold)`;
const p = (id) => `url(#${id}-paper)`;
const k = (id) => `url(#${id}-ink)`;

export function IconDashboard({ size }) {
  const id = "nav-dash";
  return (
    <Svg id={id} size={size}>
      <path d="M8 20.5 24 8l16 12.5V40a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V20.5Z" fill={k(id)} />
      <path d="M24 10.4 37.6 21V39.2H10.4V21L24 10.4Z" fill={g(id)} />
      <path d="M13.2 39.2V24.6h6.4V39.2h-6.4Zm7.8 0V24.6h6v14.6h-6Zm7.4 0V24.6h6.4V39.2H28.4Z" fill={k(id)} />
      <path d="M15.4 27.2h2.2M15.4 30.6h2.2M23.1 27.2h2M23.1 30.6h2M31 27.2h2.2M31 30.6h2.2" stroke={g(id)} strokeWidth="1.15" strokeLinecap="round" />
      <path d="M21.2 39.2V33.4h5.6v5.8" fill={p(id)} />
      <path d="M8.8 20.8 24 8.8l15.2 12" stroke={p(id)} strokeWidth="1.1" />
      <rect x="22.4" y="5.6" width="3.2" height="3.4" rx="0.4" fill={g(id)} />
    </Svg>
  );
}

export function IconLeads({ size }) {
  const id = "nav-leads";
  return (
    <Svg id={id} size={size}>
      <rect x="6.5" y="14" width="35" height="24.5" rx="3.2" fill={k(id)} />
      <path d="M6.5 16.2 24 28.4 41.5 16.2V14H6.5v2.2Z" fill={g(id)} />
      <path d="M9.4 18.8 24 28.8 38.6 18.8" stroke={p(id)} strokeWidth="1.05" />
      <path d="M11.6 32.6h10.4M11.6 36h7.2" stroke={p(id)} strokeWidth="1.15" strokeLinecap="round" />
      <circle cx="34.2" cy="34.4" r="5.1" fill={g(id)} />
      <circle cx="34.2" cy="34.4" r="3.1" fill={k(id)} />
      <path d="M34.2 32.2v4.4M32.4 34.4h3.6" stroke={g(id)} strokeWidth="1.15" strokeLinecap="round" />
      <path d="M16 7.4h16l-2.4 5.2H18.4L16 7.4Z" fill={g(id)} />
      <path d="M24 5.2v4.6" stroke={p(id)} strokeWidth="1.2" strokeLinecap="round" />
    </Svg>
  );
}

export function IconClients({ size }) {
  const id = "nav-clients";
  return (
    <Svg id={id} size={size}>
      <path d="M24 5.4 42 19.2h-4.2V42H10.2V19.2H6L24 5.4Z" fill={k(id)} />
      <path d="M24 8.2 37.6 19.4V40H10.4V19.4L24 8.2Z" fill={g(id)} />
      <path d="M13.2 22.6h6.2v6.4h-6.2zm15.4 0h6.2v6.4h-6.2z" fill={k(id)} />
      <path d="M14.6 24.2h3.2M14.6 26.8h3.2M30.2 24.2h3.2M30.2 26.8h3.2" stroke={g(id)} strokeWidth="1" strokeLinecap="round" />
      <rect x="20.2" y="27.6" width="7.6" height="12.4" rx="0.8" fill={k(id)} />
      <circle cx="25.8" cy="34.2" r="0.7" fill={g(id)} />
      <path d="M10.4 40h27.2" stroke={k(id)} strokeWidth="1.4" />
      <path d="M12.6 40.8h22.8" stroke={p(id)} strokeWidth="1" />
      <path d="M21.2 19.4h5.6v2.4h-5.6z" fill={k(id)} />
    </Svg>
  );
}

export function IconJobs({ size }) {
  const id = "nav-jobs";
  return (
    <Svg id={id} size={size}>
      <path d="M9 18h30v21.2A3.2 3.2 0 0 1 35.8 42.4H12.2A3.2 3.2 0 0 1 9 39.2V18Z" fill={k(id)} />
      <path d="M14.4 18V13.2A5.2 5.2 0 0 1 19.6 8h8.8A5.2 5.2 0 0 1 33.6 13.2V18" stroke={g(id)} strokeWidth="2.1" />
      <path d="M19.2 8.2h9.6" stroke={p(id)} strokeWidth="1.15" strokeLinecap="round" />
      <path d="M9 23.6h30" stroke={g(id)} strokeWidth="1.8" />
      <path d="M13.4 27.6h5.2v10.4h-5.2zm8 0h5.2v10.4H21.4zm8 0h5.2v10.4h-5.2z" fill={g(id)} opacity="0.92" />
      <path d="M14.8 30h2.4M14.8 33.2h2.4M22.8 30h2.4M22.8 33.2h2.4M30.8 30h2.4M30.8 33.2h2.4" stroke={k(id)} strokeWidth="1.05" strokeLinecap="round" />
      <circle cx="24" cy="21.4" r="1.35" fill={p(id)} />
    </Svg>
  );
}

export function IconPlans({ size }) {
  const id = "nav-plans";
  return (
    <Svg id={id} size={size}>
      <rect x="5.4" y="5.4" width="37.2" height="37.2" rx="3.4" fill={k(id)} />
      <rect x="8" y="8" width="32" height="32" rx="1.6" fill={g(id)} opacity="0.18" />
      <path d="M8 16.6h32M8 25h32M8 33.4h32M16.6 8v32M25 8v32M33.4 8v32" stroke={g(id)} strokeWidth="0.85" opacity="0.85" />
      <path d="M12.4 20.4h14.8v14.4H12.4z" fill="none" stroke={p(id)} strokeWidth="1.35" />
      <path d="M12.4 27.6h14.8M19.8 20.4v14.4" stroke={p(id)} strokeWidth="1.05" />
      <path d="M29.6 14.2h6.8v6.8h-6.8z" fill={g(id)} />
      <circle cx="33" cy="17.6" r="1.5" fill={k(id)} />
      <path d="M10.2 10.2h3.4M10.2 10.2v3.4M37.8 10.2h-3.4M37.8 10.2v3.4" stroke={g(id)} strokeWidth="1.15" strokeLinecap="round" />
      <path d="M11.2 38.4h8.6" stroke={g(id)} strokeWidth="1.2" strokeLinecap="round" />
    </Svg>
  );
}

export function IconEstimates({ size }) {
  const id = "nav-est";
  return (
    <Svg id={id} size={size}>
      <path d="M11.2 4.8h18.4L38.8 14.2V40.4A3.4 3.4 0 0 1 35.4 43.8H11.2A3.4 3.4 0 0 1 7.8 40.4V8.2A3.4 3.4 0 0 1 11.2 4.8Z" fill={k(id)} />
      <path d="M29.4 5v8.2A2 2 0 0 0 31.4 15.2h8" fill={g(id)} />
      <path d="M12.8 18.6h16.4M12.8 22.8h16.4M12.8 27h12.2M12.8 31.2h14" stroke={p(id)} strokeWidth="1.15" strokeLinecap="round" />
      <rect x="12.6" y="34.6" width="10.8" height="5.2" rx="1" fill={g(id)} />
      <path d="M31.6 22.2c-2.8 0-4.2 1.5-4.2 3.4 0 2.9 4.2 2.6 4.2 4.6 0 1.2-1 1.9-2.5 1.9-1.2 0-2.2-.45-3-1.2" stroke={g(id)} strokeWidth="1.55" strokeLinecap="round" />
      <path d="M31.6 20.8v1.3M31.6 32.1v1.3" stroke={g(id)} strokeWidth="1.45" strokeLinecap="round" />
    </Svg>
  );
}

export function IconInvoices({ size }) {
  const id = "nav-inv";
  return (
    <Svg id={id} size={size}>
      <rect x="8" y="5" width="32" height="38" rx="3.2" fill={k(id)} />
      <rect x="10.6" y="7.6" width="26.8" height="32.8" rx="1.6" stroke={g(id)} strokeWidth="1.15" />
      <path d="M14.2 13.2h19.6M14.2 17.6h19.6M14.2 22h13.4M14.2 26.4h16.2" stroke={p(id)} strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="32.2" cy="34.6" r="6.1" fill={g(id)} />
      <circle cx="32.2" cy="34.6" r="4.2" fill={k(id)} />
      <path d="M32.2 31.6c-1.7 0-2.5.9-2.5 1.9 0 1.7 2.5 1.55 2.5 2.7 0 .75-.6 1.15-1.5 1.15-.75 0-1.35-.28-1.85-.75" stroke={g(id)} strokeWidth="1.2" strokeLinecap="round" />
      <path d="M32.2 30.6v1M32.2 37.35v1" stroke={g(id)} strokeWidth="1.15" strokeLinecap="round" />
      <path d="M13.6 34.2h9.2" stroke={g(id)} strokeWidth="1.25" strokeLinecap="round" />
    </Svg>
  );
}

export function IconFinancials({ size }) {
  const id = "nav-fin";
  return (
    <Svg id={id} size={size}>
      <path d="M7.2 40.8h33.6" stroke={g(id)} strokeWidth="1.6" strokeLinecap="round" />
      <rect x="8.2" y="26.4" width="6.2" height="13.2" rx="1.1" fill={k(id)} />
      <rect x="16.4" y="20.2" width="6.2" height="19.4" rx="1.1" fill={k(id)} />
      <rect x="24.6" y="13.4" width="6.2" height="26.2" rx="1.1" fill={g(id)} />
      <rect x="32.8" y="22.6" width="6.2" height="17" rx="1.1" fill={k(id)} />
      <path d="M9.4 24.8 17.2 18.6 27.6 10.8 38.4 16.4" stroke={g(id)} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="38.4" cy="16.4" r="3.6" fill={g(id)} />
      <circle cx="38.4" cy="16.4" r="2.15" fill={k(id)} />
      <path d="M38.4 15.1v2.6M37.3 16.4h2.2" stroke={g(id)} strokeWidth="1" strokeLinecap="round" />
      <path d="M9.6 29.2h3.4M17.8 24.2h3.4M26 18.4h3.4M34.2 26.6h3.4" stroke={p(id)} strokeWidth="1" strokeLinecap="round" />
    </Svg>
  );
}

export function IconContracts({ size }) {
  const id = "nav-con";
  return (
    <Svg id={id} size={size}>
      <path d="M9.6 5.2h19.2L38.8 15.4V40.6A3.4 3.4 0 0 1 35.4 44H9.6A3.4 3.4 0 0 1 6.2 40.6V8.6A3.4 3.4 0 0 1 9.6 5.2Z" fill={k(id)} />
      <path d="M28.6 5.4v9.2A2.2 2.2 0 0 0 30.8 16.8h8.4" fill={g(id)} />
      <path d="M12.4 20.4h16.8M12.4 24.6h16.8M12.4 28.8h11.6" stroke={p(id)} strokeWidth="1.1" strokeLinecap="round" />
      <path d="M12.6 35.2c3.8 4.2 8.6 5.4 13.6 1.6" stroke={g(id)} strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="27.4" cy="35.8" r="4.4" fill={g(id)} />
      <circle cx="27.4" cy="35.8" r="2.5" fill={k(id)} />
      <path d="M26.2 35.8h2.4M27.4 34.6v2.4" stroke={g(id)} strokeWidth="1.05" strokeLinecap="round" />
    </Svg>
  );
}

export function IconTeam({ size }) {
  const id = "nav-team";
  return (
    <Svg id={id} size={size}>
      <circle cx="24" cy="10.4" r="5" fill={g(id)} />
      <circle cx="24" cy="10.2" r="1.6" fill={p(id)} />
      <circle cx="11.2" cy="16.2" r="4.1" fill={k(id)} />
      <circle cx="36.8" cy="16.2" r="4.1" fill={k(id)} />
      <path d="M24 16.8c5.8 0 9.6 3.2 10.2 8.8H13.8C14.4 20 18.2 16.8 24 16.8Z" fill={k(id)} />
      <path d="M7.2 38.8c.5-4.6 3.2-7 7.2-7" stroke={g(id)} strokeWidth="1.55" strokeLinecap="round" />
      <path d="M40.8 38.8c-.5-4.6-3.2-7-7.2-7" stroke={g(id)} strokeWidth="1.55" strokeLinecap="round" />
      <path d="M14.8 32.4c1.4-3.6 4.6-5.4 9.2-5.4s7.8 1.8 9.2 5.4" fill={g(id)} opacity="0.95" />
      <path d="M16.6 18.8 24 16.6l7.4 2.2" stroke={g(id)} strokeWidth="1.15" strokeLinecap="round" />
    </Svg>
  );
}

export function IconField({ size }) {
  const id = "nav-field";
  return (
    <Svg id={id} size={size}>
      <rect x="13.2" y="4.2" width="21.6" height="39.6" rx="4.2" fill={k(id)} />
      <rect x="15.8" y="8.2" width="16.4" height="22.4" rx="1.6" fill={g(id)} />
      <path d="M24 11.4c-3.2 0-5.2 2.4-5.2 5.2 0 4.2 5.2 9.6 5.2 9.6s5.2-5.4 5.2-9.6c0-2.8-2-5.2-5.2-5.2Z" fill={k(id)} />
      <circle cx="24" cy="16.4" r="1.7" fill={p(id)} />
      <path d="M18.4 12.8h11.2M18.4 25.8h11.2" stroke={k(id)} strokeWidth="0.9" opacity="0.35" />
      <circle cx="24" cy="36.8" r="2.15" fill={g(id)} />
      <circle cx="24" cy="36.8" r="0.75" fill={p(id)} />
    </Svg>
  );
}

export function IconClock({ size }) {
  const id = "nav-clock";
  return (
    <Svg id={id} size={size}>
      <circle cx="24" cy="24" r="18.2" fill={k(id)} />
      <circle cx="24" cy="24" r="14.6" fill={g(id)} />
      <circle cx="24" cy="24" r="11.6" fill={k(id)} />
      <path d="M24 14.2v10.2l6.6 3.6" stroke={g(id)} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="24.2" r="1.55" fill={p(id)} />
      <path d="M24 9.8v2.2M24 36v2.2M9.8 24h2.2M36 24h2.2" stroke={g(id)} strokeWidth="1.25" strokeLinecap="round" />
      <path d="M13.2 13.2l1.4 1.4M33.4 33.4l1.4 1.4M13.2 34.8l1.4-1.4M33.4 14.6l1.4-1.4" stroke={p(id)} strokeWidth="1.05" strokeLinecap="round" />
    </Svg>
  );
}

export function IconCamera({ size }) {
  const id = "nav-cam";
  return (
    <Svg id={id} size={size}>
      <rect x="4.4" y="14.2" width="39.2" height="25.2" rx="4.2" fill={k(id)} />
      <path d="M15.2 14.2 18.2 8.4h11.6l3 5.8" fill={g(id)} />
      <circle cx="24" cy="26.6" r="8.2" fill={g(id)} />
      <circle cx="24" cy="26.6" r="5.4" fill={k(id)} />
      <circle cx="24" cy="26.6" r="2.2" fill={p(id)} />
      <path d="M24 21.8v1.8M24 29.6v1.8M19.2 26.6h1.8M27 26.6h1.8" stroke={g(id)} strokeWidth="1" strokeLinecap="round" />
      <rect x="8.2" y="18.2" width="4.2" height="2.4" rx="0.6" fill={g(id)} />
    </Svg>
  );
}

export function IconSchedule({ size }) {
  const id = "nav-cal";
  return (
    <Svg id={id} size={size}>
      <rect x="5.6" y="8.6" width="36.8" height="32.6" rx="3.6" fill={k(id)} />
      <path d="M5.6 16.8h36.8" stroke={g(id)} strokeWidth="2" />
      <path d="M15.2 5.4v6.6M32.8 5.4v6.6" stroke={g(id)} strokeWidth="2" strokeLinecap="round" />
      <path d="M14.2 22.2h4.2v4.2h-4.2zm7.7 0h4.2v4.2h-4.2zm7.7 0h4.2v4.2h-4.2z" fill={p(id)} opacity="0.85" />
      <rect x="14.2" y="29.4" width="4.2" height="4.2" rx="0.6" fill={g(id)} />
      <path d="M21.9 29.4h4.2v4.2h-4.2zm7.7 0h4.2v4.2h-4.2z" fill={p(id)} opacity="0.55" />
      <path d="M10.4 12.4h4.6" stroke={p(id)} strokeWidth="1.05" strokeLinecap="round" />
    </Svg>
  );
}
