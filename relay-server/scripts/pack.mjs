/**
 * Pack the relay-server bundle without dev tooling: consumers only need the
 * built `dist/` plus README.
 */
import { execSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const staging = join(pkgDir, '.pack-staging')

execSync('pnpm run build', { cwd: pkgDir, stdio: 'inherit' })

const pkg = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'))
const shipped = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  type: pkg.type,
  main: pkg.main,
  bin: pkg.bin,
  files: pkg.files,
  license: pkg.license,
  dependencies: pkg.dependencies ?? {},
}

await rm(staging, { recursive: true, force: true })
await mkdir(staging, { recursive: true })
await writeFile(join(staging, 'package.json'), `${JSON.stringify(shipped, null, 2)}\n`)
await cp(join(pkgDir, 'dist'), join(staging, 'dist'), { recursive: true })
await cp(join(pkgDir, 'deploy'), join(staging, 'deploy'), { recursive: true })
await cp(join(pkgDir, 'README.md'), join(staging, 'README.md'))
execSync('pnpm pack --pack-destination ..', { cwd: staging, stdio: 'inherit' })
await rm(staging, { recursive: true, force: true })