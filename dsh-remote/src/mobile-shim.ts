/**
 * Mobile adaptation shim (tunnel-only).
 *
 * The dsh web client used to ship no responsive breakpoints at all, so the
 * tunnel injected a whole mobile layout: a floating sidebar drawer below
 * 1024px, a full-screen settings panel with a horizontal rail, a viewport
 * clamp for dropdown menus. Current dsh implements all of that itself:
 *
 * - `AppFrame` turns the sidebar into a real drawer below 768px
 *   (`data-sidebar-drawer` + a `data-sidebar-mask` backdrop), positions the
 *   column itself and sizes it inline;
 * - the settings panel goes full-screen with a scrollable horizontal nav at
 *   `width <= 767px`;
 * - portaled menus clamp themselves to the visual viewport through
 *   `--dsh-anchored-max-width` / `--dsh-anchored-max-height`.
 *
 * Re-declaring any of that from here only fights the shipped layout, because
 * the old selectors now land on different elements: the sidebar root is
 * itself `role="dialog" > nav` while its drawer is open, and the settings
 * nav's only child is the row list. This stylesheet therefore stays out of
 * both subtrees.
 *
 * What upstream still lacks is the chat column. `resolveContentWidth` floors
 * the transcript at 640px (680px by default), so on a phone the chat and the
 * composer card overflow horizontally. Re-declaring the layout custom
 * properties with `* !important` beats the component-level declarations
 * regardless of build-time hash names — that is the whole shim now, plus the
 * viewport hints the stock `<meta>` lacks.
 *
 * Everything is gated behind `max-width: 767.98px`, matching upstream's own
 * mobile threshold, so the same page at desktop width renders exactly as
 * upstream shipped it.
 */

/** `<meta name=viewport>` content the phone session should run with: the
 * stock tag lacks the keyboard-resize and notch hints the composer needs. */
const VIEWPORT_CONTENT =
  'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content'

const SHIM_CSS = `
@media (max-width: 767.98px) {
  html { -webkit-tap-highlight-color: transparent; }
  *, *::before, *::after {
    --dsh-chat-content-width: 100% !important;
    --dsh-composer-card-max-width: 100% !important;
    --dsh-composer-side-clearance: 2px !important;
  }
}
`

const SHIM_MARKER = 'data-dsh-remote="mobile"'

/** The injected block: style + a one-line marker script for field diagnosis
 * (`html[data-dsh-remote-mobile]` tells us the shim reached the page). */
const SHIM_BLOCK =
  `<style ${SHIM_MARKER}>${SHIM_CSS}</style>` +
  `<script ${SHIM_MARKER}>document.documentElement.dataset.dshRemoteMobile='1'</script>`

/**
 * Inject the mobile shim into one proxied HTML document. Idempotent (skips
 * documents that already carry the marker); falls back to prepending when the
 * document has no `</head>` to anchor on, so malformed upstream HTML still
 * gets a working shim.
 */
export function injectMobileShim(html: string): string {
  if (html.includes(SHIM_MARKER)) return html
  let out = html
  if (/<meta\s+name="viewport"/i.test(out)) {
    out = out.replace(/(<meta\s+name="viewport"[^>]*content=")[^"]*(")/i, `$1${VIEWPORT_CONTENT}$2`)
  } else if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1><meta name="viewport" content="${VIEWPORT_CONTENT}">`)
  }
  if (/<\/head>/i.test(out)) {
    return out.replace(/<\/head>/i, `${SHIM_BLOCK}</head>`)
  }
  if (/<body[^>]*>/i.test(out)) {
    return out.replace(/<body([^>]*)>/i, `<body$1>${SHIM_BLOCK}`)
  }
  return SHIM_BLOCK + out
}
