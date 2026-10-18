import { Link } from 'react-router-dom';
import { imageSize } from '../data/imageSizes.js';
import { siteImage, useSite } from '../data/site.js';
import Reveal from '../components/Reveal.jsx';

// Renders nothing when the named site image has not been approved (or loaded), instead of a broken or placeholder picture.
const Photo = ({ name, alt, eager = false, className }) => { const image = siteImage(name); return image ? <img className={className} src={image.src} alt={alt || image.alt} {...imageSize(image.src)} loading={eager ? 'eager' : 'lazy'} decoding="async" /> : null; };

// Copy is limited to what the project can support: what is sold, the four colours, the watch styles listed.
export default function AboutPage() {
  useSite((state) => state.siteImages);
  return <main id="main-content" className="ov-page ov-about">
    <section className="ov-about-intro">
      <Reveal className="ov-about-title">
        <h1>Considered clothing. Distinctive watches.</h1>
        <p>OLDVERGE is a small range for everyday wear: a quarter zip in four colours, and watches that suit a plain white shirt as well as a weekend. Your everyday signature.</p>
      </Reveal>
      <Reveal className="ov-about-photos" delay={0.08}>
        <Photo className="ov-about-photo is-tall" name="quarter-zip-soft-knit" alt="A dark knit sweater hanging on a hanger" eager />
        <Photo className="ov-about-photo is-wide" name="watch-seiko-sports" alt="A silver wristwatch with a link bracelet" eager />
      </Reveal>
    </section>

    <Reveal as="section" className="ov-about-statement">
      <h2>Two things, kept deliberately simple.</h2>
    </Reveal>

    <section className="ov-about-split">
      <Reveal className="ov-about-media"><Photo className="ov-about-photo" name="oldverge-hero-model" alt="A man wearing a grey-green quarter zip" /></Reveal>
      <Reveal className="ov-about-text" delay={0.08}>
        <h3>The quarter zip</h3>
        <p>One layer, in black, beige, navy and olive. It is the piece you reach for when the day starts cool and ends later than planned.</p>
        <h3>The watches</h3>
        <p>Digital, field, sport and dress styles at different price points, so there is something for the desk and something for the weekend.</p>
        <p className="ov-about-links"><Link to="/shop/quarter-zips">Shop quarter zips</Link><span aria-hidden="true">·</span><Link to="/shop/watches">Shop watches</Link></p>
      </Reveal>
    </section>
  </main>;
}
