import { create } from 'zustand'

export interface ConfirmReq { title: string; message: string; confirmLabel: string; cancelLabel: string; danger: boolean; resolve: (ok: boolean) => void }
export const useConfirm = create<{ req: ConfirmReq | null }>(() => ({ req: null }))

export interface ConfirmOptions { title?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }

const DANGER = /delete|erase|discard|remove|clear|unpublish|interrupt|lost|cannot be undone|permanently/i
const guessLabel = (m: string) => /^run /i.test(m) ? 'Run' : /^delete|^permanently delete/i.test(m) ? 'Delete' : /^erase/i.test(m) ? 'Erase' : /^discard/i.test(m) ? 'Discard' : /^remove/i.test(m) ? 'Remove' : /^unpublish/i.test(m) ? 'Unpublish' : /undo anyway/i.test(m) ? 'Undo anyway' : /^delete all/i.test(m) ? 'Delete' : 'Continue'

/** An in-app replacement for window.confirm. Resolves true when the user confirms. */
export function askConfirm(message: string, o: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirm.getState().req?.resolve(false)
    useConfirm.setState({ req: {
      message, title: o.title ?? 'Are you sure?', confirmLabel: o.confirmLabel ?? guessLabel(message), cancelLabel: o.cancelLabel ?? 'Cancel',
      danger: o.danger ?? DANGER.test(message), resolve: (ok) => { useConfirm.setState({ req: null }); resolve(ok) },
    } })
  })
}
