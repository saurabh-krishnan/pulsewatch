/**
 * Demonstrates that `FOR UPDATE SKIP LOCKED` lets PulseWatch run more than one
 * worker without ever checking the same monitor twice (guide 7.2).
 *
 * Client A claims rows inside an open transaction and keeps holding the locks
 * while client B, on a separate connection, runs the identical claim query.
 * B must return a disjoint set immediately rather than blocking.
 *
 * Run with: npm run verify:skip-locked
 */
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const a = new PrismaClient();
const b = new PrismaClient();

const CLAIM = `
  SELECT id FROM monitors
  WHERE status <> 'paused' AND next_check_at <= now()
  ORDER BY next_check_at
  LIMIT 50
  FOR UPDATE SKIP LOCKED
`;

async function main() {
  // Restore the real schedule afterwards, so this does not stampede the worker.
  const saved = await a.$queryRawUnsafe<{ id: number; next_check_at: Date }[]>(
    `SELECT id, next_check_at FROM monitors`,
  );

  try {
    await a.$executeRawUnsafe(`UPDATE monitors SET next_check_at = now()`);

    await a.$transaction(async (tx) => {
      const claimedByA = await tx.$queryRawUnsafe<{ id: number }[]>(CLAIM);
      console.log(`worker A claimed: [${claimedByA.map((r) => r.id).join(', ')}]`);

      const startedAt = Date.now();
      const claimedByB = await b.$queryRawUnsafe<{ id: number }[]>(CLAIM);
      const waitedMs = Date.now() - startedAt;
      console.log(`worker B claimed: [${claimedByB.map((r) => r.id).join(', ')}] in ${waitedMs}ms`);

      const overlap = claimedByA.filter((x) => claimedByB.some((y) => y.id === x.id));
      const passed = claimedByA.length > 0 && overlap.length === 0 && waitedMs < 1000;

      console.log(`overlap: ${overlap.length} row(s)`);
      console.log(
        passed
          ? 'PASS — B skipped every row A held, and did not block on them'
          : 'FAIL — two workers would double-check monitors',
      );
      if (!passed) process.exitCode = 1;
    });
  } finally {
    for (const row of saved) {
      await a.$executeRawUnsafe(
        `UPDATE monitors SET next_check_at = $1 WHERE id = $2`,
        row.next_check_at,
        row.id,
      );
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await a.$disconnect();
    await b.$disconnect();
  });
