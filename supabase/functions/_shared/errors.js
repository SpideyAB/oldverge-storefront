// Maps database errors (ov_error:<code>) to HTTP responses. Only stable, non-sensitive codes are returned.

const STATUS = {
  ordering_closed: 403,
  forbidden: 403,
  owner_only: 403,
  invalid_request: 400,
  invalid_lines: 400,
  invalid_quantity: 400,
  invalid_field: 400,
  invalid_idempotency_key: 400,
  too_many_lines: 400,
  amount_too_large: 400,
  not_found: 404,
  variant_unavailable: 409,
  insufficient_stock: 409,
  shipping_unavailable: 409,
  payment_method_unavailable: 409,
  price_changed: 409,
  idempotency_conflict: 409,
  request_in_progress: 409,
  provenance_required: 400,
  invalid_transition: 409,
  not_publishable: 409,
  not_ready_to_sell: 409,
  below_reserved: 409,
  payment_not_settled: 409,
  refund_exceeds_total: 409,
  image_not_approved: 409,
  image_approval_via_function_only: 403,
};

export const dbErrorCode = (error) => {
  const match = /ov_error:([a-z_0-9]+)/.exec(error?.message || '');
  return match ? match[1] : null;
};

/** Returns { status, body } for a PostgREST/RPC error, never leaking internals. */
export function mapDbError(error, requestId) {
  const known = dbErrorCode(error);
  if (known && STATUS[known]) {
    const body = { error: known };
    if (error.details) {
      try {
        const details = JSON.parse(error.details);
        // Exact stock counts are never shown publicly: drop them from customer-facing errors.
        if (details && typeof details === 'object') delete details.available;
        body.details = details;
      } catch { /* detail was not JSON */ }
    }
    return { status: STATUS[known], body };
  }
  return { status: 500, body: { error: 'internal', request_id: requestId } };
}

/** Logs only the request id, a code and the SQLSTATE: never request bodies, addresses or tokens. */
export function logFailure(scope, requestId, error) {
  console.error(JSON.stringify({ scope, request_id: requestId, code: dbErrorCode(error) || 'unexpected', sqlstate: error?.code || null }));
}
