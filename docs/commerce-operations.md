# Commerce operations

## Opening and closing orders
`ordering_enabled` is **false** by default. Only an owner can turn it on, from Admin > Settings (`admin_set_ordering_enabled`), and only when the readiness check passes. It checks: at least one enabled payment method; at least one enabled delivery method with a rate; at least one published, ready-to-sell product with a price and confirmed stock; at least one public contact channel; all four policies published **by an admin** (seeded placeholder text does not count). Turning it off is always allowed. Direct edits of the setting are blocked by a trigger.

Before launch the owner must supply: confirmed prices, SKUs and stock; correct licensed photographs; delivery areas, charges and terms; a payment decision (COD and/or an online provider); business contact details; approved shipping/returns/privacy/terms text; the notification sender; data-retention decisions. None of these have been invented.

## Daily routine
1. **Dashboard**: new orders, orders needing attention, unread messages, failed notifications, low stock.
2. **Orders**: open an order, check items/address/payment. COD: mark processing, record the courier and tracking number (a **manual record**; no courier API exists), mark delivered, then "record cash received".
3. **Cancellations**: Cancel with a reason. Reserved stock is released / committed stock is restocked once. If the order was paid it is flagged "refund required".
4. **Returns and refunds**: open a return, approve/receive it, restock sellable items (once), request a refund record, and confirm it only after the money has actually been returned. A refund record alone changes nothing.
5. **Messages**: mark read/replied, add a private note. Messages are stored only; no email is sent.
6. **Notifications**: the outbox holds order and message notifications. With no email provider configured they stay pending (the worker reports `not_configured`). Review failed items on the Operations page.

## Reconciliation
- Orders with `needs_attention`: payment amount mismatch, or payment received after the items were released. Resolve manually (refund or reinstate) and clear the flag with a note.
- Weekly: compare confirmed refunds and cash-received records with your bank/courier statements; compare `inventory.on_hand` with a physical count (adjust with a reason).
- Revenue on the dashboard counts non-test, non-cancelled orders that are paid (or partly refunded) minus confirmed refunds. Unpaid COD orders are shown separately.

## Monitoring and limits
Check the Supabase dashboard for database size, storage and egress, function invocations and Auth email rate limits. Free-plan projects can pause after inactivity. `run_maintenance` also prunes rate-limit rows.

## Known limitations
No payment provider, courier or email provider is integrated (adapter boundaries exist and are disabled). Online payment methods are not offered by the storefront checkout until an adapter exists. Tax is not calculated. Guest orders are not automatically linked to a later account.
