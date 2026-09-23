/**
 * Production build for the Node processes (guide Phase 8).
 *
 * Each app is bundled into a single CommonJS file with esbuild. That solves the
 * problem noted in DECISIONS.md at Phase 0: @pulsewatch/shared exports raw
 * TypeScript, which is convenient in development (tsx and Vite transpile it on
 * the fly) but which Node cannot import in production. Bundling pulls the
 * shared source into each output, so production never resolves a .ts file.
 *
 * Only Prisma stays external: its generated client and native query engine
 * live in node_modules and are generated inside the runtime image.
 *
 * Output: dist/server/{api,worker,demo,seed}.cjs, plus source maps so stack
 * traces point at the TypeScript.
 */
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

const OUT = 'dist/server';

const entries = {
  api: 'apps/api/src/index.ts',
  worker: 'apps/worker/src/index.ts',
  demo: 'apps/demo-target/src/index.ts',
  seed: 'prisma/seed.ts',
};

await rm(OUT, { recursive: true, force: true });

const result = await build({
  entryPoints: entries,
  outdir: OUT,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  // No import.meta or top-level await anywhere in the server code, so plain
  // CommonJS output avoids the require() shim ESM bundles of CJS deps need.
  format: 'cjs',
  sourcemap: true,
  external: ['@prisma/client', '.prisma/client'],
  metafile: true,
  logLevel: 'warning',
});

for (const [file, info] of Object.entries(result.metafile.outputs)) {
  if (file.endsWith('.cjs')) {
    console.log(`  ${file.padEnd(28)} ${(info.bytes / 1024).toFixed(0).padStart(6)} KB`);
  }
}
