/**
 * R15 — PriceTag
 *
 * The money graphic from the show (`assets and references/
 * Price_list_display.png` and the tag shot beside it): a gold-shelled
 * hexagon with a midnight face, the amount across it, and the rupee coin
 * riding its right tip.
 *
 * It already existed twice over — the prize bar above the question and the
 * rungs of the ladder — so it lives here now, because the reveal needs a
 * third one and the results screen a fourth, both of them much larger than
 * a bar that has to share a line with a countdown.
 *
 * Three tones, and they carry the verdict:
 *   gold  — the board's own colour: money in play, or money banked.
 *   green — just won. The same green the correct option bar turns, so the
 *           two halves of the reveal agree with each other.
 *   red   — the money that has just gone, or the floor a wrong answer left
 *           them standing on.
 *
 * Props:
 *   label — what the ladder says this rung pays: free text, '₹10,000' or
 *           '7 Crore' alike, exactly as the host typed it
 *   tone  — 'gold' (default) | 'green' | 'red'
 *   size  — 'sm' | 'md' (default) | 'lg' | 'xl'
 */

// Rim stops for the coin, top to bottom. The gold set is the same three
// the board's prize bar has always used, so the enlarged tag and the small
// one above the question read as the same object.
const TONE_RIM = {
  gold: ['#F7E7A0', '#F2B705', '#A9822F'],
  green: ['#C8F7DE', '#4ABC84', '#145C39'],
  red: ['#FFD3D3', '#E5484D', '#7F1417'],
};

// The coin's face, top to bottom — the deep well the rupee sits in. It goes
// with the rim rather than staying midnight throughout: a gold coin stuck on
// a green tag reads as two graphics that happened to land together.
const COIN_FACE = {
  gold: [['0%', '#1d2f7d'], ['65%', '#12205e'], ['100%', '#070f33']],
  green: [['0%', '#0d4a30'], ['65%', '#07331f'], ['100%', '#031a0f']],
  red: [['0%', '#3a1020'], ['65%', '#280a16'], ['100%', '#160409']],
};

export default function PriceTag({ label, tone = 'gold', size = 'md' }) {
  const rim = TONE_RIM[tone] || TONE_RIM.gold;
  // One gradient per tone rather than per instance: two tags of the same
  // tone on one screen would define identical stops, so sharing the id
  // costs nothing and keeps the markup readable.
  const rimId = `ptRim-${tone}`;
  const faceId = `ptFace-${tone}`;

  return (
    <div className={`pt pt--${tone} pt--${size}`}>
      <div className="pt-bar">
        <span className="pt-bar-inner">
          <span className="pt-value">{label}</span>
        </span>
      </div>

      <span className="pt-coin" aria-hidden="true">
        <svg viewBox="0 0 56 56">
          <defs>
            <linearGradient id={rimId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={rim[0]} />
              <stop offset="50%" stopColor={rim[1]} />
              <stop offset="100%" stopColor={rim[2]} />
            </linearGradient>
            <radialGradient id={faceId} cx="50%" cy="20%" r="85%">
              {(COIN_FACE[tone] || COIN_FACE.gold).map(([offset, color]) => (
                <stop key={offset} offset={offset} stopColor={color} />
              ))}
            </radialGradient>
          </defs>
          <circle cx="28" cy="28" r="26" fill={`url(#${faceId})`} stroke={`url(#${rimId})`} strokeWidth="3" />
          <circle cx="28" cy="28" r="20" fill="none" stroke={`url(#${rimId})`} strokeWidth="1.5" opacity="0.7" />
          <text
            x="28"
            y="29"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="'Poppins', sans-serif"
            fontSize="24"
            fontWeight="700"
            fill={`url(#${rimId})`}
          >
            ₹
          </text>
        </svg>
      </span>

      <PriceTagStyles />
    </div>
  );
}

/**
 * The styles, carried by the component itself: a tag turns up on the board,
 * over a blacked-out question and on the results screen, and none of those
 * three places should have to remember to import a stylesheet.
 *
 * Everything scales off `--pt-scale`, so a caller that needs the tag to fit
 * a narrow screen can override that one number rather than re-stating the
 * geometry. (QuestionCard does exactly that at its mobile breakpoint.)
 */
export function PriceTagStyles() {
  return (
    <style>{`
      .pt {
        --pt-scale: 1;
        --pt-cut: calc(28px * var(--pt-scale));
        --pt-coin: calc(56px * var(--pt-scale));
        --pt-clip: polygon(
          var(--pt-cut) 0,
          calc(100% - var(--pt-cut)) 0,
          100% 50%,
          calc(100% - var(--pt-cut)) 100%,
          var(--pt-cut) 100%,
          0 50%
        );
        position: relative;
        display: inline-flex;
        align-items: center;
        max-width: 100%;
        padding-right: calc(var(--pt-coin) / 2);
      }

      .pt--sm { --pt-scale: 0.72; }
      .pt--md { --pt-scale: 1; }
      .pt--lg { --pt-scale: 1.35; }
      .pt--xl { --pt-scale: 1.75; }

      /* The gold shell, clipped to the hexagon; the face sits inside it. */
      .pt-bar {
        position: relative;
        z-index: 1;
        padding: calc(2px * var(--pt-scale));
        clip-path: var(--pt-clip);
        background: linear-gradient(
          180deg,
          var(--champagne-gold) 0%,
          var(--spotlight-gold) 45%,
          var(--antique-gold) 100%
        );
        filter: drop-shadow(0 4px 12px rgba(0,0,0,0.45));
      }

      .pt--green .pt-bar {
        background: linear-gradient(180deg, #C8F7DE 0%, #4ABC84 45%, #145C39 100%);
        filter: drop-shadow(0 4px 12px rgba(0,0,0,0.45)) drop-shadow(0 0 14px rgba(74,188,132,0.35));
      }

      .pt--red .pt-bar {
        background: linear-gradient(180deg, #FFD3D3 0%, #E5484D 45%, #7F1417 100%);
        filter: drop-shadow(0 4px 12px rgba(0,0,0,0.45)) drop-shadow(0 0 14px rgba(229,72,77,0.35));
      }

      .pt-bar-inner {
        display: flex;
        align-items: center;
        justify-content: center;
        clip-path: var(--pt-clip);
        padding: calc(8px * var(--pt-scale)) calc(var(--pt-cut) + 18px * var(--pt-scale));
        min-height: calc(48px * var(--pt-scale));
        min-width: calc(180px * var(--pt-scale));
        background:
          radial-gradient(ellipse at 50% 0%, rgba(52,24,104,0.9) 0%, transparent 65%),
          linear-gradient(180deg, #14205c 0%, var(--deep-midnight) 55%, #060c2c 100%);
      }

      .pt--green .pt-bar-inner {
        background:
          radial-gradient(ellipse at 50% 0%, rgba(24,120,76,0.85) 0%, transparent 65%),
          linear-gradient(180deg, #0a3d28 0%, #062a1b 55%, #03170e 100%);
      }

      /* A lost rung is not a prize in a different colour — the face goes
         dark red too, so the tag reads as wrong before the number does. */
      .pt--red .pt-bar-inner {
        background:
          radial-gradient(ellipse at 50% 0%, rgba(120,20,30,0.85) 0%, transparent 65%),
          linear-gradient(180deg, #2a0710 0%, #1a040a 55%, #0d0206 100%);
      }

      .pt-value {
        font-family: 'Poppins', sans-serif;
        font-size: calc(26px * var(--pt-scale));
        font-weight: 700;
        line-height: 1;
        letter-spacing: 0.01em;
        white-space: nowrap;
        color: var(--cloud-white);
        text-shadow: 0 1px 2px rgba(0,0,0,0.6), 0 0 18px rgba(242,183,5,0.35);
      }

      .pt--green .pt-value {
        color: #8CF5BC;
        text-shadow: 0 1px 2px rgba(0,0,0,0.7), 0 0 22px rgba(74,188,132,0.55);
      }

      .pt--red .pt-value {
        color: #FF8A8A;
        text-shadow: 0 1px 2px rgba(0,0,0,0.7), 0 0 22px rgba(229,72,77,0.55);
      }

      .pt-coin {
        position: absolute;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        z-index: 2;
        width: var(--pt-coin);
        height: var(--pt-coin);
        filter: drop-shadow(0 4px 10px rgba(0,0,0,0.5));
      }

      .pt-coin svg {
        display: block;
        width: 100%;
        height: 100%;
      }
    `}</style>
  );
}
