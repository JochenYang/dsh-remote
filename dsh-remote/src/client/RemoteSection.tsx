/**
 * RemoteSection: the "手机连接" page inside DSH Settings (settings.section slot).
 * Shows the live tunnel status and the pairing code, and edits relay settings
 * through the HTTP-backed source (routes.ts). UI copy is zh-CN.
 *
 * The config source is owned here (created once per mount) and read through
 * `useSyncExternalStore`, so the component does not depend on slot hook
 * injection semantics. An external source can still be passed via `remote`
 * (e.g. for tests or a shared instance).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { createRemoteConfigSource } from './config-source'
import type { RemoteConfigSource, RemoteStatusClient } from './config-source'

export interface RemoteSectionProps {
  remote?: RemoteConfigSource
  close?: () => void
}

function labelOf(state: RemoteStatusClient['state']): { text: string; color: string } {
  switch (state) {
    case 'online':
      return { text: '已连接', color: '#2e9e5b' }
    case 'connecting':
      return { text: '连接中…', color: '#d98e2b' }
    case 'error':
      return { text: '连接异常', color: '#c94b4b' }
    default:
      return { text: '未连接', color: '#8a8f98' }
  }
}

function formatTime(ms: number | null): string {
  if (ms === null) return '—'
  return new Date(ms).toLocaleTimeString('zh-CN', { hour12: false })
}

export function RemoteSection(props: RemoteSectionProps): ReactElement {
  const sourceRef = useRef<RemoteConfigSource | undefined>(undefined)
  if (sourceRef.current === undefined) {
    sourceRef.current = props.remote ?? createRemoteConfigSource()
  }
  const source = sourceRef.current
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot)

  const settings = snapshot.status === 'ready' ? snapshot.settings : undefined
  const remote = snapshot.status === 'ready' ? snapshot.remote : undefined
  const state = remote?.state ?? 'idle'
  const badge = labelOf(state)

  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  // Re-render every 10s while a pairing code is on screen so the expired
  // hint flips without waiting for an unrelated update.
  const [, setTick] = useState(0)
  const pairCode = remote?.pair?.code
  useEffect(() => {
    if (pairCode === undefined) return
    const timer = setInterval(() => setTick((t) => t + 1), 10_000)
    return () => clearInterval(timer)
  }, [pairCode])
  const pairExpired = remote?.pair !== undefined && remote.pair !== null && remote.pair.expiresAt <= Date.now()
  const relay = relayRoot(settings?.relayUrl ?? '')
  const pairUrl = relay !== '' && remote?.pair ? `${relay}/pair?code=${remote.pair.code}` : ''

  /**
   * Run an action with a pending state and a visible outcome. `fn` resolves
   * true on success, false on failure, and null when the user aborted (no
   * notice then). Keeps the button visibly responsive even when the data
   * itself did not change.
   */
  const act = async (
    fn: () => Promise<boolean | null>,
    okText: string,
    failText = '操作失败，请检查网络或中继地址',
  ): Promise<void> => {
    if (refreshing) return
    setRefreshing(true)
    setNotice(null)
    const result = await fn()
    setRefreshing(false)
    if (result === null) return
    setNotice(result ? { ok: true, text: okText } : { ok: false, text: failText })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0 24px' }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>手机连接</h2>
      <p style={{ margin: 0, fontSize: 12, opacity: 0.75, lineHeight: 1.6 }}>
        通过自托管中继把手机浏览器接入桌面 DSH：手机打开配对页输码即可像桌面端一样使用。
      </p>

      <Row label="连接状态">
        <span style={{ fontSize: 13, fontWeight: 600, color: badge.color }}>{badge.text}</span>
      </Row>

      <Row label="设备编号">
        <span style={{ fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all', maxWidth: 260, textAlign: 'right' }}>
          {remote?.deviceId ?? '—'}
        </span>
      </Row>

      <Row label="中继地址">
        <input
          style={{ width: 300, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--dsh-border, #3a3d45)', background: 'transparent' }}
          placeholder="https://relay.example.com"
          disabled={busy}
          defaultValue={settings?.relayUrl ?? ''}
          key={'relay-' + (settings?.relayUrl ?? '')}
          onBlur={(e) => {
            setBusy(true)
            void source.set('relayUrl', e.target.value.trim()).finally(() => setBusy(false))
          }}
        />
      </Row>

      <Row label="中继令牌">
        <input
          type="password"
          style={{ width: 300, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--dsh-border, #3a3d45)', background: 'transparent' }}
          placeholder="部署 relay 时配置的 host token"
          disabled={busy}
          defaultValue={settings?.hostToken ?? ''}
          key={'token-' + (settings?.hostToken ?? '')}
          onBlur={(e) => {
            setBusy(true)
            void source.set('hostToken', e.target.value.trim()).finally(() => setBusy(false))
          }}
        />
      </Row>

      <Row label="启动时自动连接">
        <input
          type="checkbox"
          style={{ width: 16, height: 16, accentColor: 'var(--dsh-accent, #4c8dff)', cursor: 'pointer' }}
          checked={settings?.autoConnect ?? true}
          onChange={(e) => { void source.set('autoConnect', e.target.checked) }}
        />
      </Row>

      {remote?.pair ? (
        <div style={{ background: 'var(--dsh-surface-2, rgba(255,255,255,0.04))', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <PairQr text={pairUrl} />
            <div style={{ fontSize: 11, opacity: 0.6, lineHeight: 1.7, flex: 1 }}>
              用手机相机扫描，自动打开配对页并填码；或手动访问下方链接输入配对码。
            </div>
          </div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>配对码（10 分钟内有效）</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: 3, fontFamily: 'monospace' }}>{remote.pair.code}</span>
            <button
              style={buttonStyle(refreshing)}
              disabled={refreshing}
              onClick={() => { void act(() => copyText(remote.pair?.code ?? ''), '配对码已复制', '复制失败，请手动选择复制') }}
            >复制</button>
            <button style={buttonStyle(refreshing)} disabled={refreshing} onClick={() => { void act(() => source.refreshPair(), '配对码已刷新') }}>
              {refreshing ? '刷新中…' : pairExpired ? '刷新新码' : '刷新'}
            </button>
          </div>
          <div style={{ fontSize: 11, opacity: pairExpired ? 1 : 0.5, color: pairExpired ? '#c94b4b' : undefined }}>
            {pairExpired
              ? `配对码已于 ${formatTime(remote.pair.expiresAt)} 过期，手机输入此码无效——点击「刷新新码」后再用新码配对。`
              : `有效期至 ${formatTime(remote.pair.expiresAt)} · 手机访问{' '}`}
            {!pairExpired && (
              <>
                <a style={{ color: 'var(--dsh-accent, #4c8dff)' }} href={relayRoot(settings?.relayUrl ?? '')} target="_blank" rel="noreferrer">
                  {relayRoot(settings?.relayUrl ?? '') || '中继地址'}
                </a>{' '}
                输入该配对码
              </>
            )}
          </div>
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 12, opacity: 0.55 }}>
          {state === 'error' ? (remote?.lastError ?? '连接失败，请检查地址与令牌。')
          : state === 'connecting' ? '正在建立中继连接…'
          : '已连接中继后此处显示配对码。'}
        </p>
      )}

      {state === 'error' && remote?.lastError ? (
        <p style={{ margin: 0, fontSize: 12, color: '#c94b4b' }}>{remote.lastError}</p>
      ) : null}

      <Row label="手机在线">
        <span style={{ fontSize: 13 }}>{remote?.peer?.online === true ? '是' : '否'}</span>
      </Row>

      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button style={{ ...buttonStyle(refreshing), color: '#c94b4b', borderColor: '#c94b4b60' }} disabled={refreshing}
          onClick={() => { void act(() => revokeHooked(source), '已吊销全部已配对会话') }}>
          吊销全部手机会话
        </button>
        <button style={buttonStyle(refreshing)} disabled={refreshing} onClick={() => { void act(() => source.refresh(), `已刷新 ${formatTime(Date.now())}`) }}>
          {refreshing ? '刷新中…' : '刷新状态'}
        </button>
      </div>

      {notice ? (
        <p style={{ margin: 0, fontSize: 12, opacity: 0.75, color: notice.ok ? 'inherit' : '#c94b4b' }}>{notice.text}</p>
      ) : null}
    </div>
  )
}

function revokeHooked(source: RemoteConfigSource): Promise<boolean | null> {
  if (!window.confirm('吊销后所有已配对手机需重新输码。继续？')) return Promise.resolve(null)
  return source.revoke()
}

function relayRoot(relayUrl: string): string {
  const trimmed = relayUrl.trim()
  if (trimmed === '') return ''
  return trimmed.replace(/^wss?:\/\//, (m) => (m.startsWith('wss') ? 'https://' : 'http://'))
}

/**
 * Copy with a visible outcome. The async clipboard API needs a focused,
 * permission-granted context — dsh's settings webview can refuse it — so a
 * hidden-textarea `execCommand` fallback keeps the copy working there.
 */
function copyText(text: string): Promise<boolean> {
  return navigator.clipboard.writeText(text)
    .then(() => true)
    .catch(async () => {
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        area.remove()
        return ok
      } catch {
        return false
      }
    })
}

/**
 * QR code for the pairing URL, generated lazily with qrcode-generator
 * (bundled into the client). Renders an empty placeholder slot while the
 * module loads, so layout does not jump.
 */
interface QrFactory {
  (typeNumber: number, errorCorrectionLevel: string): {
    addData(data: string): void
    make(): void
    createDataURL(cellSize: number, margin: number): string
  }
}

function PairQr(props: { text: string }): ReactElement | null {
  const [dataUrl, setDataUrl] = useState('')
  useEffect(() => {
    let alive = true
    void import('qrcode-generator').then((mod) => {
      if (!alive) return
      try {
        const factory = (mod.default ?? mod) as unknown as QrFactory
        const qr = factory(0, 'M')
        qr.addData(props.text)
        qr.make()
        const url = qr.createDataURL(6, 10)
        if (alive) setDataUrl(url)
      } catch {
        /* QR generation failure stays silent: manual code entry still works */
      }
    })
    return () => {
      alive = false
    }
  }, [props.text])

  if (props.text === '') return null
  if (dataUrl === '') return <div style={{ width: 132, height: 132 }} />
  return (
    <img
      src={dataUrl}
      alt="配对二维码，手机扫码进入配对页"
      width={132}
      height={132}
      style={{ borderRadius: 8, background: '#fff', padding: 6 }}
    />
  )
}

function buttonStyle(disabled = false): Record<string, string | number> {
  return {
    padding: '3px 10px',
    fontSize: 12,
    borderRadius: 6,
    border: '1px solid var(--dsh-border, #3a3d45)',
    background: 'var(--dsh-surface-2, rgba(255,255,255,0.04))',
    cursor: disabled ? 'not-allowed' : 'pointer',
    color: 'inherit',
    opacity: disabled ? 0.55 : 1,
    transition: 'opacity .15s ease, background .15s ease',
  }
}

function Row(props: { label: ReactNode; children: ReactNode }): ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: 13 }}>{props.label}</span>
      {props.children}
    </div>
  )
}