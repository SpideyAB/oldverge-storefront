<!-- SNAPSHOT exported from the canonical Obsidian brain (Downloads/oldv/brain). Do not edit here: edit the brain, then run `node scripts/export-brain.mjs`. -->
---
type: commerce
updated: 2026-10-18
---
# Commerce Rules

- **Never invent** products, prices, reviews, stock, discounts, delivery terms or payment methods.
- Footer notice on every page: **"Displayed prices are samples. Orders are not open yet."** Do not repeat it across pages; keep short statements only next to the action they explain (product page, bag, checkout).
- Checkout is a **demo**: collects contact and address only to show the confirmation; nothing stored or sent; **no card fields** until a real provider exists. Never claim an email or message was sent.
- Never label a photo as a brand it does not show. Requested brands without verified photos/model data stay as empty collections ([[Products]]).
- Stock is unknown: nothing is sold out unless a product has `soldOut` or `unavailableSizes`. No stock/availability filters without real data.
- Never add discount codes or promotions. Wishlist/Save-for-later removed on purpose.
- Never print or commit secrets. Env vars: document names only (`VITE_CONTACT_FORM_ENDPOINT` is the only one referenced).
- No backend work until the owner asks ([[Decision Log]]).

Related: [[Checkout and Cart]] · [[Policies and Contact]] · [[Launch Blockers]]
