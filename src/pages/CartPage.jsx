import { Link } from 'react-router-dom';
import { computeTotals, formatPrice } from '../lib/money.js';
import { resolveLines, useStore } from '../store.js';
import { CartLine, CartStatus, ShippingProgress } from '../components/CartDrawer.jsx';
import { isBackend } from '../lib/config.js';
import { orderingOpen, useSite } from '../data/site.js';
import { EmptyState, PageHead } from '../components/ui.jsx';

export default function CartPage() {
  useSite((state) => state.settings);
  const cart = useStore((state) => state.cart);
  const lines = resolveLines(cart);
  const { subtotal } = computeTotals(lines);
  return <main id="main-content" className="ov-page ov-cart">
    <PageHead title="Your cart" intro={lines.length ? `${lines.length} ${lines.length === 1 ? 'item' : 'items'} in your cart.` : undefined} />
    <CartStatus />
    {lines.length ? <div className="ov-cart-layout">
      <section aria-label="Cart items"><ul className="ov-lines">{lines.map((line) => <CartLine key={line.key} line={line} showBuyNow />)}</ul>
        <Link to="/shop" className="ov-text-link">Continue shopping</Link></section>
      <aside className="ov-summary" aria-label="Order summary">
        <h2>Order summary</h2>
        <ShippingProgress subtotal={subtotal} />
        <div className="ov-row"><span>Subtotal</span><strong>{formatPrice(subtotal)}</strong></div>
        <p className="ov-note">{isBackend ? 'Delivery is chosen at checkout. Taxes are not calculated.' : 'Delivery is chosen at checkout. Taxes are not calculated in this demo.'}</p>
        {isBackend && !orderingOpen()
          ? <><button type="button" className="ov-button ov-button-dark" disabled>Orders are not open yet</button><p className="ov-note">You can keep your bag. Checkout opens when the store starts taking orders.</p></>
          : <Link to="/checkout" className="ov-button ov-button-dark">Checkout</Link>}
        {!isBackend && <p className="ov-note">Demo checkout: no payment is taken and no order is created.</p>}
      </aside>
    </div> : <EmptyState title="Your cart is empty." actions={<><Link to="/shop" className="ov-button ov-button-dark">Shop all</Link><Link to="/shop/watches" className="ov-button ov-button-light">Watches</Link></>}>Browse the collection and add something you like.</EmptyState>}
  </main>;
}
