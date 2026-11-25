import type { Provider } from '../types'
import { authHeaders, cleanBase, supportsReasoning } from './providers'
import { fromAnthropic, fromOpenAI, recordUsage } from './usage'

async function readError(res: Response) {
  let msg = `${res.status} ${res.statusText}`
  try { const j = await res.json(); msg = j?.error?.message ?? j?.message ?? msg } catch { /* ignore */ }
  return msg
}

/** Plain one-shot text completion with a chat model (works for both API formats). */
export async function completeText(p: Provider, model: string, instructions: string, input: string, signal?: AbortSignal): Promise<string> {
  if (p.apiMode === 'anthropic') {
    const body = { model, max_tokens: 2048, system: instructions, messages: [{ role: 'user', content: input }] }
    const res = await fetch(`${cleanBase(p.baseUrl)}/messages`, { method: 'POST', headers: authHeaders(p), body: JSON.stringify(body), signal })
    if (!res.ok) throw new Error(await readError(res))
    const j = await res.json()
    recordUsage(p.id, model, fromAnthropic(j.usage))
    return (j.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text ?? '').join('').trim()
  }
  if (p.apiMode === 'responses') {
    const body: any = { model, instructions, input, store: false }
    if (supportsReasoning(p, model)) body.reasoning = { effort: 'low' }
    const res = await fetch(`${cleanBase(p.baseUrl)}/responses`, { method: 'POST', headers: authHeaders(p), body: JSON.stringify(body), signal })
    if (res.ok) {
      const j = await res.json()
      const u = fromOpenAI(j.usage); if (u) recordUsage(p.id, model, u)
      return (j.output ?? []).filter((x: any) => x.type === 'message').flatMap((x: any) => x.content ?? []).map((c: any) => c.text ?? '').join('').trim()
    }
    // no /responses endpoint on this server: fall through to Chat Completions
    if (![404, 405, 501].includes(res.status)) throw new Error(await readError(res))
  }
  const body = { model, messages: [{ role: 'system', content: instructions }, { role: 'user', content: input }] }
  const res = await fetch(`${cleanBase(p.baseUrl)}/chat/completions`, { method: 'POST', headers: authHeaders(p), body: JSON.stringify(body), signal })
  if (!res.ok) throw new Error(await readError(res))
  const j = await res.json()
  { const u = fromOpenAI(j.usage); if (u) recordUsage(p.id, model, u) }
  return String(j.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}
