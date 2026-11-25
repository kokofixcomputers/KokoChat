import { useEffect, useState } from 'react'
import { MESSAGE } from '../lib/oneminAuth'

/** The page 1minRelay sends you back to. It hands the answer to the window that started the sign-in and closes itself. */
export function OneMinCallback() {
  const [note, setNote] = useState('Finishing sign-in…')
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const r = { code: q.get('code') ?? undefined, state: q.get('state') ?? undefined, error: q.get('error') ?? undefined }
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: MESSAGE, ...r }, '*')
      setNote('Signed in. You can close this window.')
      setTimeout(() => window.close(), 300)
    } else {
      // the whole tab was used for sign-in: leave the answer for the app and go back to it
      try { localStorage.setItem('koko:oauth1min:result', JSON.stringify(r)) } catch { /* ignore */ }
      location.replace('/')
    }
  }, [])
  return <div style={{ display: 'grid', placeItems: 'center', height: '100vh', fontFamily: 'system-ui, sans-serif', color: '#666' }}>{note}</div>
}
