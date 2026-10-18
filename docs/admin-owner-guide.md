# Admin owner guide

Everything below is done at `https://<your-domain>/admin`. It works only once the site is in backend mode (see `docs/supabase-setup.md`). Status: built and tested locally against a test database; **not yet tried on a hosted project**.

## First admin (one time, done by whoever controls the Supabase project)
1. Create your account normally at `/account/register` and confirm the email.
2. In the Supabase dashboard, open **Authentication > Users** and copy your user ID.
3. In the **SQL editor** run: `insert into private.admin_members (user_id, role) values ('<your-user-id>', 'owner');`
4. Sign in at `/admin`, open **Security** and turn on two-step sign-in.
Signing up never makes anyone an admin, and hiding the URL is not the protection: every admin action is checked in the database.

## Routine tasks
| Task | Where | Steps |
|---|---|---|
| Upload a photo | Products > product > Images | Choose a JPEG/PNG/WebP (SVG and HTML are refused). It lands in the private bucket as **unapproved**. Add alt text and source/licence, then **Approve** to publish it to the public bucket. Set the cover. |
| Save a draft | Products > New | Fill in name, slug, category, brand and description, then **Save**. Drafts are never visible on the site. |
| Add variants and price | product > Variants | One row per colour/size with a unique SKU and a price in whole PKR. |
| Enter verified stock | Inventory | Choose the variant and **Set** the counted quantity with a reason. Every change is kept in the history. Unknown stock means not for sale. |
| Publish | product > Publish | Allowed only when the readiness checklist passes (approved cover photo, active variant, price, confirmed stock). |
| Find an order | Orders | Search by order number, email or phone; filter by payment or fulfilment state. |
| Record dispatch / tracking | Orders > order > Ship | Enter the courier and tracking number. This **records** what you did with the courier; it does not book a courier. |
| Cancel | Orders > order > Cancel | Give a reason. Stock is released once. |
| Return / refund | Orders > order > Return | Record items, quantities and reason. Restock only items you confirm are sellable. A refund shows as refunded only after you confirm money was actually returned (manual record) or a provider confirms it. |
| Failed notifications | Operations | Lists outbox messages that failed or are pending. Retry after fixing the provider. Until an email provider is set up, nothing is emailed. |
| Shipping | Settings > Shipping | Zones, methods and rates. They stay inactive until you activate them. |
| Open ordering | Settings > Ordering | The switch refuses while the readiness list has gaps. Leave it off until you approve real selling. |
| Policies and contact | Policies | Edit the draft, then **Publish** (creates a new version). |
| Messages / newsletter | Messages, Newsletter | Mark handled, add a private note; view consent records. |
| Export | Exports | Bounded CSV (spreadsheet formulas are neutralised). The export is logged. |

**Recording vs doing:** the admin area records payments, refunds and shipments. It does not move money or book couriers until a provider is integrated.
