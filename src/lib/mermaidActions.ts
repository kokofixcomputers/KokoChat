import { createContext, type ReactNode } from 'react'

/** Extra buttons for a rendered Mermaid block. Only the main app provides them (publishing needs its store). */
export const MermaidActions = createContext<((code: string) => ReactNode) | null>(null)
