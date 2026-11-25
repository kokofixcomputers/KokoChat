import { useEffect, useMemo, useState } from 'react'
import { LOCAL_ICONS } from '../lib/modelIconList'
import { Plug } from 'lucide-react'
import { cn } from '../lib/utils'

const REMOTE = 'https://developers.openai.com/images/api/models/icons'
const OPENAI_LIKE = /^(gpt|o\d|chatgpt|codex|dall-e|sora|whisper|tts|text-embedding|computer-use|davinci|babbage)/

const FAMILY: [RegExp, string][] = [
  [/^glm.*v/, 'glm-v.svg'],
  [/^glm|^chatglm/, 'glm.svg'],
  [/^claude/, 'claude-opus-4-6'],
  [/^gemini|^gemma/, 'gemini-2.5-pro'],
  [/^grok/, 'grok-4-0709'],
  [/^deepseek/, 'deepseek-chat'],
  [/^qwen|^qwq/, 'qwen3-max'],
  [/^(mistral|ministral|magistral|open-mistral|codestral|pixtral)/, 'mistral-large-latest'],
  [/^(sonar)/, 'sonar-pro'],
  [/^(command|c4ai)/, 'command-r-08-2024'],
  [/^gpt-oss/, 'gpt-oss-120b'],
  [/^o\d/, 'o3'],
  [/^gpt-5/, 'gpt-5'],
  [/^gpt-4/, 'gpt-4o'],
  [/^gpt/, 'gpt-5'],
]

const strip = (id: string) => id.split('/').pop()!.split(':')[0].toLowerCase()
const variants = (m: string) => {
  const out = [m]
  const nodate = m.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-\d{8}$/, '')
  if (nodate !== m) out.push(nodate)
  const nolatest = nodate.replace(/-latest$/, '')
  if (nolatest !== nodate) out.push(nolatest)
  return out
}

export function iconCandidates(model: string): string[] {
  const m = strip(model)
  const vs = variants(m)
  const c: string[] = []
  for (const v of vs) if (LOCAL_ICONS.has(v)) c.push(`/model-icons/${v}.webp`)
  if (OPENAI_LIKE.test(m)) for (const v of vs) c.push(`${REMOTE}/${v}.png`)
  const fam = FAMILY.find(([re]) => re.test(m))?.[1]
  if (fam) c.push(fam.endsWith('.svg') ? `/model-icons/${fam}` : `/model-icons/${fam}.webp`)
  return [...new Set(c)]
}

export function ModelIcon({ model, preset, name, size = 22, className }: { model: string; preset: string; name: string; size?: number; className?: string }) {
  const cands = useMemo(() => iconCandidates(model), [model])
  const [i, setI] = useState(0)
  useEffect(() => setI(0), [cands])
  if (i >= cands.length) return <ProviderDot preset={preset} name={name} size={size} />
  return (
    <img
      src={cands[i]} alt="" loading="lazy" draggable={false}
      onError={() => setI((x) => x + 1)}
      style={{ width: size, height: size, borderRadius: size * 0.26 }}
      className={cn('shrink-0 object-cover', className)}
    />
  )
}

export function ProviderDot({ preset, name, size = 20 }: { preset: string; name: string; size?: number }) {
  const [bad, setBad] = useState(preset === 'custom')
  return (
    <span style={{ width: size, height: size }} className="grid shrink-0 place-items-center rounded-lg bg-white ring-1 ring-black/10">
      {bad ? (
        <Plug size={size * 0.55} className="text-neutral-700" />
      ) : (
        <img src={`/providers/${preset}.svg`} alt={name} onError={() => setBad(true)} style={{ width: size * 0.62, height: size * 0.62 }} />
      )}
    </span>
  )
}

