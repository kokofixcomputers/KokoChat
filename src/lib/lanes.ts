import type { Message } from '../types'

/**
 * Compare mode: one user message can have several assistant replies ("lanes"), one per model.
 * Each lane continues its own thread; a normal (single-model) turn follows the reply you picked
 * (or the first finished one).
 */
export function resolveForModel(messages: Message[], lane?: number): Message[] {
  if (!messages.some((m) => m.cmp)) return messages
  const chosen = new Map<string, string>() // group -> id of the reply that continues the conversation
  if (lane === undefined) {
    const byGroup = new Map<string, Message[]>()
    for (const m of messages) if (m.cmp) byGroup.set(m.cmp.group, [...(byGroup.get(m.cmp.group) ?? []), m])
    for (const [g, ms] of byGroup) chosen.set(g, (ms.find((x) => x.cmp!.picked) ?? ms.find((x) => x.status === 'done') ?? ms[0]).id)
  }
  return messages.filter((m) => !m.cmp || (lane === undefined ? chosen.get(m.cmp.group) === m.id : m.cmp.lane === lane))
}

export interface LaneUnit { cmp: true; group: string; msgs: { m: Message; i: number }[] }
export interface PlainUnit { cmp: false; m: Message; i: number }

/** Splits a chat into plain messages and compare rows (consecutive replies sharing one group). */
export function toUnits(messages: Message[]): (LaneUnit | PlainUnit)[] {
  const out: (LaneUnit | PlainUnit)[] = []
  messages.forEach((m, i) => {
    const last = out[out.length - 1]
    if (m.cmp) {
      if (last && last.cmp && last.group === m.cmp.group) last.msgs.push({ m, i })
      else out.push({ cmp: true, group: m.cmp.group, msgs: [{ m, i }] })
    } else out.push({ cmp: false, m, i })
  })
  return out
}
