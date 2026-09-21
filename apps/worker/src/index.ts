/**
 * PulseWatch check worker.
 *
 * Phase 0: process skeleton and graceful shutdown only.
 * Phase 2 fills in scheduler.ts (claim due monitors with FOR UPDATE SKIP LOCKED),
 * checker.ts (fetch + AbortController timeout) and the state-machine wiring.
 * Phase 5 adds alerts.ts, Phase 6 adds rollup.ts.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '../../.env') });
config();

const POLL_SECONDS = Number(process.env.WORKER_POLL_SECONDS ?? 5);

let running = true;

async function tick() {
  // TODO(phase-2): claim due monitors, run checks, persist results, advance state machine.
}

async function main() {
  console.log(`[worker] started, polling every ${POLL_SECONDS}s`);
  while (running) {
    try {
      await tick();
    } catch (err) {
      // A failing cycle must never kill the worker.
      console.error('[worker] cycle failed:', err);
    }
    await new Promise((r) => setTimeout(r, POLL_SECONDS * 1000));
  }
}

function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, stopping after this cycle`);
  running = false;
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});
