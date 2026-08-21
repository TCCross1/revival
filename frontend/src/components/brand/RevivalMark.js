export default function RevivalMark({ className = "rp-banner-mark" }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width="256"
      height="256"
      role="img"
      aria-hidden="true"
      shapeRendering="geometricPrecision"
    >
      <defs>
        <linearGradient id="rpGoldV" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#8A6A14" />
          <stop offset="28%" stopColor="#C9A227" />
          <stop offset="58%" stopColor="#F0D078" />
          <stop offset="78%" stopColor="#FFF1B8" />
          <stop offset="100%" stopColor="#C9A227" />
        </linearGradient>
        <linearGradient id="rpGoldPath" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stopColor="#F6E29A" />
          <stop offset="45%" stopColor="#C9A227" />
          <stop offset="100%" stopColor="#8A6A14" />
        </linearGradient>
        <linearGradient id="rpHouse" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#E4EDF0" />
        </linearGradient>
        <linearGradient id="rpLeafL" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7EB3FF" />
          <stop offset="42%" stopColor="#0B3A8F" />
          <stop offset="100%" stopColor="#061A23" />
        </linearGradient>
        <linearGradient id="rpLeafR" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFF1B8" />
          <stop offset="38%" stopColor="#C9A227" />
          <stop offset="100%" stopColor="#7A5C12" />
        </linearGradient>
        <linearGradient id="rpRing" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F0D078" />
          <stop offset="35%" stopColor="#C9A227" />
          <stop offset="70%" stopColor="#7EB3FF" />
          <stop offset="100%" stopColor="#C9A227" />
        </linearGradient>
        <radialGradient id="rpSky" cx="50%" cy="42%" r="48%">
          <stop offset="0%" stopColor="#143C4C" />
          <stop offset="100%" stopColor="#061A23" />
        </radialGradient>
      </defs>
      <circle cx="256" cy="256" r="248" fill="url(#rpSky)" />
      <circle cx="256" cy="256" r="248" fill="none" stroke="url(#rpRing)" strokeWidth="8" />
      <circle cx="256" cy="256" r="236" fill="none" stroke="#0B3A8F" strokeWidth="3.2" />
      <circle cx="256" cy="256" r="228" fill="none" stroke="#C9A227" strokeWidth="1.35" />
      <g transform="translate(256 214)" stroke="url(#rpGoldV)" strokeWidth="3.4" strokeLinecap="round" fill="none">
        <line x1="0" y1="-168" x2="0" y2="-102" />
        <g transform="rotate(-12)"><line x1="0" y1="-164" x2="0" y2="-100" /></g>
        <g transform="rotate(12)"><line x1="0" y1="-164" x2="0" y2="-100" /></g>
        <g transform="rotate(-24)"><line x1="0" y1="-156" x2="0" y2="-96" /></g>
        <g transform="rotate(24)"><line x1="0" y1="-156" x2="0" y2="-96" /></g>
        <g transform="rotate(-36)"><line x1="0" y1="-146" x2="0" y2="-90" /></g>
        <g transform="rotate(36)"><line x1="0" y1="-146" x2="0" y2="-90" /></g>
        <g transform="rotate(-48)"><line x1="0" y1="-132" x2="0" y2="-82" /></g>
        <g transform="rotate(48)"><line x1="0" y1="-132" x2="0" y2="-82" /></g>
        <g transform="rotate(-60)"><line x1="0" y1="-116" x2="0" y2="-74" /></g>
        <g transform="rotate(60)"><line x1="0" y1="-116" x2="0" y2="-74" /></g>
        <g transform="rotate(-72)"><line x1="0" y1="-98" x2="0" y2="-64" /></g>
        <g transform="rotate(72)"><line x1="0" y1="-98" x2="0" y2="-64" /></g>
      </g>
      <path d="M118 286 A138 138 0 0 1 394 286 L256 286 Z" fill="url(#rpGoldV)" />
      <path d="M168 286 L256 132 L344 286 Z" fill="#061A23" />
      <path d="M180 278 L256 148 L332 278 Z" fill="#0B3A8F" />
      <rect x="196" y="232" width="120" height="108" fill="url(#rpHouse)" />
      <rect x="328" y="168" width="16" height="42" fill="#061A23" />
      <rect x="331" y="164" width="10" height="8" fill="#C9A227" />
      <rect x="232" y="250" width="48" height="48" fill="#061A23" />
      <rect x="236" y="254" width="18" height="18" fill="#F0D078" />
      <rect x="258" y="254" width="18" height="18" fill="#FFF1B8" />
      <rect x="236" y="276" width="18" height="18" fill="#C9A227" />
      <rect x="258" y="276" width="18" height="18" fill="#F0D078" />
      <path d="M232 274 H280 M256 250 V298" stroke="#061A23" strokeWidth="2.2" />
      <rect x="238" y="300" width="36" height="40" fill="#061A23" />
      <path d="M274 300 V340 H252 C258 328 268 314 274 300 Z" fill="#F0D078" />
      <rect x="241" y="303" width="10" height="34" fill="#0B3A8F" />
      <path d="M256 392 C248 372 238 350 244 324 C250 308 256 300 256 300 C262 308 268 324 268 344 C272 368 262 386 256 392 Z" fill="url(#rpGoldPath)" />
      <path d="M64 372 C118 318 176 308 232 344 C196 366 146 398 98 424 C76 408 64 390 64 372 Z" fill="url(#rpLeafL)" />
      <path d="M448 372 C394 318 336 308 280 344 C316 366 366 398 414 424 C436 408 448 390 448 372 Z" fill="url(#rpLeafR)" />
      <path d="M92 376 C138 348 180 342 214 358" fill="none" stroke="#7EB3FF" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M420 376 C374 348 332 342 298 358" fill="none" stroke="#FFF1B8" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
