import { create } from 'zustand'

/** Places in the app where a plugin can put its own elements. */
export type SlotName = 'composer.toolbar' | 'composer.status' | 'message.footer' | 'message.below' | 'topbar' | 'sidebar.footer'
export const SLOTS: SlotName[] = ['composer.toolbar', 'composer.status', 'message.footer', 'message.below', 'topbar', 'sidebar.footer']

export interface SlotCtx {
  /** what the place currently knows (the draft text, the message…) */
  data: any
  /** called again whenever that changes */
  onUpdate: (cb: (data: any) => void) => () => void
}
export interface Mount { id: string; pluginId: string; slot: SlotName; fn: (el: HTMLElement, ctx: SlotCtx) => void | (() => void) }

export type ModalBody = string | HTMLElement | ((el: HTMLElement) => void | (() => void))
export interface ModalAction { label: string; value?: unknown; primary?: boolean; danger?: boolean }
export interface ModalReq { id: string; pluginId: string; title?: string; body: ModalBody; actions: ModalAction[]; dismissValue: unknown; resolve: (v: unknown) => void }

export interface PanelDef { pluginId: string; id: string; title: string; icon?: string; render: (el: HTMLElement, ctx: { close: () => void }) => void | (() => void) }

interface PluginUI {
  mounts: Mount[]
  /** full side-panel tabs plugins offer (desktop app) */
  panels: PanelDef[]
  modals: ModalReq[]
  /** last problem each plugin ran into */
  errors: Record<string, string>
  /** tools each running plugin offers (so Settings can list them) */
  tools: Record<string, { name: string; description: string }[]>
  running: Record<string, boolean>
}

export const usePluginUI = create<PluginUI>(() => ({ panels: [], mounts: [], modals: [], errors: {}, tools: {}, running: {} }))
