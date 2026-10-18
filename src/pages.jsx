import { Link, useParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { getProducts } from './data/catalog.js';
import { collectionForCategory } from './data/collections.js';
import { imageSize } from './data/imageSizes.js';
import { siteImage, useSite } from './data/site.js';
import NewsletterForm from './components/NewsletterForm.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';
import HomeHero from './components/HomeHero.jsx';
import FeaturedCarousel from './components/FeaturedCarousel.jsx';
import ColorExplorer from './components/ColorExplorer.jsx';
import CollectionPage from './components/CollectionPage.jsx';
import Reveal from './components/Reveal.jsx';

const SiteImg = ({ name, ...rest }) => { const image = siteImage(name); return image ? <img src={image.src} alt={image.alt} {...imageSize(image.src)} {...rest} /> : null; };

export function HomePage() {
  useSite((state) => state.siteImages);         // re-render when the site images load
  // Quarter-zip colour links use the colour values already defined on the
  // quarter-zip products, and the product routes that already exist.
  const colors = ['Black', 'Beige', 'Navy', 'Olive'].map((name) => {
    const product = getProducts().find((item) => item.category === 'Quarter-Zips' && item.colors[0] === name);
    return { name, hex: product?.artColor, slug: product?.slug };
  }).filter((color) => color.slug);
  return <main id="main-content" className="ov-home">
    <HomeHero />
    <FeaturedCarousel />
    {colors.length > 0 && <ColorExplorer colors={colors} />}
    <section className="ov-category-section">
      <Reveal className="ov-section-heading"><div><h2>Two essentials.<br /><em>One point of view.</em></h2></div></Reveal>
      <Reveal className="ov-category-grid" delay={0.1}>
        <Link to="/shop/watches" className="ov-category-card ov-watch-card"><SiteImg name="oldverge-watch-editorial" loading="lazy" /><span className="ov-category-index">01 / WATCHES</span><div><h3>Time,<br />considered.</h3><span>Explore the collection <ArrowRight size={15} /></span></div></Link>
        <Link to="/shop/quarter-zips" className="ov-category-card ov-zip-card"><SiteImg name="oldverge-hero-model" loading="lazy" /><span className="ov-category-index">02 / CLOTHES</span><div><h3>The layer<br />you reach for.</h3><span>Find your colour <ArrowRight size={15} /></span></div></Link>
      </Reveal>
    </section>
    <section className="ov-story" aria-label="Our story">
      <Reveal className="ov-story-media">
        <Link to="/about" aria-label="Our story: read more"><SiteImg name="quarter-zip-soft-knit-cutout" loading="lazy" decoding="async" /></Link>
      </Reveal>
      <Reveal className="ov-story-copy" delay={0.1}>
        <span className="ov-story-eyebrow">OUR STORY</span>
        <p className="ov-story-statement">A small range for everyday wear. A quarter zip in four colours, and watches that suit a plain white shirt as well as a weekend.</p>
        <p className="ov-story-sign">Considered clothing. Distinctive watches. Your everyday signature.</p>
        <Link to="/about" className="ov-story-link">Read our story <ArrowRight size={15} aria-hidden="true" /></Link>
      </Reveal>
    </section>
    <NewsletterForm />
  </main>;
}

export function ShopPage() {
  const { category } = useParams();
  const collection = collectionForCategory(category);
  if (!collection) return <NotFoundPage what="collection" />;
  return <CollectionPage collection={collection} />;
}
