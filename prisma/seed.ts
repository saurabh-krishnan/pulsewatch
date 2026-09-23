/**
 * Seed script (guide Phase 1 step 5 and Phase 4 step 8).
 *
 * Three users covering each role, three services with a monitor each, a set of
 * runbooks, and ~26 resolved historical incidents with deliberate repeats so
 * incident memory has something real to find.
 *
 * The repeats matter: the same underlying failure appears several times with
 * different IDs, IPs, ports and durations, which is exactly what normalization
 * has to see through. If fingerprinting is broken, this seed stops matching.
 *
 * Idempotent: re-running updates rather than duplicating.
 *
 * Run with: npm run db:seed
 */
import { PrismaClient } from '@prisma/client';
import { upsertFingerprint } from '@pulsewatch/shared/fingerprint';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const LOCAL_PASSWORD = 'pulsewatch123';
const DEMO_TARGET = process.env.DEMO_TARGET_URL ?? 'http://localhost:4100';

/**
 * Locally every account shares one password. On a public deployment that
 * would hand strangers the admin account, so there only the read-only viewer
 * has a published password; admin and engineer come from secrets, and the seed
 * refuses to run without them.
 */
function passwords() {
  const viewer = process.env.DEMO_VIEWER_PASSWORD || LOCAL_PASSWORD;
  const privileged = process.env.DEMO_ADMIN_PASSWORD || (IS_PRODUCTION ? '' : LOCAL_PASSWORD);
  if (!privileged) {
    throw new Error(
      'DEMO_ADMIN_PASSWORD must be set to seed in production: the admin and engineer ' +
        'accounts must not share the published viewer password.',
    );
  }
  if (IS_PRODUCTION && privileged === viewer) {
    throw new Error('DEMO_ADMIN_PASSWORD must differ from the public viewer password.');
  }
  return { viewer, privileged };
}

const USERS = [
  { name: 'Ada Admin', email: 'admin@pulsewatch.local', role: 'admin' },
  { name: 'Eli Engineer', email: 'engineer@pulsewatch.local', role: 'engineer' },
  { name: 'Vic Viewer', email: 'viewer@pulsewatch.local', role: 'viewer' },
] as const;

const SERVICES = [
  {
    name: 'payments-api',
    description: 'Handles card authorisation and settlement.',
    tags: ['critical', 'payments'],
    // Tuned for the live demo: a 30s interval and two strikes means breaking the
    // demo target opens an incident in about a minute, not three.
    monitor: {
      url: `${DEMO_TARGET}/health`,
      intervalSeconds: 30,
      timeoutMs: 5000,
      failureThreshold: 2,
    },
  },
  {
    name: 'auth-service',
    description: 'Issues and validates session tokens.',
    tags: ['critical', 'identity'],
    monitor: { url: `${DEMO_TARGET}/health`, intervalSeconds: 60, timeoutMs: 3000 },
  },
  {
    name: 'notifications',
    description: 'Sends transactional email and SMS.',
    tags: ['async'],
    monitor: { url: `${DEMO_TARGET}/health`, intervalSeconds: 120, timeoutMs: 8000 },
  },
];

const RUNBOOKS = [
  {
    key: 'restart-db-pool',
    title: 'Restart DB connection pool',
    serviceName: 'payments-api',
    bodyMd: `# Restart the DB connection pool

Use when the API is timing out on database calls but Postgres itself is healthy.

## Check first
- \`SELECT count(*) FROM pg_stat_activity;\` — near \`max_connections\`?
- Application logs showing \`connection pool exhausted\`

## Steps
1. Scale the deployment down to 0 replicas, then back up.
2. Watch the pool gauge return to baseline.
3. Confirm the health check goes green.

## If it does not help
The leak is in application code holding connections open. Escalate to the owning team.
`,
  },
  {
    key: 'scale-replicas',
    title: 'Scale out replicas',
    serviceName: null,
    bodyMd: `# Scale out replicas

Use when latency climbs under load but error rates stay low.

1. \`kubectl scale deploy/<service> --replicas=<n*2>\`
2. Watch p99 latency for five minutes.
3. Leave the new replica count in place until the traffic spike passes.
`,
  },
  {
    key: 'clear-redis',
    title: 'Clear and warm the Redis cache',
    serviceName: 'auth-service',
    bodyMd: `# Clear and warm the Redis cache

Use when token validation fails with connection errors to Redis.

1. Confirm Redis is reachable: \`redis-cli -h <host> ping\`
2. If it responds but returns stale data, \`FLUSHDB\` on the session database only.
3. Warm the cache by replaying the last 100 sessions.

> Never \`FLUSHALL\` — it drops rate-limit counters too.
`,
  },
  {
    key: 'rotate-provider',
    title: 'Fail over to the backup SMS provider',
    serviceName: 'notifications',
    bodyMd: `# Fail over to the backup SMS provider

Use when the upstream SMS provider returns 5xx for more than five minutes.

1. Set \`SMS_PROVIDER=backup\` and redeploy.
2. Re-queue anything that failed in the last 15 minutes.
3. Open a ticket with the primary provider.
`,
  },
  {
    key: 'expand-disk',
    title: 'Expand the data volume',
    serviceName: null,
    bodyMd: `# Expand the data volume

Use when a host crosses 90% disk usage.

1. Identify the largest directories: \`du -xh / | sort -rh | head -20\`
2. Rotate and compress logs older than 7 days.
3. If still above 80%, expand the volume and grow the filesystem.
`,
  },
];

/**
 * Historical incidents. `daysAgo` spreads them over the last three months, and
 * several share an underlying failure with different variable parts so the
 * fingerprint has to normalize them together.
 */
const HISTORY: {
  service: string;
  errorType: string;
  message: string;
  title: string;
  severity: string;
  daysAgo: number;
  durationMins: number;
  runbooks: { key: string; worked: boolean | null }[];
  note: string;
}[] = [
  // --- repeat family 1: DB pool exhaustion on payments-api (5 occurrences) ---
  {
    service: 'payments-api',
    errorType: 'DB_TIMEOUT',
    message: 'connection pool exhausted: 20/20 connections in use, waited 4200ms',
    title: 'payments-api database timeouts',
    severity: 'SEV2',
    daysAgo: 74,
    durationMins: 52,
    runbooks: [{ key: 'restart-db-pool', worked: true }],
    note: 'Restarted the pool; connections returned to baseline.',
  },
  {
    service: 'payments-api',
    errorType: 'DB_TIMEOUT',
    message: 'connection pool exhausted: 20/20 connections in use, waited 3100ms',
    title: 'payments-api database timeouts',
    severity: 'SEV2',
    daysAgo: 58,
    durationMins: 31,
    runbooks: [
      { key: 'scale-replicas', worked: false },
      { key: 'restart-db-pool', worked: true },
    ],
    note: 'Scaling out did nothing. Restarting the pool fixed it again.',
  },
  {
    service: 'payments-api',
    errorType: 'DB_TIMEOUT',
    message: 'connection pool exhausted: 50/50 connections in use, waited 900ms',
    title: 'payments-api database timeouts after pool resize',
    severity: 'SEV2',
    daysAgo: 41,
    durationMins: 25,
    runbooks: [{ key: 'restart-db-pool', worked: true }],
    note: 'Same failure even with a bigger pool. Leak suspected in the refund path.',
  },
  {
    service: 'payments-api',
    errorType: 'DB_TIMEOUT',
    message: 'connection pool exhausted: 50/50 connections in use, waited 7300ms',
    title: 'payments-api database timeouts',
    severity: 'SEV1',
    daysAgo: 19,
    durationMins: 68,
    runbooks: [
      { key: 'restart-db-pool', worked: false },
      { key: 'scale-replicas', worked: true },
    ],
    note: 'Pool restart bought ten minutes only; scaling out held until the leak fix shipped.',
  },
  {
    service: 'payments-api',
    errorType: 'DB_TIMEOUT',
    message: 'connection pool exhausted: 50/50 connections in use, waited 5100ms',
    title: 'payments-api database timeouts',
    severity: 'SEV2',
    daysAgo: 6,
    durationMins: 18,
    runbooks: [{ key: 'restart-db-pool', worked: true }],
    note: 'Restarted the pool. Leak fix is still in review.',
  },

  // --- repeat family 2: DB timeout connecting to Postgres (4 occurrences) ---
  {
    service: 'payments-api',
    errorType: 'TIMEOUT',
    message:
      '2026-07-14T09:12:04Z ERROR Timeout after 5000ms connecting to 10.0.3.17:5432 (request 8f14e45f-ceea-467f-a4a0-3b2f1c6a9d10)',
    title: 'payments-api cannot reach the primary database',
    severity: 'SEV1',
    daysAgo: 70,
    durationMins: 44,
    runbooks: [{ key: 'restart-db-pool', worked: false }],
    note: 'Primary failed over to the replica. Nothing application-side helped.',
  },
  {
    service: 'payments-api',
    errorType: 'TIMEOUT',
    message:
      '2026-08-02T23:40:55Z ERROR Timeout after 3000ms connecting to 10.0.3.22:5432 (request 1b4e28ba-2fa1-11d2-883f-0016d3cca427)',
    title: 'payments-api cannot reach the primary database',
    severity: 'SEV1',
    daysAgo: 51,
    durationMins: 36,
    runbooks: [],
    note: 'Network partition in the database subnet, resolved by the platform team.',
  },
  {
    service: 'payments-api',
    errorType: 'TIMEOUT',
    message:
      '2026-08-29T04:02:11Z ERROR Timeout after 5000ms connecting to 10.0.4.9:5432 (request 3fa85f64-5717-4562-b3fc-2c963f66afa6)',
    title: 'payments-api cannot reach the primary database',
    severity: 'SEV2',
    daysAgo: 24,
    durationMins: 22,
    runbooks: [],
    note: 'Failed over cleanly this time.',
  },
  {
    service: 'auth-service',
    errorType: 'TIMEOUT',
    message:
      '2026-09-05T11:30:00Z ERROR Timeout after 3000ms connecting to 10.0.3.17:5432 (request 7c9e6679-7425-40de-944b-e07fc1f90ae7)',
    title: 'auth-service database timeouts',
    severity: 'SEV2',
    daysAgo: 17,
    durationMins: 29,
    runbooks: [{ key: 'restart-db-pool', worked: true }],
    note: 'Same shape as the payments-api outages. Shared database host.',
  },

  // --- repeat family 3: Redis refused on auth-service (3 occurrences) ---
  {
    service: 'auth-service',
    errorType: 'CONNECTION_REFUSED',
    message: 'ECONNREFUSED 10.0.2.44:6379',
    title: 'auth-service cannot reach Redis',
    severity: 'SEV1',
    daysAgo: 63,
    durationMins: 40,
    runbooks: [{ key: 'clear-redis', worked: true }],
    note: 'Redis had OOM-killed. Restarted and warmed the cache.',
  },
  {
    service: 'auth-service',
    errorType: 'CONNECTION_REFUSED',
    message: 'ECONNREFUSED 10.0.2.51:6379',
    title: 'auth-service cannot reach Redis',
    severity: 'SEV2',
    daysAgo: 35,
    durationMins: 15,
    runbooks: [{ key: 'clear-redis', worked: true }],
    note: 'Same again after a node replacement.',
  },
  {
    service: 'auth-service',
    errorType: 'CONNECTION_REFUSED',
    message: 'ECONNREFUSED 10.0.2.51:6379',
    title: 'auth-service cannot reach Redis',
    severity: 'SEV2',
    daysAgo: 11,
    durationMins: 12,
    runbooks: [
      { key: 'clear-redis', worked: true },
      { key: 'scale-replicas', worked: null },
    ],
    note: 'Memory limit raised so it should stop recurring.',
  },

  // --- repeat family 4: upstream SMS 5xx on notifications (3 occurrences) ---
  {
    service: 'notifications',
    errorType: 'HTTP_5XX',
    message: 'upstream sms-provider returned 502 for https://sms.example.com/send?id=8812',
    title: 'notifications: SMS provider failing',
    severity: 'SEV3',
    daysAgo: 66,
    durationMins: 95,
    runbooks: [{ key: 'rotate-provider', worked: true }],
    note: 'Failed over to the backup provider.',
  },
  {
    service: 'notifications',
    errorType: 'HTTP_5XX',
    message: 'upstream sms-provider returned 502 for https://sms.example.com/send?id=10457',
    title: 'notifications: SMS provider failing',
    severity: 'SEV3',
    daysAgo: 45,
    durationMins: 62,
    runbooks: [{ key: 'rotate-provider', worked: true }],
    note: 'Same provider, same failure. Backup handled the volume.',
  },
  {
    service: 'notifications',
    errorType: 'HTTP_5XX',
    message: 'upstream sms-provider returned 502 for https://sms.example.com/send?id=22190',
    title: 'notifications: SMS provider failing',
    severity: 'SEV2',
    daysAgo: 9,
    durationMins: 140,
    runbooks: [
      { key: 'rotate-provider', worked: true },
      { key: 'scale-replicas', worked: false },
    ],
    note: 'Longest one yet. Contract review raised with the provider.',
  },

  // --- repeat family 5: disk pressure (3 occurrences, different hosts) ---
  {
    service: 'notifications',
    errorType: 'DISK_PRESSURE',
    message: 'disk usage at 97% on /dev/sda1 for host worker-3',
    title: 'notifications worker running out of disk',
    severity: 'SEV3',
    daysAgo: 60,
    durationMins: 50,
    runbooks: [{ key: 'expand-disk', worked: true }],
    note: 'Rotated logs and expanded the volume.',
  },
  {
    service: 'notifications',
    errorType: 'DISK_PRESSURE',
    message: 'disk usage at 94% on /dev/sda1 for host worker-7',
    title: 'notifications worker running out of disk',
    severity: 'SEV4',
    daysAgo: 28,
    durationMins: 20,
    runbooks: [{ key: 'expand-disk', worked: true }],
    note: 'Caught early by the warning threshold.',
  },
  {
    service: 'auth-service',
    errorType: 'DISK_PRESSURE',
    message: 'disk usage at 91% on /dev/sdb1 for host auth-2',
    title: 'auth-service host running out of disk',
    severity: 'SEV4',
    daysAgo: 13,
    durationMins: 33,
    runbooks: [{ key: 'expand-disk', worked: true }],
    note: 'Audit logs were never being rotated.',
  },

  // --- one-offs, so not everything is a repeat ---
  {
    service: 'auth-service',
    errorType: 'JWT_ERROR',
    message: 'JWT verification failed: token expired at 2026-08-11T10:15:32Z for user 5521',
    title: 'auth-service rejecting valid sessions',
    severity: 'SEV1',
    daysAgo: 42,
    durationMins: 27,
    runbooks: [],
    note: 'Clock drift on one node. NTP resynced.',
  },
  {
    service: 'payments-api',
    errorType: 'TLS_ERROR',
    message: 'TLS error CERT_HAS_EXPIRED for payments.example.com:443',
    title: 'payments-api certificate expired',
    severity: 'SEV1',
    daysAgo: 38,
    durationMins: 71,
    runbooks: [],
    note: 'Certificate renewed. Expiry alerting added to the backlog.',
  },
  // --- repeat family 6: payments-api answering 503 (3 occurrences) ---
  // The message is exactly what the checker records when the demo target is
  // switched to `failing`, so breaking it on purpose -- the live demo -- lands
  // on this fingerprint and shows "seen before" with a proven fix.
  {
    service: 'payments-api',
    errorType: 'HTTP_5XX',
    message: 'HTTP 503 Service Unavailable',
    title: 'payments-api health check failing',
    severity: 'SEV2',
    daysAgo: 48,
    durationMins: 34,
    runbooks: [
      { key: 'restart-db-pool', worked: false },
      { key: 'scale-replicas', worked: true },
    ],
    note: 'Pool restart did nothing; the instances were saturated. Scaled out.',
  },
  {
    service: 'payments-api',
    errorType: 'HTTP_5XX',
    message: 'HTTP 503 Service Unavailable',
    title: 'payments-api health check failing',
    severity: 'SEV2',
    daysAgo: 33,
    durationMins: 18,
    runbooks: [{ key: 'scale-replicas', worked: true }],
    note: 'Traffic spike from a marketing email. Scaled out.',
  },
  {
    service: 'payments-api',
    errorType: 'HTTP_5XX',
    message: 'HTTP 503 Service Unavailable',
    title: 'payments-api health check failing',
    severity: 'SEV3',
    daysAgo: 15,
    durationMins: 11,
    runbooks: [{ key: 'scale-replicas', worked: true }],
    note: 'Same cause, caught faster.',
  },
  {
    service: 'notifications',
    errorType: 'QUEUE_BACKLOG',
    message: 'email queue depth 48210 exceeds threshold 10000',
    title: 'notifications email backlog',
    severity: 'SEV3',
    daysAgo: 30,
    durationMins: 120,
    runbooks: [{ key: 'scale-replicas', worked: true }],
    note: 'Doubled consumers until the backlog drained.',
  },
  {
    service: 'notifications',
    errorType: 'QUEUE_BACKLOG',
    message: 'email queue depth 22740 exceeds threshold 10000',
    title: 'notifications email backlog',
    severity: 'SEV4',
    daysAgo: 4,
    durationMins: 45,
    runbooks: [{ key: 'scale-replicas', worked: true }],
    note: 'Routine month-end statement run.',
  },
  {
    service: 'auth-service',
    errorType: 'DNS_FAILURE',
    message: 'DNS lookup failed for idp.partner.example.com (ENOTFOUND)',
    title: 'auth-service cannot resolve the partner IdP',
    severity: 'SEV2',
    daysAgo: 22,
    durationMins: 39,
    runbooks: [],
    note: 'Partner DNS outage. Nothing to do on our side.',
  },
  {
    service: 'payments-api',
    errorType: 'HTTP_4XX',
    message: 'HTTP 429 Too Many Requests from https://gateway.example.com/authorize',
    title: 'payments-api rate limited by the card gateway',
    severity: 'SEV2',
    daysAgo: 8,
    durationMins: 55,
    runbooks: [{ key: 'scale-replicas', worked: false }],
    note: 'Scaling made it worse. Added client-side backoff instead.',
  },
];

function at(daysAgo: number, plusMinutes = 0): Date {
  return new Date(Date.now() - daysAgo * 86_400_000 + plusMinutes * 60_000);
}

/** Deterministic pseudo-random, so re-seeding produces the same status page. */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

/**
 * 90 days of uptime_daily rows per monitor (guide Phase 6 step 3).
 *
 * The worker's hourly rollup only ever sees data from the day it runs, so a
 * fresh install has an empty status page. This backfills a plausible history,
 * with the dips lined up against the seeded incidents so the page and the
 * incident list tell the same story.
 */
async function seedUptimeHistory(
  monitors: { id: number; serviceName: string; intervalSeconds: number }[],
) {
  const outageDaysByService = new Map<string, Map<number, number>>();
  for (const h of HISTORY) {
    const map = outageDaysByService.get(h.service) ?? new Map<number, number>();
    map.set(h.daysAgo, (map.get(h.daysAgo) ?? 0) + h.durationMins);
    outageDaysByService.set(h.service, map);
  }

  const rows: {
    monitorId: number;
    day: Date;
    total: number;
    successful: number;
    avgResponseMs: number;
  }[] = [];

  for (const monitor of monitors) {
    const rand = seededRandom(monitor.id * 7919);
    const perDay = Math.floor(86_400 / monitor.intervalSeconds);
    const outages = outageDaysByService.get(monitor.serviceName) ?? new Map<number, number>();

    for (let daysAgo = 89; daysAgo >= 0; daysAgo--) {
      const day = new Date(Date.now() - daysAgo * 86_400_000);
      day.setUTCHours(0, 0, 0, 0);

      // Today is only partly elapsed.
      const elapsed = daysAgo === 0 ? Math.max(1, Math.floor(perDay * 0.4)) : perDay;

      const outageMins = outages.get(daysAgo) ?? 0;
      const failed = outageMins
        ? Math.min(elapsed, Math.ceil((outageMins * 60) / monitor.intervalSeconds))
        : rand() < 0.08
          ? Math.floor(rand() * 3) // the occasional blip on a normal day
          : 0;

      rows.push({
        monitorId: monitor.id,
        day,
        total: elapsed,
        successful: elapsed - failed,
        avgResponseMs: 40 + Math.floor(rand() * 90) + (outageMins ? 300 : 0),
      });
    }
  }

  // One statement rather than 270 round trips.
  await prisma.uptimeDaily.createMany({ data: rows, skipDuplicates: true });
  return rows.length;
}

async function main() {
  const pw = passwords();
  const viewerHash = await bcrypt.hash(pw.viewer, 10);
  const privilegedHash = await bcrypt.hash(pw.privileged, 10);

  const users = [];
  for (const u of USERS) {
    const passwordHash = u.role === 'viewer' ? viewerHash : privilegedHash;
    users.push(
      await prisma.user.upsert({
        where: { email: u.email },
        // Re-applying the hash means rotating DEMO_ADMIN_PASSWORD and
        // redeploying is enough to change the password.
        update: { name: u.name, role: u.role, passwordHash },
        create: { ...u, passwordHash },
      }),
    );
  }
  const [admin, engineer] = users;
  console.log(
    IS_PRODUCTION
      ? `[seed] ${users.length} users (viewer password is the published one; admin/engineer from DEMO_ADMIN_PASSWORD)`
      : `[seed] ${users.length} users (password for all: ${LOCAL_PASSWORD})`,
  );

  const serviceIds = new Map<string, number>();
  const monitorsForHistory: { id: number; serviceName: string; intervalSeconds: number }[] = [];
  for (const s of SERVICES) {
    const service = await prisma.service.upsert({
      where: { name: s.name },
      update: { description: s.description, tags: s.tags, ownerId: admin!.id },
      create: {
        name: s.name,
        description: s.description,
        tags: s.tags,
        isPublic: true,
        ownerId: admin!.id,
      },
    });
    serviceIds.set(s.name, service.id);

    const existing = await prisma.monitor.findFirst({ where: { serviceId: service.id } });
    const monitor = existing
      ? await prisma.monitor.update({ where: { id: existing.id }, data: s.monitor })
      : await prisma.monitor.create({ data: { serviceId: service.id, ...s.monitor } });
    monitorsForHistory.push({
      id: monitor.id,
      serviceName: s.name,
      intervalSeconds: s.monitor.intervalSeconds,
    });
  }
  console.log(`[seed] ${SERVICES.length} services, each with one monitor`);

  const uptimeRows = await seedUptimeHistory(monitorsForHistory);
  console.log(`[seed] ${uptimeRows} uptime_daily rows (90 days x ${SERVICES.length} monitors)`);

  const runbookIds = new Map<string, number>();
  for (const rb of RUNBOOKS) {
    const serviceId = rb.serviceName ? (serviceIds.get(rb.serviceName) ?? null) : null;
    const existing = await prisma.runbook.findFirst({ where: { title: rb.title } });
    const saved = existing
      ? await prisma.runbook.update({
          where: { id: existing.id },
          data: { bodyMd: rb.bodyMd, serviceId, updatedBy: engineer!.id },
        })
      : await prisma.runbook.create({
          data: { title: rb.title, bodyMd: rb.bodyMd, serviceId, updatedBy: engineer!.id },
        });
    runbookIds.set(rb.key, saved.id);
  }
  console.log(`[seed] ${RUNBOOKS.length} runbooks`);

  // Historical incidents are only seeded once; re-running leaves them alone.
  const alreadySeeded = await prisma.incident.count({ where: { source: 'api' } });
  if (alreadySeeded > 0) {
    console.log(`[seed] ${alreadySeeded} historical incidents already present, skipping`);
    return;
  }

  let fingerprintReuse = 0;
  for (const h of HISTORY) {
    const serviceId = serviceIds.get(h.service)!;
    const fp = await upsertFingerprint(prisma, h.errorType, h.message);
    if (fp.occurrences > 1) fingerprintReuse++;

    const openedAt = at(h.daysAgo);
    const acknowledgedAt = at(h.daysAgo, Math.min(6, h.durationMins));
    const resolvedAt = at(h.daysAgo, h.durationMins);

    const incident = await prisma.incident.create({
      data: {
        serviceId,
        fingerprintId: fp.id,
        title: h.title,
        description: `Reported by monitoring.\nError: ${h.message}`,
        errorType: h.errorType,
        severity: h.severity,
        status: 'resolved',
        // 'api' marks these as seeded history, which also makes them easy to find.
        source: 'api',
        tags: [],
        openedAt,
        acknowledgedAt,
        resolvedAt,
        resolutionNote: h.note,
      },
    });

    await prisma.incidentEvent.createMany({
      data: [
        {
          incidentId: incident.id,
          userId: null,
          type: 'opened',
          message: `Detected: ${h.message}`,
          createdAt: openedAt,
        },
        {
          incidentId: incident.id,
          userId: engineer!.id,
          type: 'acknowledged',
          message: null,
          createdAt: acknowledgedAt,
        },
      ],
    });

    for (const r of h.runbooks) {
      const runbookId = runbookIds.get(r.key)!;
      await prisma.incidentRunbook.create({
        data: { incidentId: incident.id, runbookId, worked: r.worked },
      });
      await prisma.incidentEvent.create({
        data: {
          incidentId: incident.id,
          userId: engineer!.id,
          type: 'runbook_used',
          message: `${RUNBOOKS.find((x) => x.key === r.key)!.title} — ${
            r.worked === true ? 'fixed it' : r.worked === false ? 'did not help' : 'tried'
          }`,
          createdAt: at(h.daysAgo, Math.max(1, h.durationMins - 5)),
        },
      });
    }

    await prisma.incidentEvent.create({
      data: {
        incidentId: incident.id,
        userId: engineer!.id,
        type: 'resolved',
        message: h.note,
        createdAt: resolvedAt,
      },
    });
  }

  const distinct = await prisma.fingerprint.count();
  console.log(
    `[seed] ${HISTORY.length} historical incidents across ${distinct} distinct fingerprints ` +
      `(${fingerprintReuse} were repeats of an earlier one)`,
  );
  console.log(`[seed] monitors point at ${DEMO_TARGET}/health`);
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
