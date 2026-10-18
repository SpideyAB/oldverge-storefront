import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Search, X } from 'lucide-react';
import { COLLECTIONS } from '../data/collections.js';
import { getProducts } from '../data/catalog.js';
import { formatPrice } from '../lib/money.js';
import { imageSize } from '../data/imageSizes.js';
import { searchProducts } from '../lib/search.js';
import { useScrollLock } from '../lib/scrollLock.js';
import { useDialogFocus } from '../lib/useDialogFocus.js';
import { useStore } from '../store.js';

/** Header search dialog. Results are real links, so arrow keys are not needed: Tab moves through them, Enter opens the full results page. */
export default function SearchPanel({ open, onClose }) {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const rememberSearch = useStore((state) => state.rememberSearch);
  const recent = useStore((state) => state.recentSearches);
  useDialogFocus(open, onClose);
  useScrollLock(open, 'search-panel');
  useEffect(() => { if (open) { setQuery(''); window.setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);
  if (!open) return null;
  const trimmed = query.trim();
  const matches = trimmed ? searchProducts(trimmed).slice(0, 5) : [];
  const submit = (event) => {
    event.preventDefault();
    if (!trimmed) return;
    rememberSearch(trimmed);
    navigate(`/search?q=${encodeURIComponent(trimmed)}`);
    onClose();
  };
  return <div className="overlay search-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="ov-search-panel" data-lenis-prevent role="dialog" aria-modal="true" aria-label="Search products">
      <form className="ov-search-form" role="search" onSubmit={submit}>
        <Search size={20} aria-hidden="true" />
        <label className="ov-sr-only" htmlFor="ov-search-input">Search products</label>
        <input id="ov-search-input" ref={inputRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search watches and quarter zips" autoComplete="off" enterKeyHint="search" />
        <button type="submit" className="ov-button ov-button-dark">Search</button>
        <button type="button" className="ov-icon-close" aria-label="Close search" onClick={onClose}><X size={22} aria-hidden="true" /></button>
      </form>
      <div className="ov-search-body" aria-live="polite">
        {trimmed ? (matches.length
          ? <>
            <h2>{matches.length === 1 ? '1 match' : `Top matches`}</h2>
            <ul className="ov-search-results">{matches.map((product) => <li key={product.id}><Link to={`/product/${product.slug}`} onClick={() => { rememberSearch(trimmed); onClose(); }}>
              <img src={product.image} alt="" {...imageSize(product.image)} /><span>{product.name}<small>{product.style} · {product.colors[0]}</small></span><strong>{formatPrice(product.price)}</strong></Link></li>)}</ul>
            <Link className="ov-text-link" to={`/search?q=${encodeURIComponent(trimmed)}`} onClick={onClose}>See all results <ArrowRight size={16} aria-hidden="true" /></Link>
          </>
          : <p className="ov-search-none">No matches for “{trimmed}”. Try “watch”, “navy” or “quarter zip”.</p>)
          : <>
            {recent.length > 0 && <div className="ov-search-recent"><h2>Recent searches</h2><ul>{recent.map((term) => <li key={term}><button type="button" onClick={() => setQuery(term)}>{term}</button></li>)}</ul></div>}
            <h2>Browse</h2>
            <ul className="ov-search-links">
              <li><Link to={COLLECTIONS.watches.path} onClick={onClose}>Watches</Link></li>
              <li><Link to={COLLECTIONS['quarter-zips'].path} onClick={onClose}>Quarter zips</Link></li>
              <li><Link to={COLLECTIONS.all.path} onClick={onClose}>All products ({getProducts().length})</Link></li>
            </ul>
          </>}
      </div>
    </section>
  </div>;
}
