import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import TiltedGridHero from './TiltedGridHero.jsx';
import { useIntroDone } from '../introState.js';
import { siteImage, useSite } from '../data/site.js';

// Mixed clothing, watches and editorial. Each entry names a site image (approved in Supabase Storage, or the demo
// photograph in public/images). `position` keeps the subject inside the 4:5 crop (object-position).
const HERO_SLOTS = [
  { key: 'quarter-zip-beige', position: '50% 28%' },
  { key: 'watch-seiko-sports', position: '56% 50%' },
  { key: 'oldverge-hero-model', position: '50% 30%' },
  { key: 'watch-timex-weekender', position: '50% 62%' },
  { key: 'quarter-zip-neutral', position: '50% 42%' },
  { key: 'oldverge-watch-editorial', position: '50% 50%' },
  { key: 'watch-hero-wrist', position: '50% 38%' },
  { key: 'watch-casio-mtp', position: '52% 50%' },
  { key: 'oldverge-hero-watch-detail', position: '50% 55%' },
  { key: 'quarter-zip-soft-knit', position: '50% 40%' },
];

/** The hero ribbon images that are actually available right now (unapproved or missing images are skipped). */
export const heroImages = () => HERO_SLOTS
  .map((slot) => { const image = siteImage(slot.key); return image ? { src: image.src, position: slot.position } : null; })
  .filter(Boolean);

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

// The ribbon box has an explicit height (.ov-hero2-ribbon in home.css) and the axis sits in its
// vertical middle, so the band is symmetrical and nothing is cut off at the top or bottom.
// `tileHeight` is the centre tile's height as a share of that box. Tiles nearer the edges are
// magnified by the perspective (about 1.4x where the mask has faded them to nothing), which is why
// the centre tile is about two-thirds of the box and not more.
// `curve` is how far round the cylinder the frame's edge sits. The cylinder's radius follows the
// hero's WIDTH, so narrower screens get a gentler curve to keep the ribbon reading as a ribbon.
const LAYOUTS = {
  wide: { tileHeight: 65, axis: 50, curve: 56, gap: 6, fade: 13, speed: 5 },
  medium: { tileHeight: 63, axis: 50, curve: 52, gap: 6, fade: 11, speed: 5 },
  compact: { tileHeight: 64, axis: 50, curve: 46, gap: 8, fade: 7, speed: 4.5 },
};

export default function HomeHero() {
  useSite((state) => state.siteImages);         // re-render when the site images load
  const images = heroImages();
  const entered = useIntroDone();
  const compact = useMediaQuery('(max-width: 650px)');
  const medium = useMediaQuery('(max-width: 1000px)');
  const layout = compact ? LAYOUTS.compact : medium ? LAYOUTS.medium : LAYOUTS.wide;
  return (
    <section className={`ov-hero2 ${entered ? 'is-entered' : 'is-waiting'}`} aria-labelledby="ov-hero-title">
      <div className="ov-hero2-copy">
        <h1 id="ov-hero-title" className="ov-rise" style={{ '--d': '0ms' }}>Timeless Elegance</h1>
        <p className="ov-rise" style={{ '--d': '120ms' }}>Considered clothing. Distinctive watches. Your everyday signature.</p>
        <div className="ov-hero2-actions ov-rise" style={{ '--d': '220ms' }}><Link to="/shop" className="ov-button ov-button-dark">Shop all</Link><Link to="/shop/watches" className="ov-button ov-button-light">Shop watches</Link></div>
      </div>
      {images.length >= 3 && <TiltedGridHero className="ov-hero2-ribbon" images={images} aspectRatio={4 / 5} {...layout} />}
    </section>
  );
}
