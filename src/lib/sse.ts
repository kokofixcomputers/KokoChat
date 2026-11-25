export async function* sse(res: Response): AsyncGenerator<{ event?: string; data: string }> {
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i: number
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const raw = buf.slice(0, i)
      buf = buf.slice(i).replace(/^\r?\n\r?\n/, '')
      let event: string | undefined
      const data: string[] = []
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
      if (data.length) yield { event, data: data.join('\n') }
    }
  }
}
