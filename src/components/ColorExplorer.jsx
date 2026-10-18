import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { QUARTER_ZIP_VARIANT_PHOTOS } from '../data/quarterZipVariants.js';
import Reveal from './Reveal.jsx';
import { siteImage, useSite } from '../data/site.js';

/**
 * Interactive colour explorer for the quarter-zip section.
 *
 * State model (three independent sources, one derived value):
 *   hovered  - mouse/pen pointer is over a colour control (temporary)
 *   focused  - a colour control has KEYBOARD focus (temporary)
 *   selected - a colour was tapped on a touch device (persistent until cleared)
 * Shown colour = hovered ?? focused ?? held ?? selected ?? null (the photo).
 * Touch never sets `hovered`, and mouse clicks never set `selected`, so the
 * three sources cannot fight each other.
 */

function Garment({ color, hex, slug }) {
  const photo = QUARTER_ZIP_VARIANT_PHOTOS[slug];
  if (photo) return <img className="ov-cx-photo" src={photo} alt={`${color} OLDVERGE quarter-zip`} draggable="false" />;
  const id = `ovg-${color.toLowerCase()}`;
  const body = 'M110 72 Q180 98 250 72 L260 100 L257 330 Q257 350 242 350 L118 350 Q103 350 103 330 L100 100 Z';
  const leftSleeve = 'M106 74 Q86 82 80 110 L38 292 Q34 308 48 312 L78 322 Q91 325 95 312 L124 176 Z';
  const rightSleeve = 'M254 74 Q274 82 280 110 L322 292 Q326 308 312 312 L282 322 Q269 325 265 312 L236 176 Z';
  return (
    <svg className="ov-cx-garment" viewBox="14 30 332 338" role="img" aria-label={`${color} quarter-zip (illustration)`} focusable="false">
      <defs>
        <pattern id={`${id}-rib`} width="4.5" height="4.5" patternUnits="userSpaceOnUse"><rect width="1.5" height="4.5" fill="#000" opacity=".2" /></pattern>
        <pattern id={`${id}-knit`} width="3.4" height="3.4" patternUnits="userSpaceOnUse"><rect width="1" height="3.4" fill="#000" opacity=".055" /><rect y="1.7" width="3.4" height=".7" fill="#fff" opacity=".035" /></pattern>
        <linearGradient id={`${id}-shade`} x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#000" stopOpacity=".2" /><stop offset=".28" stopColor="#000" stopOpacity="0" /><stop offset=".72" stopColor="#fff" stopOpacity=".04" /><stop offset="1" stopColor="#000" stopOpacity=".2" /></linearGradient>
        <linearGradient id={`${id}-sleeveL`} x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#000" stopOpacity=".16" /><stop offset=".6" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".22" /></linearGradient>
        <linearGradient id={`${id}-sleeveR`} x1="1" x2="0" y1="0" y2="0"><stop offset="0" stopColor="#000" stopOpacity=".16" /><stop offset=".6" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".22" /></linearGradient>
        <linearGradient id={`${id}-light`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".1" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".08" /></linearGradient>
        <filter id={`${id}-soft`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5" /></filter>
        <clipPath id={`${id}-bodyClip`}><path d={body} /></clipPath>
      </defs>
      <ellipse cx="180" cy="356" rx="122" ry="8" fill="#30251F" opacity=".13" />
      {/* sleeves */}
      <path d={leftSleeve} fill={hex} />
      <path d={rightSleeve} fill={hex} />
      <path d={leftSleeve} fill={`url(#${id}-sleeveL)`} />
      <path d={rightSleeve} fill={`url(#${id}-sleeveR)`} />
      <path d={leftSleeve} fill={`url(#${id}-knit)`} />
      <path d={rightSleeve} fill={`url(#${id}-knit)`} />
      {/* ribbed cuffs */}
      <path d="M42 284 L92 298 L95 312 Q91 325 78 322 L48 312 Q34 308 38 292 Z" fill={hex} />
      <path d="M42 284 L92 298 L95 312 Q91 325 78 322 L48 312 Q34 308 38 292 Z" fill={`url(#${id}-rib)`} />
      <path d="M318 284 L268 298 L265 312 Q269 325 282 322 L312 312 Q326 308 322 292 Z" fill={hex} />
      <path d="M318 284 L268 298 L265 312 Q269 325 282 322 L312 312 Q326 308 322 292 Z" fill={`url(#${id}-rib)`} />
      {/* shoulders: fills the gap between the sleeve tops and the collar */}
      <path d="M98 90 Q100 70 124 66 L236 66 Q260 70 262 90 L262 118 L98 118 Z" fill={hex} />
      <path d="M98 90 Q100 70 124 66 L236 66 Q260 70 262 90 L262 118 L98 118 Z" fill={`url(#${id}-knit)`} />
      {/* body */}
      <path d={body} fill={hex} />
      <path d={body} fill={`url(#${id}-knit)`} />
      <path d={body} fill={`url(#${id}-shade)`} />
      <path d={body} fill={`url(#${id}-light)`} />
      {/* soft shadow where the sleeves fall against the body */}
      <g clipPath={`url(#${id}-bodyClip)`} filter={`url(#${id}-soft)`} opacity=".5">
        <path d="M100 100 L124 176 L112 300" stroke="#000" strokeOpacity=".35" strokeWidth="9" fill="none" />
        <path d="M260 100 L236 176 L248 300" stroke="#000" strokeOpacity=".35" strokeWidth="9" fill="none" />
      </g>
      {/* ribbed hem */}
      <path d="M103 326 L257 326 L257 336 Q257 354 242 354 L118 354 Q103 354 103 336 Z" fill={hex} />
      <path d="M103 326 L257 326 L257 336 Q257 354 242 354 L118 354 Q103 354 103 336 Z" fill={`url(#${id}-rib)`} />
      <path d="M103 326 L257 326" stroke="#000" strokeOpacity=".18" strokeWidth="1.4" />
      {/* placket and zip */}
      <path d="M171 84 L189 84 L189 178 Q180 185 171 178 Z" fill="#000" opacity=".1" />
      <line x1="180" y1="56" x2="180" y2="176" stroke="#1B1613" strokeOpacity=".5" strokeWidth="2.2" strokeDasharray="1.6 2.2" />
      {/* stand collar */}
      <g filter={`url(#${id}-soft)`} opacity=".45"><ellipse cx="180" cy="86" rx="46" ry="9" fill="#000" /></g>
      <path d="M124 74 Q128 52 154 50 L206 50 Q232 52 236 74 Q180 100 124 74 Z" fill={hex} />
      <path d="M124 74 Q128 52 154 50 L206 50 Q232 52 236 74 Q180 100 124 74 Z" fill={`url(#${id}-rib)`} />
      <path d="M124 74 Q128 52 154 50 L206 50 Q232 52 236 74 Q180 100 124 74 Z" fill={`url(#${id}-light)`} />
      <ellipse cx="180" cy="51" rx="29" ry="7" fill="#000" opacity=".45" />
      <path d="M150 71 Q180 86 210 71" fill="none" stroke="#000" strokeOpacity=".22" strokeWidth="2" />
      <rect x="175.2" y="88" width="9.6" height="24" rx="3.2" fill="#D3CFC6" stroke="#30251F" strokeOpacity=".4" />
      <rect x="178" y="96" width="4" height="9" rx="1.6" fill="#30251F" opacity=".5" />
      {/* outline so pale colours keep their edge */}
      <path d={body} fill="none" stroke="#30251F" strokeOpacity=".14" />
      <path d={leftSleeve} fill="none" stroke="#30251F" strokeOpacity=".12" />
      <path d={rightSleeve} fill="none" stroke="#30251F" strokeOpacity=".12" />
    </svg>
  );
}

export default function ColorExplorer({ colors }) {
  useSite((state) => state.siteImages);
  const baseImage = siteImage('quarter-zip-beige');
  const [hovered, setHovered] = useState(null);
  const [focused, setFocused] = useState(null);
  const [selected, setSelected] = useState(null);
  // `held` keeps the last previewed colour while the pointer or focus travels
  // from the colour controls to the product link, so the link keeps its target.
  const [held, setHeld] = useState(null);
  const holdTimer = useRef(0);
  const hoveredRef = useRef(null);
  const lastPointer = useRef('mouse');
  const [canHover, setCanHover] = useState(true);

  useEffect(() => {
    const query = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setCanHover(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  // Warm the cache for any real product photos so the first preview is not blank.
  useEffect(() => {
    colors.forEach((color) => {
      const src = QUARTER_ZIP_VARIANT_PHOTOS[color.slug];
      if (src) { const img = new Image(); img.src = src; }
    });
  }, [colors]);

  useEffect(() => () => window.clearTimeout(holdTimer.current), []);
  const clearHold = useCallback(() => { window.clearTimeout(holdTimer.current); }, []);
  const onKeyboardFocus = useCallback((event, name) => {
    if (event.currentTarget.matches(':focus-visible')) setFocused(name);
  }, []);

  hoveredRef.current = hovered;
  const shown = hovered ?? focused ?? held ?? selected;
  const active = useMemo(() => colors.find((color) => color.name === shown) || null, [colors, shown]);

  const href = active ? `/product/${active.slug}` : '/shop/quarter-zips';
  const linkText = active ? `View ${active.name} quarter-zip` : 'The everyday quarter-zip';

  return (
    <section className="ov-color-section ov-cx" aria-labelledby="ov-zip-title">
      <Reveal className="ov-color-copy">
        <span className="ov-eyebrow">THE OLDVERGE QUARTER-ZIP</span>
        <h2 id="ov-zip-title">One considered layer.<br /><em>Four ways.</em></h2>
        <p>A familiar silhouette with a cleaner point of view. Find it in black, beige, navy, and olive.</p>
        <ul
          className="ov-color-list ov-cx-list"
          aria-label="Quarter-zip colours"
          onPointerLeave={(event) => {
            if (event.pointerType === 'touch') return;
            const last = hoveredRef.current;
            setHovered(null);
            if (last) {
              setHeld(last);
              window.clearTimeout(holdTimer.current);
              holdTimer.current = window.setTimeout(() => setHeld(null), 700);
            }
          }}
        >
          {colors.map((color) => {
            const isActive = shown === color.name;
            const isPinned = selected === color.name;
            return (
              <li key={color.name}>
                <button
                  type="button"
                  className={`ov-color-link ov-cx-btn${isActive ? ' is-active' : ''}`}
                  aria-pressed={isPinned}
                  aria-label={`${color.name} quarter-zip`}
                  onPointerDown={(event) => { lastPointer.current = event.pointerType; }}
                  onPointerEnter={(event) => { if (event.pointerType !== 'touch') { clearHold(); setHeld(null); setHovered(color.name); } }}
                  onFocus={(event) => onKeyboardFocus(event, color.name)}
                  onBlur={(event) => { setFocused((current) => (current === color.name ? null : current)); if (event.relatedTarget?.classList?.contains('ov-cx-link')) setHeld(color.name); }}
                  onClick={() => { if (lastPointer.current === 'touch') setSelected(color.name); lastPointer.current = 'mouse'; }}
                >
                  <i style={{ background: color.hex }} aria-hidden="true" />
                  <span>{color.name}</span>
                  <span className="ov-cx-mark" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
        {(selected || !canHover) && (
          <button type="button" className="ov-cx-reset" onClick={() => { setSelected(null); setHovered(null); }} disabled={!selected} aria-disabled={!selected}>
            <RotateCcw size={15} aria-hidden="true" /> Back to photo
          </button>
        )}
      </Reveal>

      <Reveal className="ov-color-image ov-cx-visual" delay={0.1} onPointerEnter={(event) => { if (event.pointerType !== 'touch') clearHold(); }} onPointerLeave={(event) => { if (event.pointerType !== 'touch') { clearHold(); setHeld(null); } }}>
        {baseImage && <img className="ov-cx-base" src={baseImage.src} alt={baseImage.alt} loading="lazy" />}
        <div className={`ov-cx-over${active ? ' is-on' : ''}`} role="group" aria-label="Quarter-zip colour display">
          {colors.map((color) => (
            <figure key={color.name} className={`ov-cx-tile${active?.name === color.name ? ' is-active' : ''}`} aria-hidden={active?.name === color.name ? undefined : 'true'}>
              <Garment color={color.name} hex={color.hex} slug={color.slug} />
            </figure>
          ))}
          <span className="ov-cx-name" aria-hidden="true">{active ? active.name : ''}</span>
          <span className="ov-cx-note">Illustration</span>
        </div>
        <Link to={href} className="ov-color-image-link ov-cx-link" onFocus={clearHold} onBlur={() => setHeld(null)}>{linkText} <ArrowRight size={14} aria-hidden="true" /></Link>
        <p className="ov-sr-only" role="status" aria-live="polite">{active ? `Showing ${active.name} quarter-zip` : ''}</p>
      </Reveal>
    </section>
  );
}
