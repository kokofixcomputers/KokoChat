import { useEffect, useState } from 'react'

export function useIsDark() {
  const get = () => document.documentElement.classList.contains('dark')
  const [d, setD] = useState(get)
  useEffect(() => {
    const mo = new MutationObserver(() => setD(get()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])
  return d
}
