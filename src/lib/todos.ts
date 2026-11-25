import { useStore } from '../store'
import type { Todo } from '../types'
import type { ToolDef } from './tools'

export const TODO_TOOL: ToolDef = {
  name: 'todo_write',
  description:
    'Keep a visible task list for the current job. The user sees it above the message box and updates as you work. Use it for any task with 3 or more steps: write the plan first, then call it again every time something changes. Always send the COMPLETE list (it replaces the previous one). Each item has content (an imperative step such as "Add the login route") and a status: pending, in_progress or completed. Keep exactly one item in_progress while you work on it, set it to completed as soon as it is truly done (tested, not just written), and add steps you discover along the way. Do not use it for a one-step request or a simple question.',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'The full list, in order.',
        items: { type: 'object', properties: { content: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] } }, required: ['content', 'status'] },
      },
    },
    required: ['todos'],
    additionalProperties: false,
  },
}
export const isTodoTool = (n: string) => n === TODO_TOOL.name

export async function runTodoTool(a: Record<string, any>, ctx: { chatId: string; update: (fn: (b: any) => void) => void }): Promise<{ output: string }> {
  const raw = Array.isArray(a.todos) ? a.todos : []
  if (!raw.length) throw new Error('Pass the complete list in "todos", for example [{"content":"Read the code","status":"in_progress"}].')
  const prev = useStore.getState().chats.find((c) => c.id === ctx.chatId)?.todos ?? []
  const todos: Todo[] = raw.slice(0, 30).map((t: any, i: number) => {
    const content = String(t?.content ?? t?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
    const status = ['pending', 'in_progress', 'completed'].includes(t?.status) ? t.status : 'pending'
    // an item with the same wording keeps its id, so the list does not flicker between updates
    return { id: prev.find((p) => p.content === content)?.id ?? `t${Date.now().toString(36)}${i}`, content, status }
  }).filter((t: Todo) => t.content)
  if (!todos.length) throw new Error('Every item needs "content".')
  // only one item can be in progress
  let seen = false
  for (const t of todos) if (t.status === 'in_progress') { if (seen) t.status = 'pending'; seen = true }
  useStore.getState().setTodos(ctx.chatId, todos)
  const done = todos.filter((t) => t.status === 'completed').length
  ctx.update((b) => { b.meta = { ...(b.meta ?? {}), todos, done, total: todos.length } })
  const cur = todos.find((t) => t.status === 'in_progress'), next = todos.find((t) => t.status === 'pending')
  return { output: done === todos.length ? `All ${todos.length} tasks are completed.` : `Task list updated: ${done} of ${todos.length} done.${cur ? ` In progress: ${cur.content}.` : ' Nothing is marked in progress: mark the step you are starting.'}${!cur && next ? ` Next: ${next.content}.` : ''} Keep going, and update the list as soon as a step is finished.` }
}
