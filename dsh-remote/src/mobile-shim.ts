/**
 * Mobile adaptation shim (tunnel-only). The dsh web client is desktop-first:
 * it ships no responsive breakpoints at all, so a phone behind the relay gets
 * a squeezed settings panel (fixed 188px nav inside an 800px dialog) and
 * right-anchored dropdowns that overflow the viewport. The http plane injects
 * this stylesheet into every text/html response it proxies, so tunnel
 * sessions render a mobile layout while desktop/GUI traffic — which never
 * crosses the plane — is untouched.
 *
 * Anchoring strategy, most stable first:
 * - layout custom properties (`--dsh-chat-content-width` and friends) are
 *   re-declared with `* !important`, which beats the component-level class
 *   declarations regardless of build-time hash names;
 * - the settings shell is hooked through its semantic attributes
 *   (`[role="dialog"][aria-modal="true"]:has(> nav)`) instead of class names;
 * - only the model-select menu needs a class-substring selector
 *   (`[class*="_menu"]` — lightningcss keeps the local name in the hash).
 * Everything is gated behind `max-width: 720px`, so the same page on a
 * desktop-sized viewport renders exactly as upstream shipped it.
 */

export const MOBILE_BREAKPOINT = 'max-width: 720px'

/** `<meta name=viewport>` content the phone session should run with: the
 * stock tag lacks the keyboard-resize and notch hints the composer needs. */
const VIEWPORT_CONTENT =
  'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content'

const SHIM_CSS = `
@media (max-width: 720px) {
  html { -webkit-tap-highlight-color: transparent; }
  *, *::before, *::after {
    --dsh-chat-content-width: 100% !important;
    --dsh-composer-card-max-width: 100% !important;
    --dsh-composer-side-clearance: 2px !important;
  }
  [role="dialog"][aria-modal="true"]:has(> nav) {
    flex-direction: column !important;
    width: 100vw !important;
    max-width: 100vw !important;
    height: 100vh !important;
    height: 100dvh !important;
    max-height: 100dvh !important;
    border-radius: 0 !important;
  }
  /* The content pane already owns the scroll: its inner .options carries
     flex:1 + min-height:0 + overflow-y:auto. But on mobile the pane is a
     column flex item, whose default min-height:auto grows it past the clamped
     100dvh panel — so that inner scroll never gets a bounded height and the
     panel's overflow:hidden clips the rest. Bounding the pane lets the inner
     .options scroll engage (and the fixed header keeps the close button in reach). */
  [role="dialog"][aria-modal="true"]:has(> nav) > :last-child {
    min-height: 0 !important;
  }
  [role="dialog"][aria-modal="true"]:has(> nav) > nav {
    flex-direction: row !important;
    align-items: center;
    gap: 4px !important;
    width: 100% !important;
    padding: 10px 8px 6px !important;
    overflow-x: auto;
    overflow-y: hidden;
    border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.25));
  }
  [role="dialog"][aria-modal="true"] > nav > div:first-child { display: none; }
  [role="dialog"][aria-modal="true"] > nav > div {
    flex-direction: row !important;
    gap: 2px !important;
  }
  [role="dialog"][aria-modal="true"] > nav button {
    flex: none;
    height: 36px !important;
    padding: 6px 12px !important;
    white-space: nowrap;
  }
  [role="dialog"][aria-modal="true"] > :last-child > :first-child {
    height: auto !important;
    min-height: 44px;
    padding: 10px 12px 4px !important;
  }
  [role="dialog"][aria-modal="true"] > :last-child > :last-child {
    padding: 0 12px 20px !important;
  }
  [class*="_menu"] {
    left: 8px !important;
    right: auto !important;
    width: auto !important;
    max-width: calc(100vw - 16px) !important;
  }
}

/* Sidebar drawer, aligned with dsh's own narrow breakpoint (AppFrame
   auto-collapses below its 1024px threshold and re-expands by pushing a
   grid column -- on a phone that squeezes the chat to a sliver). When the
   narrow sidebar is re-expanded (frame without its collapsed attribute),
   the grid collapses to a single full-width column and the sidebar column
   (always the frame's first child) floats above the content as a drawer.
   The frame anchors on its unique inline grid-template-columns style, so
   no class names are involved. */
@media (max-width: 1023.98px) {
  [style*="grid-template-columns"]:not([data-sidebar-collapsed]) {
    grid-template-columns: minmax(0, 1fr) 0px !important;
  }
  [style*="grid-template-columns"]:not([data-sidebar-collapsed]) > :first-child {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: min(80vw, 340px);
    z-index: 30;
    border-right: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.25));
    /* Directional shadow hugging the edge: a symmetric blur here bleeds a
       wide dark band onto the chat and reads as dead space. */
    box-shadow: 10px 0 22px -10px rgba(0, 0, 0, 0.55);
  }
  /* The sidebar content keeps the desktop column's stored width (inline
     style, SidebarRoot's width:<px>), so inside the wider drawer the
     header/workspace rows stop short of the drawer edge. The width-bearing
     root sits behind a slot wrapper, so stretch the direct children AND any
     inline-width element in the drawer subtree. */
  [style*="grid-template-columns"]:not([data-sidebar-collapsed]) > :first-child > * {
    width: 100% !important;
    max-width: none !important;
  }
  [style*="grid-template-columns"]:not([data-sidebar-collapsed]) > :first-child [style*="width"] {
    width: 100% !important;
    max-width: none !important;
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
