/**
 * relay-server build: one esbuild pass produces the ESM CLI bundle.
 * `ws` stays external (runtime dependency), node: builtins stay native.
 */
import { build } from 'esbuild'

await build({
  entryPoints: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
  },
  bundle: true,
  outdir: 'dist',
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  external: ['ws', 'node:*'],
  sourcemap: true,
  logLevel: 'info',
})