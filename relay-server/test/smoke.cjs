/**
 * End-to-end smoke for the relay (run: pnpm test, builds must exist).
 * Covers: host registration + pairing code, re-pair keeping the code valid
 * with single-active tokens, admin login/state, remove guards (online 409,
 * offline ok), tombstone persistence across a restart, admin page markers.
 */
const { WebSocket } = require('ws')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PORT = 18791
const BASE = `http://127.0.0.1:${PORT}`
const HOST_TOKEN = 'smoke-host-token-0123456789abcdef'
const ADMIN_TOKEN = 'smoke-admin-token-0123456789'
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-smoke-'))
const DEVICE_ID = crypto.randomBytes(16).toString('hex')

let adminCookie = ''
let relayProc = null
const failures = []

function check(name, cond, detail = '') {
  if (cond) console.log(`  ok  ${name}`)
  else { console.log(`FAIL  ${name} ${detail}`); failures.push(name) }
}

function relay() {
  return spawn('node', ['dist/cli.js', '--host-token', HOST_TOKEN, '--admin-token', ADMIN_TOKEN,
    '--port', String(PORT), '--data-dir', DATA_DIR, '--quiet'], { stdio: 'ignore' })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitHttp(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${BASE}/manifest.webmanifest`)
      if (res.ok) return
    } catch { /* not up yet */ }
    await sleep(250)
  }
  throw new Error('relay did not come up')
}

function hostRegister() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?role=host`)
    const timer = setTimeout(() => reject(new Error('host hello timeout')), 5000)
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString())
      if (frame.t === 'hello-ok') { clearTimeout(timer); resolve({ ws, code: frame.pair.code }) }
      if (frame.t === 'hello-deny') { clearTimeout(timer); reject(new Error(`deny ${frame.reason}`)) }
    })
    ws.on('error', reject)
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, role: 'host', deviceId: DEVICE_ID, hostToken: HOST_TOKEN })))
  })
}

async function post(path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  let json = null
  try { json = await res.json() } catch { /* empty body */ }
  return { status: res.status, json, headers: res.headers }
}

async function main() {
  relayProc = relay()
  await waitHttp()

  const host = await hostRegister()
  check('host hello-ok + pair code issued', /^\d{6}$/.test(host.code))

  const pair1 = await post('/pair', { code: host.code })
  check('first pair ok', pair1.json?.ok === true)
  const pair2 = await post('/pair', { code: host.code })
  check('re-pair with same code ok', pair2.json?.ok === true, JSON.stringify(pair2.json))

  const login = await post('/admin/login', { password: ADMIN_TOKEN })
  adminCookie = (login.headers.get('set-cookie') || '').split(';')[0]
  check('admin login', login.json?.ok === true && adminCookie !== '')

  let state = await (await fetch(`${BASE}/admin/api/state`, { headers: { cookie: adminCookie } })).json()
  const dev = state.devices.find((d) => d.deviceId === DEVICE_ID)
  check('device listed with single active token', dev?.tokenActive === 1 && dev?.tokenTotal === 2,
    `active=${dev?.tokenActive} total=${dev?.tokenTotal}`)

  const removeOnline = await post('/admin/api/remove', { deviceId: DEVICE_ID }, { cookie: adminCookie })
  check('remove online refused 409', removeOnline.status === 409 && removeOnline.json?.error?.code === 'HOST_ONLINE')

  host.ws.close()
  await sleep(500)
  const remove = await post('/admin/api/remove', { deviceId: DEVICE_ID }, { cookie: adminCookie })
  check('remove offline ok', remove.json?.ok === true, JSON.stringify(remove.json))
  state = await (await fetch(`${BASE}/admin/api/state`, { headers: { cookie: adminCookie } })).json()
  check('device gone from state', !state.devices.some((d) => d.deviceId === DEVICE_ID))

  relayProc.kill()
  await sleep(500)
  relayProc = relay()
  await waitHttp()
  const relogin = await post('/admin/login', { password: ADMIN_TOKEN })
  adminCookie = (relogin.headers.get('set-cookie') || '').split(';')[0]
  state = await (await fetch(`${BASE}/admin/api/state`, { headers: { cookie: adminCookie } })).json()
  check('device stays deleted after restart', !state.devices.some((d) => d.deviceId === DEVICE_ID))

  const page = await fetch(`${BASE}/admin`).then((r) => r.text())
  check('admin page has remove action + tabs', page.includes('删除设备') && page.includes('data-filter'))

  relayProc.kill()
  fs.rmSync(DATA_DIR, { recursive: true, force: true })
  if (failures.length > 0) { console.log(`\n${failures.length} FAILURE(S)`); process.exit(1) }
  console.log('\nall relay smoke checks passed')
  process.exit(0)
}

main().catch((error) => { console.error(error); try { relayProc.kill() } catch {} process.exit(1) })
