import { config } from 'dotenv';
import { z } from 'zod';
import { resolve } from 'node:path';

// Load the repo-root .env so api, worker and scripts share one file.
config({ path: resolve(process.cwd(), '../../.env') });
config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET must be at least 8 characters'),
  JWT_EXPIRES_IN: z.string().default('1h'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  ALLOW_PRIVATE_MONITOR_TARGETS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
