import { Link, useNavigate } from 'react-router-dom';
import { ShoppingBag, Trash2, X } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import { amountToFreeShipping, computeTotals, FREE_SHIPPING_THRESHOLD, formatPrice } from '../lib/money.js';
import { imageSize } from '../data/imageSizes.js';
import { cartCount, resolveLines, useStore } from '../store.js';
import { useScrollLock } from '../lib/scrollLock.js';
import { useDialogFocus } from '../lib/useDialogFocus.js';
import { isBackend } from '../lib/config.js';
import { useCatalog } from '../data/catalog.js';
import { orderingOpen, useSite } from '../data/site.js';
import { QuantityControl } from './ui.jsx';

export const optionText = (line) => [line.color, line.product.sizes.length > 1 ? `Size ${line.size}` : ''].filter(Boolean).join(' · ');

export function ShippingProgress({ subtotal }) {
  if (isBackend || subtotal <= 0) return null;       // the free-delivery bar is a demo rule; real rates are quoted at checkout
  const remaining = amountToFreeShipping(subtotal);
  const percent = Math.min(100, Math.floor((subtotal / FREE_SHIPPING_THRESHOLD) * 100));
  return <div className="ov-ship-progress">
    <p>{remaining > 0 ? `Add ${formatPrice(remaining)} more for free standard delivery.` : 'You have free standard delivery.'}</p>
    <div className="ov-ship-bar" role="progressbar" aria-label="Progress to free delivery" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}><i style={{ width: `${percent}%` }} /></div>
    <small>Sample delivery rule for this demo.</small>
  </div>;
}

export function CartLine({ line, onNavigate, showBuyNow = false }) {
  const setQuantity = useStore((state) => state.setQuantity);
  const removeLine = useStore((state) => state.removeLine);
  const buyNowLine = useStore((state) => state.buyNowLine);
  const navigate = useNavigate();
  const { product } = line;
  return <li className="ov-line">
    <Link to={`/product/${product.slug}`} className="ov-line-image" onClick={onNavigate} tabIndex={-1} aria-hidden="true">
      {product.image && <img src={product.image} alt="" {...imageSize(product.image)} loading="lazy" decoding="async" />}
    </Link>
    <div className="ov-line-info">
      <Link to={`/product/${product.slug}`} className="ov-line-name" onClick={onNavigate}>{product.name}</Link>
      <p className="ov-line-options">{optionText(line)}</p>
      <p className="ov-line-unit">{formatPrice(line.unitPrice)} each</p>
      <div className="ov-line-actions">
        <QuantityControl compact value={line.quantity} label={`Quantity for ${product.name}`} onChange={(value) => setQuantity(line.key, value)} />
        <button type="button" className="ov-link-button" onClick={() => removeLine(line.key)}><Trash2 size={15} aria-hidden="true" /> Remove<span className="ov-sr-only"> {product.name}</span></button>
        {showBuyNow && <button type="button" className="ov-link-button" onClick={() => { if (buyNowLine(line.key).ok) navigate('/checkout?mode=buy-now'); }}>Buy now<span className="ov-sr-only"> {product.name}</span></button>}
      </div>
    </div>
    <strong className="ov-line-total">{formatPrice(line.lineTotal)}</strong>
  </li>;
}

/** Why the bag changed (items removed after checking the current catalogue) and catalogue loading/error states. */
export function CartStatus() {
  const notice = useStore((state) => state.cartNotice);
  const dismiss = useStore((state) => state.dismissCartNotice);
  const status = useCatalog((state) => state.status);
  const load = useCatalog((state) => state.load);
  return <>
    {notice && <p className="ov-cart-notice" role="status">{notice} <button type="button" className="ov-link-button" onClick={dismiss}>Dismiss</button></p>}
    {isBackend && status === 'error' && <p className="ov-form-error" role="alert">We could not load current prices and availability. <button type="button" className="ov-link-button" onClick={() => load({ force: true })}>Try again</button></p>}
  </>;
}

export default function CartDrawer() {
  useSite((state) => state.settings);
  const catalogStatus = useCatalog((state) => state.status);
  const open = useStore((state) => state.cartOpen);
  const close = useStore((state) => state.closeCart);
  const cart = useStore((state) => state.cart);
  const reduced = useReducedMotion();
  const lines = resolveLines(cart);
  const { subtotal } = computeTotals(lines);
  useDialogFocus(open, close);
  useScrollLock(open, 'cart-drawer');
  if (!open) return null;
  return <div className={`overlay drawer-overlay ${reduced ? 'is-static' : ''}`} onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <aside className="ov-drawer" data-lenis-prevent role="dialog" aria-modal="true" aria-labelledby="ov-cart-title">
      <div className="ov-drawer-head"><h2 id="ov-cart-title">Your cart <span>({cartCount(lines)})</span></h2><button type="button" className="ov-icon-close" aria-label="Close cart" onClick={close}><X size={22} aria-hidden="true" /></button></div>
      <CartStatus />
      {isBackend && catalogStatus !== 'ready' && catalogStatus !== 'error' ? <p className="ov-note" role="status">Loading your bag…</p> : lines.length ? <>
        <ShippingProgress subtotal={subtotal} />
        <ul className="ov-lines">{lines.map((line) => <CartLine key={line.key} line={line} onNavigate={close} />)}</ul>
        <div className="ov-drawer-foot">
          <div className="ov-row"><span>Subtotal</span><strong>{formatPrice(subtotal)}</strong></div>
          <p className="ov-note">{isBackend ? 'Delivery is added at checkout. Taxes are not calculated.' : 'Delivery is added at checkout. Taxes are not calculated in this demo.'}</p>
          <Link to="/cart" className="ov-button ov-button-light" onClick={close}>View cart</Link>
          {isBackend && !orderingOpen()
            ? <button type="button" className="ov-button ov-button-dark" disabled>Orders are not open yet</button>
            : <Link to="/checkout" className="ov-button ov-button-dark" onClick={close}>Checkout</Link>}
        </div>
      </> : <div className="ov-drawer-empty">
        <ShoppingBag size={36} aria-hidden="true" />
        <h3>Your cart is empty.</h3>
        <p>Add a watch or a quarter zip and it will appear here.</p>
        <Link to="/shop" className="ov-button ov-button-dark" onClick={close}>Shop all</Link>
      </div>}
    </aside>
  </div>;
}
