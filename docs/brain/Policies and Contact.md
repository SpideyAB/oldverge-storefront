<!-- SNAPSHOT exported from the canonical Obsidian brain (Downloads/oldv/brain). Do not edit here: edit the brain, then run `node scripts/export-brain.mjs`. -->
---
type: commerce
updated: 2026-10-18
---
# Policies and Contact

## Contact
- `src/data/siteInfo.js` holds contact details, **all null**. No email, phone, WhatsApp, Instagram, address or form service has been supplied.
- `ContactForm.jsx` posts JSON `{ firstName, lastName, email, phone, topics, message }` to `VITE_CONTACT_FORM_ENDPOINT` (name only). The endpoint is accepted **only if it is an https URL** (http allowed on localhost in dev). Success is reported only on a 2xx; the request times out after 15 s using `AbortController`.
- With no endpoint, the form is a labelled demo and says no message was sent. **Launch blocker.**

## Policies (published in `src/data/policies.js`, linked in footer)
Shipping Policy, Returns & Refunds, Privacy Policy, Terms & Conditions. Shipping and Returns say only that no orders are accepted yet. Never invent terms.

**Privacy text was corrected on 2026-10-18** to match the code: localStorage holds the bag, the Buy now item and recent searches; sessionStorage holds the intro flag, scroll positions, shop filters and the demo sign-in name/email/phone; there are no real accounts (demo sign-in only); the contact form, if connected, sends first name, last name, email, phone, topics and message; Google Fonts is the only third-party request. Re-check this text whenever storage or forms change.

## Information still needed from the owner
- **Shipping**: delivery areas, couriers, processing time, delivery charges or free threshold, cash on delivery, tracking, delayed/lost/damaged parcels.
- **Returns & Refunds**: return window, condition rules and exclusions (watches may differ), how to request, who pays return shipping, exchanges, refund method/timeline, wrong or damaged items.
- **Privacy**: responsible business name, privacy contact, analytics decision, form provider and retention.
- **Terms**: legal name and address, governing law, order/payment/cancellation terms, IP statement (some photos third-party), contact details.
- FAQ groups for Shipping, Returns and Product Care are omitted until these exist.

Related: [[Launch Blockers]] · [[Commerce Rules]] · [[Known Issues]]
