/**
 * Seed script (guide Phase 1 step 5).
 *
 * An admin, an engineer and a read-only viewer, three services, one monitor each.
 * Phase 4 extends this with 20-30 past incidents so incident memory has data.
 *
 * Idempotent: re-running updates rather than duplicating.
 *
 * Run with: npm run db:seed
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'pulsewatch123';
const DEMO_TARGET = process.env.DEMO_TARGET_URL ?? 'http://localhost:4100';

const USERS = [
  { name: 'Ada Admin', email: 'admin@pulsewatch.local', role: 'admin' },
  { name: 'Eli Engineer', email: 'engineer@pulsewatch.local', role: 'engineer' },
  { name: 'Vic Viewer', email: 'viewer@pulsewatch.local', role: 'viewer' },
];

const SERVICES = [
  {
    name: 'payments-api',
    description: 'Handles card authorisation and settlement.',
    tags: ['critical', 'payments'],
    monitor: { url: `${DEMO_TARGET}/health`, intervalSeconds: 60, timeoutMs: 5000 },
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

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const users = [];
  for (const u of USERS) {
    users.push(
      await prisma.user.upsert({
        where: { email: u.email },
        update: { name: u.name, role: u.role },
        create: { ...u, passwordHash },
      }),
    );
  }
  const admin = users[0]!;
  console.log(`[seed] ${users.length} users (password for all: ${DEMO_PASSWORD})`);

  for (const s of SERVICES) {
    const service = await prisma.service.upsert({
      where: { name: s.name },
      update: { description: s.description, tags: s.tags, ownerId: admin.id },
      create: {
        name: s.name,
        description: s.description,
        tags: s.tags,
        isPublic: true,
        ownerId: admin.id,
      },
    });

    const existing = await prisma.monitor.findFirst({ where: { serviceId: service.id } });
    if (existing) {
      await prisma.monitor.update({ where: { id: existing.id }, data: s.monitor });
    } else {
      await prisma.monitor.create({ data: { serviceId: service.id, ...s.monitor } });
    }
  }
  console.log(`[seed] ${SERVICES.length} services, each with one monitor`);
  console.log(`[seed] monitors point at ${DEMO_TARGET}/health`);
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
