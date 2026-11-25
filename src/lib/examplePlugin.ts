/** The built-in example plugin: a word counter. This is also a good template for writing your own. */
export const EXAMPLE_PLUGIN = String.raw`// Word Counter: an example Koko plugin.
// A plugin is JavaScript that ends by returning an object. Everything it does goes through the "api" given to activate().

// Counts the pieces of text that contain a letter or digit, so markdown marks like "##" or "-" are not counted.
const words = (text) => (text || '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
const sentences = (text) => ((text || '').match(/[^.!?]+[.!?]+/g) || []).length || ((text || '').trim() ? 1 : 0)

return {
  id: 'word-counter',
  name: 'Word Counter',
  version: '1.0.0',
  author: 'Koko',
  description: 'Shows a live word count while you type, and the length of every assistant reply.',
  // What this plugin needs. "ai" and "chat" are enforced; the others are shown to you before installing.
  permissions: ['ai'],

  // Settings appear under Settings → Plugins → Word Counter.
  settings: [
    { key: 'showInput', label: 'Count while typing', type: 'boolean', default: true, description: 'Show the count in the message box.' },
    { key: 'showReplies', label: 'Count assistant replies', type: 'boolean', default: true, description: 'Show the count next to the model name under each reply.' },
    { key: 'unit', label: 'Count', type: 'select', default: 'words', options: [{ value: 'words', label: 'Words' }, { value: 'chars', label: 'Characters' }, { value: 'both', label: 'Words and characters' }] },
    { key: 'warnAt', label: 'Highlight above this many words', type: 'number', default: 0, min: 0, description: '0 turns the highlight off.' },
  ],

  // Tools the AI can call. Each one can be switched on or off in Settings.
  tools: [
    {
      name: 'count_words',
      description: 'Count the words, characters and sentences of a piece of text. Use it when the user asks how long a text is.',
      parameters: { type: 'object', properties: { text: { type: 'string', description: 'The text to measure.' } }, required: ['text'], additionalProperties: false },
      run: ({ text }) => JSON.stringify({ words: words(text), characters: (text || '').length, sentences: sentences(text) }),
    },
  ],

  activate(api) {
    const label = (text) => {
      const unit = api.settings.get('unit')
      const w = words(text) + (words(text) === 1 ? ' word' : ' words')
      const c = (text || '').length + ' chars'
      return unit === 'chars' ? c : unit === 'both' ? w + ' · ' + c : w
    }

    // 1. A live counter beside the send button. The slot hands us the draft and tells us when it changes.
    api.ui.mount('composer.status', (el, ctx) => {
      const chip = api.ui.h('span', { class: 'kp-chip' })
      el.append(chip)
      const render = (data) => {
        const text = (data && data.text) || ''
        const warn = Number(api.settings.get('warnAt')) || 0
        chip.style.display = api.settings.get('showInput') && text.trim() ? '' : 'none'
        chip.textContent = label(text)
        chip.classList.toggle('kp-accent', warn > 0 && words(text) > warn)
      }
      render(ctx.data)
      const offUpdate = ctx.onUpdate(render)
      const offSettings = api.settings.onChange(() => render(ctx.data))
      return () => { offUpdate(); offSettings() }
    })

    // 2. The length of each assistant reply, next to "model · 4.4s".
    api.ui.mount('message.footer', (el, ctx) => {
      const chip = api.ui.h('span', { class: 'kp-chip' })
      el.append(chip)
      const render = (data) => {
        const m = data && data.message
        const show = m && m.role === 'assistant' && m.text && m.text.trim() && api.settings.get('showReplies')
        chip.style.display = show ? '' : 'none'
        if (show) chip.textContent = label(m.text)
      }
      render(ctx.data)
      const offUpdate = ctx.onUpdate(render)
      const offSettings = api.settings.onChange(() => render(ctx.data))
      return () => { offUpdate(); offSettings() }
    })

    // 3. A tab in the side panel (desktop app) that asks your model to improve the draft. api.ai.ask needs the "ai" permission above.
    api.ui.registerPanel({
      id: 'stats',
      title: 'Word stats',
      render: (el) => {
        const out = api.ui.h('div', { class: 'kp-muted' }, 'Type a message, then press the button.')
        const btn = api.ui.h('button', { class: 'kp-btn', style: 'margin-bottom:10px', onClick: async () => {
          const draft = (document.querySelector('textarea') || {}).value || ''
          if (!draft.trim()) { out.textContent = 'The message box is empty.'; return }
          out.textContent = 'Asking…'
          try { out.textContent = await api.ai.ask('Give 3 short suggestions to make this message clearer:\n\n' + draft) } catch (e) { out.textContent = String(e.message || e) }
        } }, 'Suggest improvements for my draft')
        el.append(btn, out)
      },
    })

    // 4. A button in the message box that opens a window with statistics about the draft.
    api.ui.addButton({
      title: 'Statistics for your draft',
      icon: 'Aa',
      onClick: (draft) => {
        const text = (draft && draft.text) || ''
        if (!text.trim()) return api.ui.toast('Type something first.', 'info')
        api.ui.modal({
          title: 'Draft statistics',
          body: words(text) + ' words\n' + text.length + ' characters\n' + sentences(text) + ' sentences\nAbout ' + Math.max(1, Math.round(words(text) / 200)) + ' min to read',
          actions: [{ label: 'Close', primary: true }],
        })
      },
    })
  },
}
`
