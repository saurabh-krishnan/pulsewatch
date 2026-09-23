/**
 * Runs before each API test file, before any application module is imported.
 *
 * It must not import the app itself: ES imports are hoisted, so an import here
 * would load env.ts before these assignments and parse the wrong values.
 * dotenv never overwrites variables that are already set, so the root .env
 * cannot pull the tests back onto the dev database.
 */
import { TEST_DATABASE_URL } from './testDb.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET = 'test-only-secret-long-enough-for-hs256-signing';
process.env.JWT_EXPIRES_IN = '1h';
process.env.CORS_ORIGIN = 'http://localhost:5173';
// Tests run with the production SSRF policy, so the policy is what gets tested.
process.env.ALLOW_PRIVATE_MONITOR_TARGETS = 'false';
process.env.MONITOR_HOST_ALLOWLIST = '10.1.2.3';
