/**
 * dsh-remote browser half: registers the "手机连接" settings section.
 * The section owns its HTTP-backed config source internally (RemoteSection
 * creates it on mount) and reads it via useSyncExternalStore, so no hook
 * injection semantics are required here.
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: ctx.slots (SlotRegistry) Context merge lives in ui-renderer.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: settings.section SlotMap declaration lives in ui-settings.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { RemoteSection } from './RemoteSection'

/** Client services the fiber waits for before apply (`ctx.slots` requires inject). */
export const inject = ['slots']

export function apply(ctx: Context): void {
  // Wait for the settings shell's section declaration before registering.
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'remote',
        order: 300,
        label: '手机连接',
      },
      RemoteSection,
    ),
  )
}