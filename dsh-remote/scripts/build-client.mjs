/**
 * Client bundle build (dsh-at-file pattern): one esbuild pass produces the
 * wrapped ModuleLoader handshake directly; `react`, `react/jsx-runtime` and
 * `@deepseek-ai/*` stay external (the shell's static module table provides
 * them). Type checking is a separate tsc step (`typecheck:client`).
 */
import { build } from 'esbuild'

await build({
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: true,
  jsx: 'automatic',
  external: [
    '@deepseek-ai/*',
    'react',
    'react-dom',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'scheduler',
  ],
  banner: {
    js: 'window.__ModuleLoader__.load({ id: "dsh-remote", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
  },
  footer: {
    js: 'return module.exports; } });',
  },
  logLevel: 'info',
})