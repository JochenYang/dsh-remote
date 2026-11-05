/**
 * End-to-end smoke for the relay (run: pnpm test, builds must exist).
 * Covers: host registration + pairing code, re-pair keeping the code valid
 * with single-active tokens, admin login/state, remove guards (online 409,
 * offline ok), tombstone persistence across a restart, admin page markers.
 */
const { WebSocket } = require('ws')
const crypto = require('node:crypto')
const http = require('node:http')
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

/**
 * POST over a brand-new TCP connection — the shape a code guesser has. The
 * pairing limit must key on the client address, not on this connection.
 */
function postRaw(pathname, payload, extraHeaders = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port: PORT,
      path: pathname,
      method: 'POST',
      agent: false,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...extraHeaders,
      },
    }, (res) => {
      let text = ''
      res.on('data', (chunk) => { text += chunk.toString('utf8') })
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(text) } catch { /* plain-text answer */ }
        resolve({ status: res.statusCode, json, text })
      })
    })
    request.on('error', reject)
    request.end(body)
  })
}

/** Frames the fake host received, in arrival order. */
const hostInbox = []

/** Ack every `ws-open` so the bridge becomes ready, and record what arrives. */
function watchHost(ws) {
  ws.on('message', (raw) => {
    const frame = JSON.parse(raw.toString())
    hostInbox.push(frame)
    if (frame.t === 'ws-open') ws.send(JSON.stringify({ t: 'ws-open-ok', id: frame.id }))
  })
}

async function waitFor(predicate, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return true
    await sleep(50)
  }
  return false
}

function openBridge(cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/d/${DEVICE_ID}/events/mux`, { headers: { cookie } })
    const timer = setTimeout(() => reject(new Error('bridge open timeout')), 5000)
    ws.on('open', () => { clearTimeout(timer); resolve(ws) })
    ws.on('error', (error) => { clearTimeout(timer); reject(error) })
  })
}

async function main() {
  relayProc = relay()
  await waitHttp()

  const host = await hostRegister()
  check('host hello-ok + pair code issued', /^\d{6}$/.test(host.code))

  // The dsh UI links its manifest relatively, so the browser asks for it under
  // the device path without credentials; it must not fall through to /pair.
  const deviceManifest = await fetch(`${BASE}/d/${DEVICE_ID}/manifest.webmanifest`)
  check('device-path manifest is served without a cookie',
    deviceManifest.ok && (deviceManifest.headers.get('content-type') || '').includes('manifest+json'),
    `status=${deviceManifest.status}`)

  // A `ws-frame` carries one whole dsh message, and dsh does not bound those:
  // an oversized frame must not kill the host connection (0.1.4 closed it with
  // 1009, which read as "host offline" to every phone).
  host.ws.send(JSON.stringify({ t: 'ws-frame', id: 999, opcode: 2, dataBase64: 'A'.repeat(150_000) }))
  await sleep(400)
  check('host survives a 150 KiB frame', host.ws.readyState === WebSocket.OPEN,
    `readyState=${host.ws.readyState}`)

  const gotPong = await new Promise((resolve) => {
    const onMessage = (raw) => {
      const frame = JSON.parse(raw.toString())
      if (frame.t !== 'pong') return
      host.ws.off('message', onMessage)
      resolve(true)
    }
    host.ws.on('message', onMessage)
    host.ws.send(JSON.stringify({ t: 'ping' }))
    setTimeout(() => resolve(false), 2000)
  })
  check('host-initiated ping is answered with pong', gotPong)

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

  // ---- websocket bridge: normal frames pass, oversized ones close --------
  watchHost(host.ws)
  const claim = await fetch(`${BASE}/d/${DEVICE_ID}/__claim`, {
    method: 'POST',
    headers: { 'x-dsh-relay-token': pair2.json.token },
  })
  const phoneCookie = (claim.headers.get('set-cookie') || '').split(';')[0]
  check('phone claim issues a session cookie', claim.ok && phoneCookie.startsWith('dsh-relay='))

  const bridge = await openBridge(phoneCookie)
  bridge.send('ping')
  const delivered = await waitFor(() => hostInbox.some(
    (frame) => frame.t === 'ws-frame' && Buffer.from(frame.dataBase64, 'base64').toString('utf8') === 'ping',
  ))
  check('small phone frame reaches the host', delivered)
  bridge.close()

  // The old 64 KiB close-on-oversize was the regression: a dsh message of this
  // size is legitimate and must travel whole.
  const bigBridge = await openBridge(phoneCookie)
  const bigPayload = Buffer.alloc(70 * 1024, 0x41)
  bigBridge.send(bigPayload)
  const bigDelivered = await waitFor(() => hostInbox.some(
    (frame) => frame.t === 'ws-frame' && typeof frame.dataBase64 === 'string'
      && Buffer.from(frame.dataBase64, 'base64').length === bigPayload.length,
  ))
  check('70 KiB phone frame reaches the host', bigDelivered)
  bigBridge.close()

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

  // ---- pairing limits + control-body caps (fresh process) ----------------
  const guesses = []
  for (let i = 0; i < 5; i++) guesses.push(await postRaw('/pair', { code: '000000' }))
  check('five guesses reach the code check', guesses.every((r) => r.status === 404),
    guesses.map((r) => r.status).join(','))

  const limited = await postRaw('/pair', { code: '000000' })
  check('sixth guess from one address is 429',
    limited.status === 429 && limited.json?.error?.code === 'RATE_LIMITED', `status=${limited.status}`)

  const forwarded = await postRaw('/pair', { code: '000000' }, { 'x-forwarded-for': '203.0.113.9' })
  check('forwarded client address gets its own bucket', forwarded.status === 404, `status=${forwarded.status}`)

  const hugeBody = await postRaw('/pair', { code: '1'.repeat(8 * 1024) }, { 'x-forwarded-for': '203.0.113.10' })
  check('oversized pair body is refused with 413', hugeBody.status === 413, `status=${hugeBody.status}`)

  const hugeAdmin = await postRaw('/admin/login', { password: 'x'.repeat(8 * 1024) }, { 'x-forwarded-for': '203.0.113.11' })
  check('oversized admin body is refused with 413', hugeAdmin.status === 413, `status=${hugeAdmin.status}`)

  const page = await fetch(`${BASE}/admin`).then((r) => r.text())
  check('admin page has remove action + tabs', page.includes('删除设备') && page.includes('data-filter'))

  relayProc.kill()
  fs.rmSync(DATA_DIR, { recursive: true, force: true })
  if (failures.length > 0) { console.log(`\n${failures.length} FAILURE(S)`); process.exit(1) }
  console.log('\nall relay smoke checks passed')
  process.exit(0)
}

main().catch((error) => { console.error(error); try { relayProc.kill() } catch {} process.exit(1) })
