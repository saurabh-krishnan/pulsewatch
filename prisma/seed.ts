/**
 * Seed script (guide Phase 1 step 5, expanded in Phase 4 step 8).
 *
 * Phase 1: an admin user, 3 services, 1 monitor each.
 * Phase 4: 20-30 realistic past incidents with repeats, so incident memory has
 * something to find.
 *
 * Run with: npm run db:seed
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('[seed] nothing to seed yet — filled in during Phase 1.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
