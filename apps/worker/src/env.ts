import { config } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

config({ path: resolve(process.cwd(), '../../.env') });
config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  WORKER_POLL_SECONDS: z.coerce.number().int().min(1).default(5),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(10),
  WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
  RESULTS_RETENTION_DAYS: z.coerce.number().int().min(1).default(14),
  // Alerting is optional: an install with neither configured simply stays quiet.
  DISCORD_WEBHOOK_URL: z.string().url().optional().or(z.literal('')).transform((v) => v || undefined),
  SMTP_URL: z.string().optional().or(z.literal('')).transform((v) => v || undefined),
  ALERT_EMAIL_TO: z.string().optional().or(z.literal('')).transform((v) => v || undefined),
  ALERT_EMAIL_FROM: z.string().default('PulseWatch <alerts@pulsewatch.local>'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('[worker] invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
