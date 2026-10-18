<!-- SNAPSHOT exported from the canonical Obsidian brain (Downloads/oldv/brain). Do not edit here: edit the brain, then run `node scripts/export-brain.mjs`. -->
---
type: project
updated: 2026-10-18
---
# Routes and URL state

## Main routes
`/` · `/shop` · `/shop/watches` · `/shop/quarter-zips` · `/product/:slug` · `/cart` · `/checkout` · `/order-confirmation` · `/search` · `/about` (Our Story) · `/faq` · `/contact` · `/account/*`

Support: `/pages/shipping` · `/pages/returns` · `/pages/track-order`

Policies: `/shipping` · `/refund-policy` · `/privacy-policy` · `/terms-and-conditions` (aliases `/shipping-policy`, `/returns`, `/privacy`, `/terms` redirect)

Shopify-style aliases redirect: `/collections/*`, `/products/*`, `/pages/about|faq|contact`, `/policies/*`. `/size-guide` redirects to `/faq#sizing`. `/wishlist` redirects to `/shop` (wishlist removed on purpose). Unknown `/shop/<x>` and unknown routes show the 404 page.

## Brands
`/shop/watches?brand=<id>`: ids `rolex`, `patek-philippe`, `cartier`, `franck-muller`, `best-win`, plus `casio`, `timex`, `seiko`, `citizen`, `orient`. Legacy `?brand=Casio` still works.

## Filter URL params
`brand`, `style`, `colour` (repeatable), `price_min`, `price_max`, `sort` (`price-asc`, `price-desc`; default featured). `sort=new` is not supported (no date data). Params that do not apply are ignored. The Filter drawer edits a draft and writes the URL on Apply. A facet is shown only if data can support it (`getFacets`); quarter-zip size and price filters are hidden.

The All/Watches/Clothes switcher restores each category's last query (sessionStorage `ov-shop-state`); a directly opened URL always wins.

## Contact gating
`/contact` + footer link are live only when `siteInfo.contact` has a channel or `VITE_CONTACT_FORM_ENDPOINT` is set. In dev it always shows with the form disabled. See [[Policies and Contact]].

Related: [[Architecture]] · [[Products]]
