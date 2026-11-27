import { useEffect, useState } from 'react'
import { useIsDark } from './useIsDark'

/** Renders Mermaid source to SVG, again when the source or the theme changes. */
export function useMermaid(code: string) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const dark = useIsDark()
  useEffect(() => {
    let dead = false
    const t = setTimeout(async () => {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'neutral', fontFamily: 'Inter, sans-serif' })
        const { svg } = await mermaid.render('m' + Math.random().toString(36).slice(2), code)
        if (!dead) { setSvg(svg); setError('') }
      } catch (e: any) { if (!dead) setError(String(e?.message ?? e).split('\n')[0]) }
    }, 350)
    return () => { dead = true; clearTimeout(t) }
  }, [code, dark])
  return { svg, error }
}
