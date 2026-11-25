import { create } from 'zustand'
import { uid } from './utils'

export interface Toast { id: string; text: string; kind: 'info' | 'error' | 'success'; action?: { label: string; run: () => void } }
export const useToasts = create<{ toasts: Toast[]; push: (t: Omit<Toast, 'id'>) => void; dismiss: (id: string) => void }>((set) => ({
  toasts: [],
  push: (t) => {
    const id = uid()
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.kind === 'error' || t.action ? 6500 : 2600)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}))
export const toast = {
  info: (text: string, action?: Toast['action']) => useToasts.getState().push({ text, kind: 'info', action }),
  success: (text: string) => useToasts.getState().push({ text, kind: 'success' }),
  error: (text: string) => useToasts.getState().push({ text, kind: 'error' }),
}
