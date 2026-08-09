#!/usr/bin/env bash
# Stripe checkout dry-run (test mode). Skips cleanly if STRIPE_SECRET_KEY unset.
set -euo pipefail

API="${SCOUT_API_BASE:-http://localhost:4444}"
API="${API%/}"

if [ -z "${STRIPE_SECRET_KEY:-}" ]; then
  echo "STRIPE_SKIPPED (set STRIPE_SECRET_KEY for checkout dry-run)"
  exit 0
fi

EMAIL="stripe$(date +%s)@example.com"
SIGNUP=$(curl -fsS -X POST "$API/api/dashboard/auth/signup" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"TestPass123!\",\"organization_name\":\"Stripe Org\",\"name\":\"Stripe\"}")
TOKEN=$(printf '%s' "$SIGNUP" | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")

CHECKOUT=$(curl -fsS -X POST "$API/api/billing/checkout" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"plan":"monitor","success_url":"https://console.labyrinthscout.com/dashboard/settings?upgraded=1","cancel_url":"https://console.labyrinthscout.com/dashboard/settings"}')

URL=$(printf '%s' "$CHECKOUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('url') or '')")
echo "checkout_url_prefix=${URL:0:40}"
case "$URL" in
  https://checkout.stripe.com*) echo "PASS stripe checkout session created" ;;
  *) echo "FAIL unexpected checkout url: $URL"; exit 1 ;;
esac

echo "Complete a test payment with Stripe CLI webhook forward to $API/webhooks/stripe, then GET /api/dashboard/org"
