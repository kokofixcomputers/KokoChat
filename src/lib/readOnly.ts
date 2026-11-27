import { createContext } from 'react'

/** True inside the public shared-chat page: someone else's chat, so nothing may run, publish or change anything. */
export const ReadOnlyView = createContext(false)

/** Only ordinary web addresses: a shared chat must never be able to link to `javascript:` and the like. */
export const webUrl = (u: unknown): string => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '')
