import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Pause, Play } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import Reveal from './Reveal.jsx';
import { useFeatured } from '../data/featured.js';
import { formatPrice } from '../lib/money.js';
import { originalPhoto } from '../data/productImages.js';

/*
 * Featured Products — endless carousel.
 *
 * One accessible set of cards plus aria-hidden copies (tabindex -1, so they are never
 * keyboard stops, but still clickable when they are the ones on screen), laid out in a
 * single flex track. The track is moved with a transform by `pos` pixels and
 * `pos` wraps at `loop`, the measured distance between the first card of one
 * copy and the first card of the next. Because the copies are identical, the
 * wrap is invisible: no jump, no gap, no rewind.
 *
 * Manual browsing (touch, mouse drag, wheel, buttons) writes to the same `pos`.
 * A drag longer than DRAG_SLOP swallows the click that follows it, so a swipe
 * never opens a product.
 */

// The curated order lives in the `home.featured` store setting (see data/featured.js).
// The home carousel shows the original photographs; the background-removed cut-outs are for the shop and product pages.

const SPEED = 34;      // px per second, calm
const DRAG_SLOP = 6;   // px before a press counts as a drag
const RESUME_MS = 1600; // touch: resume after the finger lifts

function Card({ product, hidden, index, twinFocus }) {
  const label = product.type === 'watch' ? product.brand : 'OLDVERGE';
  const hover = product.hoverImage; // only shown when a product defines a real second image
  return (
    <li className={`ov-fp-item ${twinFocus ? 'is-twin-focus' : ''}`} data-i={index} aria-hidden={hidden || undefined}>
      <Link to={`/product/${product.slug}`} className="ov-fp-card" draggable={false} tabIndex={hidden ? -1 : undefined}>
        <span className={`ov-fp-media ${product.type === 'watch' ? 'is-watch' : 'is-zip'}`}>
          <img src={product.photo || originalPhoto(product.image)} alt={hidden ? '' : `${product.name}`} loading="lazy" draggable={false} />
          {hover && <img className="ov-fp-hover" src={hover} alt="" loading="lazy" draggable={false} />}
        </span>
        <span className="ov-fp-info">
          <span className="ov-fp-top"><span className="ov-fp-name">{product.name}</span><span className="ov-fp-label">{label}</span></span>
          <span className="ov-fp-bottom"><span className="ov-fp-price">{formatPrice(product.price)}</span><ArrowRight size={17} aria-hidden="true" /></span>
        </span>
      </Link>
    </li>
  );
}

export default function FeaturedCarousel() {
  const items = useFeatured();
  const reduced = useReducedMotion();
  const viewportRef = useRef(null);
  const trackRef = useRef(null);
  const state = useRef({ pos: 0, loop: 0, vel: 0, dragging: false, moved: false, startX: 0, startPos: 0, lastX: 0, lastT: 0, tween: null, hover: false, focus: false, inView: false, userPaused: false, touchHold: 0, swallow: false });
  const [copies, setCopies] = useState(2);
  const [userPaused, setUserPaused] = useState(false);
  const [focusIndex, setFocusIndex] = useState(null); // the focused card's twins in the copies show its focus ring

  const apply = () => {
    const s = state.current;
    if (!Number.isFinite(s.pos)) s.pos = 0;
    if (trackRef.current && s.loop) {
      const wrapped = ((s.pos % s.loop) + s.loop) % s.loop;
      s.pos = wrapped;
      trackRef.current.style.transform = `translate3d(${-wrapped}px,0,0)`;
    }
  };

  // Measure the loop distance and decide how many copies are needed.
  const measure = useCallback(() => {
    const track = trackRef.current;
    const viewport = viewportRef.current;
    if (!track || !viewport || reduced) return;
    const cards = track.querySelectorAll('.ov-fp-item');
    const per = items.length;
    if (cards.length < per + 1) return;
    const loop = cards[per].offsetLeft - cards[0].offsetLeft;
    if (loop > 0) {
      state.current.loop = loop;
      const needed = Math.max(2, Math.ceil(viewport.clientWidth / loop) + 1);
      setCopies((current) => (current === needed ? current : needed));
      apply();
    }
  }, [reduced, items.length]);

  useLayoutEffect(() => {
    measure();
    const viewport = viewportRef.current;
    if (!viewport || reduced) return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(viewport);
    if (trackRef.current) ro.observe(trackRef.current.firstElementChild);
    document.fonts?.ready.then(measure);
    const onLoad = () => measure();
    trackRef.current?.addEventListener('load', onLoad, true);
    const track = trackRef.current;
    return () => { ro.disconnect(); track?.removeEventListener('load', onLoad, true); };
  }, [measure, reduced, copies]);

  // Only animate while on screen and the tab is visible.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const io = new IntersectionObserver(([entry]) => { state.current.inView = entry.isIntersecting; }, { threshold: 0.05 });
    io.observe(viewport);
    return () => io.disconnect();
  }, []);

  useEffect(() => { state.current.userPaused = userPaused; }, [userPaused]);

  // The animation loop.
  useEffect(() => {
    if (reduced) return undefined;
    let raf = 0;
    let last = performance.now();
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const s = state.current;
      const dt = Math.min(now - last, 50);
      last = now;
      if (!s.loop || !s.inView || document.hidden) return;
      if (s.tween) {
        const t = Math.min(1, (now - s.tween.start) / s.tween.ms);
        const eased = 1 - Math.pow(1 - t, 3);
        s.pos = s.tween.from + (s.tween.to - s.tween.from) * eased;
        if (t >= 1) s.tween = null;
      } else if (!s.dragging) {
        if (Math.abs(s.vel) > 0.02) { s.pos += s.vel * dt; s.vel *= Math.exp(-dt / 260); } else s.vel = 0;
        const holding = s.hover || s.focus || s.userPaused || now < s.touchHold || s.vel !== 0;
        if (!holding) s.pos += (SPEED * dt) / 1000;
      }
      apply();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  // ---- manual browsing ----
  const onPointerDown = (event) => {
    if (reduced || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const s = state.current;
    s.dragging = true; s.moved = false; s.startX = s.lastX = event.clientX; s.startPos = s.pos; s.lastT = performance.now(); s.vel = 0; s.tween = null;
  };
  const onPointerMove = (event) => {
    const s = state.current;
    if (!s.dragging) return;
    const dx = event.clientX - s.startX;
    if (!s.moved && Math.abs(dx) > DRAG_SLOP) { s.moved = true; viewportRef.current?.setPointerCapture?.(event.pointerId); viewportRef.current?.classList.add('is-dragging'); }
    if (s.moved) {
      const now = performance.now();
      const dt = Math.max(1, now - s.lastT);
      s.vel = (-(event.clientX - s.lastX) / dt) * 0.9;
      s.lastX = event.clientX; s.lastT = now;
      s.pos = s.startPos - dx;
      apply();
    }
  };
  const onPointerEnd = (event) => {
    const s = state.current;
    if (!s.dragging) return;
    s.dragging = false;
    viewportRef.current?.classList.remove('is-dragging');
    if (s.moved) {
      s.swallow = true;                       // swallow the click that follows a swipe
      window.setTimeout(() => { s.swallow = false; }, 60);
      if (event.pointerType !== 'mouse') s.touchHold = performance.now() + RESUME_MS;
      if (performance.now() - s.lastT > 90) s.vel = 0;
    }
  };
  const onClickCapture = (event) => {
    if (state.current.swallow) { event.preventDefault(); event.stopPropagation(); }
  };
  const onWheel = (event) => {
    if (reduced || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    const s = state.current;
    s.pos += event.deltaX; s.tween = null; s.touchHold = performance.now() + RESUME_MS;
    apply();
  };

  const step = (direction) => {
    const viewport = viewportRef.current;
    const cards = trackRef.current?.querySelectorAll('.ov-fp-item');
    if (!viewport || !cards || cards.length < 2) return;
    const width = cards[1].offsetLeft - cards[0].offsetLeft; // one card plus its gap
    if (reduced) { viewport.scrollBy({ left: direction * width, behavior: 'auto' }); return; }
    const s = state.current;
    const from = s.tween ? s.tween.to : s.pos;
    s.vel = 0;
    s.tween = { from: s.pos, to: from + direction * width, start: performance.now(), ms: 520 };
  };

  // Keep a keyboard-focused card inside the viewport (the track is moved by transform).
  const onFocus = (event) => {
    const s = state.current;
    s.focus = true;
    if (reduced) { const own = event.target.closest?.('.ov-fp-item'); if (own) setFocusIndex(Number(own.dataset.i)); return; }
    const card = event.target.closest?.('.ov-fp-item');
    const viewport = viewportRef.current;
    if (card) setFocusIndex(Number(card.dataset.i));
    if (!card || !viewport) return;
    const edge = 24;
    // The same card exists once per copy: use whichever instance is nearest the middle of the viewport.
    let left = card.offsetLeft - s.pos;
    if (s.loop) left -= Math.round((left - (viewport.clientWidth - card.offsetWidth) / 2) / s.loop) * s.loop;
    const right = left + card.offsetWidth;
    if (left < edge) s.tween = { from: s.pos, to: s.pos + left - edge, start: performance.now(), ms: 320 };
    else if (right > viewport.clientWidth - edge) s.tween = { from: s.pos, to: s.pos + right - viewport.clientWidth + edge, start: performance.now(), ms: 320 };
  };
  const onBlur = (event) => { if (!event.currentTarget.contains(event.relatedTarget)) { state.current.focus = false; setFocusIndex(null); } };

  const sets = reduced ? 1 : copies;
  return (
    <section className="ov-fp" aria-labelledby="ov-fp-title">
      <Reveal className="ov-fp-head">
        <h2 id="ov-fp-title">Featured Products</h2>
        <div className="ov-fp-controls" role="group" aria-label="Carousel controls">
          <button type="button" className="ov-fp-btn" onClick={() => step(-1)} aria-label="Previous products"><ArrowLeft size={16} aria-hidden="true" /></button>
          {!reduced && <button type="button" className="ov-fp-btn" onClick={() => setUserPaused((value) => !value)} aria-pressed={userPaused} aria-label={userPaused ? 'Play automatic scrolling' : 'Pause automatic scrolling'}>{userPaused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}</button>}
          <button type="button" className="ov-fp-btn" onClick={() => step(1)} aria-label="Next products"><ArrowRight size={16} aria-hidden="true" /></button>
        </div>
      </Reveal>
      <div
        ref={viewportRef}
        className={`ov-fp-viewport ${reduced ? 'is-manual' : ''}`}
        {...(reduced ? { tabIndex: 0, role: 'region', 'aria-label': 'Featured products, scrollable' } : {})}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
        onWheel={onWheel}
        onPointerEnter={(event) => { if (event.pointerType === 'mouse') state.current.hover = true; }}
        onPointerLeave={(event) => { if (event.pointerType === 'mouse') state.current.hover = false; }}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        <div ref={trackRef} className="ov-fp-track">
          {Array.from({ length: sets }, (_, copy) => (
            <ul className="ov-fp-set" key={copy} {...(copy === 0 ? { 'aria-label': 'Featured products' } : { 'aria-hidden': true })}>
              {items.map((product, index) => <Card product={product} index={index} hidden={copy > 0} twinFocus={copy > 0 && focusIndex === index} key={`${copy}-${product.id}`} />)}
            </ul>
          ))}
        </div>
      </div>
    </section>
  );
}
