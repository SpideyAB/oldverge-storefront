import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getProducts } from '../data/catalog.js';
import { searchProducts } from '../lib/search.js';
import { SORTS, sortProducts } from '../lib/collectionFilters.js';
import { ProductCard } from '../components/Shell.jsx';
import { EmptyState, PageHead } from '../components/ui.jsx';

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') || '').trim();
  const sort = SORTS.some((option) => option.value === params.get('sort')) ? params.get('sort') : 'featured';
  const [draft, setDraft] = useState(q);
  useEffect(() => { setDraft(q); }, [q]);
  const results = sortProducts(q ? searchProducts(q) : [], sort);
  const update = (next) => {
    const merged = new URLSearchParams();
    if (next.q) merged.set('q', next.q);
    if (next.sort && next.sort !== 'featured') merged.set('sort', next.sort);
    setParams(merged);
  };
  return <main id="main-content" className="ov-page ov-search">
    <PageHead title={q ? `Search: ${q}` : 'Search'} />
    <form className="ov-inline-search" role="search" onSubmit={(event) => { event.preventDefault(); update({ q: draft.trim(), sort }); }}>
      <label htmlFor="ov-search-page-input">Search products</label>
      <div><input id="ov-search-page-input" type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Search watches and quarter zips" /><button type="submit" className="ov-button ov-button-dark">Search</button>{q && <Link to="/search" className="ov-button ov-button-light">Clear search</Link>}</div>
    </form>
    {q && <div className="ov-search-toolbar">
      <p aria-live="polite" role="status">{results.length} {results.length === 1 ? 'result' : 'results'} for “{q}”</p>
      {results.length > 1 && <label className="ov-sort">Sort by <select value={sort} onChange={(event) => update({ q, sort: event.target.value })}>{SORTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
    </div>}
    {q && results.length > 0 && <div className="ov-product-grid">{results.map((product) => <ProductCard key={product.id} product={product} />)}</div>}
    {q && results.length === 0 && <EmptyState title={`No results for “${q}”.`} actions={<><Link to="/shop/watches" className="ov-button ov-button-dark">Watches</Link><Link to="/shop/quarter-zips" className="ov-button ov-button-light">Quarter zips</Link></>}>Check the spelling, or try a broader word such as “watch”, “navy” or “black”.</EmptyState>}
    {!q && <section aria-labelledby="ov-suggest"><h2 id="ov-suggest">Featured products</h2><div className="ov-product-grid">{getProducts().slice(0, 4).map((product) => <ProductCard key={product.id} product={product} />)}</div></section>}
  </main>;
}
