// Prisma config (replaces the deprecated `package.json#prisma` key).
// Prisma does not read .env automatically when this file exists, hence dotenv.
import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
