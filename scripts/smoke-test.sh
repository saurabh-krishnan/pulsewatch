#!/usr/bin/env bash
# Post-deploy smoke test. Checks a running PulseWatch the way a visitor would.
#
#   BASE_URL=https://your-app.onrender.com ./scripts/smoke-test.sh
#
# CI runs it against the Docker stack; run it yourself after a real deploy.
# Optional: VIEWER_PASSWORD (defaults to the published demo one),
# ADMIN_PASSWORD (also checks the admin-only demo controls),
# EXPECT_WORKER=false (skip waiting for a monitor to be checked).
set -euo pipefail

BASE="${BASE_URL:-http://localhost:4000}"
VIEWER_PW="${VIEWER_PASSWORD:-pulsewatch123}"

pass() { printf '  ok    %s\n' "$*"; }
fail() { printf '  FAIL  %s\n' "$*"; exit 1; }
# JSON field extraction without depending on jq being installed.
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=($1)(JSON.parse(s));process.stdout.write(String(v??''))})"; }
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

echo "Smoke-testing $BASE"

# A free instance may be asleep; give it three minutes to wake.
for i in $(seq 1 90); do
  if curl -fsS "$BASE/api/health" 2>/dev/null | grep -q '"database":"up"'; then
    pass "API healthy, database up"
    break
  fi
  [ "$i" = 90 ] && fail "API did not become healthy within 3 minutes"
  sleep 2
done

curl -fsS "$BASE/" | grep -q 'id="root"' && pass "web app served at /" || fail "web app not served at /"
curl -fsS "$BASE/status" | grep -q 'id="root"' && pass "client-side route /status loads the app" || fail "/status did not load the app"
[ "$(status "$BASE/api/definitely-not-a-route")" = 404 ] && pass "unknown API route is a 404" || fail "unknown API route was not a 404"
curl -fsSI "$BASE/api/health" | grep -qi '^x-content-type-options: nosniff' && pass "security headers present" || fail "security headers missing"

services=$(curl -fsS "$BASE/api/public/status" | json 'j => j.services.length')
[ "$services" -ge 1 ] && pass "public status page lists $services service(s)" || fail "public status page is empty"

token=$(curl -fsS -H 'content-type: application/json' \
  -d "{\"email\":\"viewer@pulsewatch.local\",\"password\":\"$VIEWER_PW\"}" \
  "$BASE/api/auth/login" | json 'j => j.token')
[ -n "$token" ] && pass "viewer can log in" || fail "viewer login failed"
auth=(-H "Authorization: Bearer $token")

[ "$(status "${auth[@]}" "$BASE/api/incidents")" = 200 ] && pass "viewer can read incidents" || fail "viewer cannot read incidents"
[ "$(status "${auth[@]}" -H 'content-type: application/json' -d '{"name":"smoke"}' "$BASE/api/services")" = 403 ] \
  && pass "viewer cannot create a service" || fail "viewer was allowed to write"

if [ "${EXPECT_WORKER:-true}" = true ]; then
  for i in $(seq 1 60); do
    checked=$(curl -fsS "${auth[@]}" "$BASE/api/services" | json 'j => j.length' || echo 0)
    first=$(curl -fsS "${auth[@]}" "$BASE/api/services" | json 'j => j[0] && j[0].id' || true)
    if [ -n "$first" ] && curl -fsS "${auth[@]}" "$BASE/api/services/$first/monitors" \
      | json 'j => j.some(m => m.lastCheckedAt !== null)' | grep -q true; then
      pass "worker is checking monitors ($checked service(s))"
      break
    fi
    [ "$i" = 60 ] && fail "no monitor was checked within 2 minutes -- is the worker running?"
    sleep 2
  done
fi

if [ -n "${ADMIN_PASSWORD:-}" ]; then
  admin=$(curl -fsS -H 'content-type: application/json' \
    -d "{\"email\":\"admin@pulsewatch.local\",\"password\":\"$ADMIN_PASSWORD\"}" \
    "$BASE/api/auth/login" | json 'j => j.token')
  mode=$(curl -fsS -H "Authorization: Bearer $admin" "$BASE/api/demo" | json 'j => j.mode')
  [ -n "$mode" ] && pass "admin demo controls reach the demo target (mode: $mode)" || fail "demo controls"
fi

echo "All smoke checks passed."
