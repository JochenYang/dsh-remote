#!/usr/bin/env node
/**
 * relay-server CLI. Flags:
 *
 *   --host-token <token>   shared secret the desktop plugin must present (required)
 *   --admin-token <token>  admin console password (optional; /admin disabled when absent)
 *   --port <n>             listen port (default 8787)
 *   --host <addr>          listen address (default 0.0.0.0)
 *   --data-dir <dir>       JSONL store directory (default ~/.dsh-remote-relay)
 *   --quiet                suppress request logs
 *
 * Run behind TLS (caddy/nginx) — see cloud/README. Never expose plaintext
 * HTTP on a public interface (PROTOCOL §10).
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { RelayServer } from './index.ts'

function usage(): never {
  process.stderr.write(`usage: dsh-remote-relay --host-token <token> [--port <n>] [--host <addr>] [--data-dir <dir>] [--quiet]

  --host-token <token>  shared secret for host registration (required)
  --admin-token <token> password for the admin console (optional)
  --port <n>            listen port (default 8787)
  --host <addr>         listen address (default 0.0.0.0)
  --data-dir <dir>      store directory (default ~/.dsh-remote-relay)
  --quiet               suppress request logs
`)
  process.exit(2)
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      out[key] = 'true'
    } else {
      out[key] = value
      i++
    }
  }
  return out
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const hostToken = args['host-token']
  if (hostToken === undefined || hostToken === '') usage()
  if (hostToken.length < 16) {
    process.stderr.write('relay: HOST_TOKEN must be at least 16 characters (use something like: openssl rand -hex 32)\n')
    process.exit(2)
  }
  const adminToken = args['admin-token'] ?? null
  if (adminToken !== null && adminToken.length < 8) {
    process.stderr.write('relay: ADMIN_TOKEN must be at least 8 characters\n')
    process.exit(2)
  }

  const port = Number.parseInt(args.port ?? '8787', 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write(`relay: invalid --port ${args.port}\n`)
    process.exit(2)
  }
  const host = args.host ?? '0.0.0.0'
  const dataDir = args['data-dir'] ?? join(homedir(), '.dsh-remote-relay')
  const quiet = args.quiet === 'true'

  const log = (message: string): void => {
    if (!quiet || message.startsWith('relay ')) process.stderr.write(`${message}\n`)
  }

  const server = new RelayServer({ hostToken, adminToken, dataDir }, log)

  const shutdown = async (signal: string): Promise<void> => {
    log(`relay: ${signal} received, shutting down`)
    await server.stop()
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))

  server.onServing = (): void => {
    log(`relay: host token accepted; data dir ${dataDir}`)
  }

  await server.start(port, host).catch((error: Error) => {
    process.stderr.write(`relay: failed to start: ${error.message}\n`)
    process.exit(1)
  })
}

await main()