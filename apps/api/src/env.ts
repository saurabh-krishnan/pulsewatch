import { config } from 'dotenv';
import { z } from 'zod';
import { resolve } from 'node:path';

// Load the repo-root .env so api, worker and scripts share one file.
// dotenv never overwrites variables that are already set, which is what lets
// the test setup point everything at the test database first.
config({ path: resolve(process.cwd(), '../../.env') });
config();

const PLACEHOLDER_SECRETS = new Set(['change-me', 'changeme', 'secret', 'jwt-secret']);

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
  MONITOR_HOST_ALLOWLIST: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

/**
 * Settings that are fine on a laptop and dangerous on the internet. Refusing to
 * boot is louder than a warning nobody reads in a deploy log.
 */
if (parsed.data.NODE_ENV === 'production') {
  const problems: string[] = [];
  if (PLACEHOLDER_SECRETS.has(parsed.data.JWT_SECRET) || parsed.data.JWT_SECRET.length < 32) {
    problems.push('JWT_SECRET must be a real secret of at least 32 characters');
  }
  if (parsed.data.ALLOW_PRIVATE_MONITOR_TARGETS) {
    problems.push(
      'ALLOW_PRIVATE_MONITOR_TARGETS must be false; list specific internal hosts in ' +
        'MONITOR_HOST_ALLOWLIST instead',
    );
  }
  if (problems.length) {
    console.error('Refusing to start in production:');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
}

export const env = parsed.data;

export const targetPolicy = {
  allowPrivate: env.ALLOW_PRIVATE_MONITOR_TARGETS,
  allowHosts: env.MONITOR_HOST_ALLOWLIST,
};
