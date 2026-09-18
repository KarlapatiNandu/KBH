/**
 * The badge artwork, drawn to sit inside the oval on the lifeline rail
 * (see `assets and references/Lifeline.png`). Everything is stroked in
 * `currentColor` so one CSS rule can light the whole badge up when the
 * lifeline goes live and grey it out once it is spent.
 */
export default function LifelineIcon({ lifelineKey, className = '' }) {
  const common = {
    className: `ll-icon ${className}`.trim(),
    viewBox: '0 0 64 40',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.4,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };

  switch (lifelineKey) {
    // Three figures behind a desk — the studio audience.
    case 'audience_poll':
      return (
        <svg {...common}>
          <circle cx="19" cy="13" r="4" />
          <path d="M12 26v-3a7 7 0 0 1 14 0v3" />
          <circle cx="32" cy="16" r="4.5" />
          <path d="M24.5 30v-3.5a7.5 7.5 0 0 1 15 0V30" />
          <circle cx="45" cy="13" r="4" />
          <path d="M38 26v-3a7 7 0 0 1 14 0v3" />
          <path d="M10 30h44" strokeWidth="2.8" />
        </svg>
      );

    // The only badge that is a word rather than a picture, as on the show.
    case 'fifty_fifty':
      return (
        <svg {...common} strokeWidth="0">
          <text
            x="32"
            y="21"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="'Poppins', sans-serif"
            fontSize="17"
            fontWeight="700"
            fill="currentColor"
          >
            50:50
          </text>
        </svg>
      );

    // Video camera — the expert joins on screen.
    case 'call_expert':
      return (
        <svg {...common}>
          <rect x="15" y="12" width="24" height="17" rx="3.5" />
          <path d="M39 18.5l9-4.5v12l-9-4.5z" />
        </svg>
      );

    // Handset.
    case 'phone_friend':
      return (
        <svg {...common}>
          <path d="M24.5 11.5c-1.4-1.4-3.6-1.4-5 0l-2.2 2.2c-1.2 1.2-1.5 3-.7 4.5 3.6 6.8 9 12.2 15.8 15.8 1.5.8 3.3.5 4.5-.7l2.2-2.2c1.4-1.4 1.4-3.6 0-5l-2.6-2.6c-1.4-1.4-3.6-1.4-5 0-1 1-2.5 1.1-3.6.3a23 23 0 0 1-3.4-3.4c-.8-1.1-.7-2.6.3-3.6 1.4-1.4 1.4-3.6 0-5z" />
        </svg>
      );

    default:
      return null;
  }
}
