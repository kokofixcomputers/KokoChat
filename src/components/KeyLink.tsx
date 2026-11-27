import { ExternalLink } from 'lucide-react'
import { presetOf } from '../lib/providers'
import { cn } from '../lib/utils'

/** Where to get what a provider needs: an API key, or for a local server the app itself. Custom providers have none. */
export function KeyLink({ preset, className }: { preset: string; className?: string }) {
  const p = presetOf(preset)
  if (!p.keyUrl) return null
  const label = p.id === 'ollama' || p.id === 'lmstudio' ? `Get ${p.name}` : p.account ? 'Create a Cloudflare API token' : `Get your ${p.name} API key`
  return <a href={p.keyUrl} target="_blank" rel="noreferrer" className={cn('flex w-fit items-center gap-1.5 text-xs font-medium text-accent hover:underline', className)}>{label}<ExternalLink size={11} /></a>
}
