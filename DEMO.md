# The 2-minute demo

A script for the demo video and for interviews (guide section 13), written for the deployed
site. Rehearsed against the production build: breaking the demo target opened an incident
56 seconds later, recognized from three identical past incidents.

**Before recording:** sign in as `admin@pulsewatch.local` in one tab, have the public
`/status` page in another, and make sure the demo target is **Healthy**. If you set
`DISCORD_WEBHOOK_URL`, keep Discord open on your phone.

## 1. The dashboard — 15 seconds

> "Everything's green. This is PulseWatch watching three services. Up top: mean time to
> resolve, mean time to acknowledge, and the repeat rate — over 80% of incidents here were
> a problem that had happened before. That number is why this project exists."

## 2. Break it — 20 seconds

Press **Failing** in the *Demo target* panel on the dashboard.

> "I've just made the payments service return 503s. PulseWatch doesn't page anyone on one
> failure — it checks every 30 seconds and waits for two in a row, so a blip at 3 a.m.
> doesn't wake anybody up."

The incident takes about a minute to open. Fill the wait: open **Services → payments-api**
and point at the response-time chart and the status badge, or show the public status page.

## 3. The incident appears — 20 seconds

Open **Incidents**, then the new *payments-api health check failing*.

> "The worker saw two failures, marked the monitor down, and opened this incident on its
> own. Everything in the timeline was written by the system — including the alert." (Show
> the Discord notification if you configured one.)

## 4. The key moment — 30 seconds

Scroll to **Seen before**.

> "Here's the part I built this for. PulseWatch normalized the error message — stripped out
> the variable parts — and fingerprinted it. It has seen this exact failure three times
> before. Each match says *why* it matched: same fingerprint, same service, same error type.
> No AI model — every match is explainable. And across those incidents, *Scale out replicas*
> fixed it 3 out of 3 times. That 80% is Laplace-smoothed, so a runbook that got lucky once
> can't outrank one with a real track record."

## 5. Resolve it — 15 seconds

Press **Healthy** in the demo panel. Back on the incident: **Acknowledge**, then **Resolve**,
mark *Scale out replicas* as **worked**, and resolve.

> "Recording what worked is what feeds the next suggestion — the system gets better every
> time someone resolves something."

(Left alone, the monitor also recovers after two good checks and resolves the incident by
itself.)

## 6. Status page and postmortem — 20 seconds

Show the public **status page** — 90 days of uptime, no login — then back on the incident,
**Postmortem → Generate from timeline**.

> "Customers see this status page. And the postmortem is drafted from the timeline:
> duration, who acknowledged, which runbook worked. Root cause is left blank on purpose —
> that's a human's job."

---

## If an interviewer asks you to go deeper

- **"What happens between the URL failing and the alert?"** The worker claims due monitors
  with `FOR UPDATE SKIP LOCKED`, checks them, feeds each result into a pure state machine,
  and on the transition into DOWN opens the incident and its first timeline entry in one
  transaction. A partial unique index guarantees one active incident per monitor.
- **"How do you stop users making your server attack its own network?"** Show
  `packages/shared/src/ssrf.ts` and the three layers in DECISIONS.md.
- **"How do you know your tests test anything?"** Every security fix was reverted to confirm
  its test fails — see *Phase 7* in DECISIONS.md.
