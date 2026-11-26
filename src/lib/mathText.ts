/**
 * Prepares model output for remark-math. This file alone decides what is maths: `$…$`, `$$…$$`, `\(…\)` and `\[…\]` are
 * all rewritten to the `$$` form, and every other `$` is escaped (remark-math runs with single dollars off).
 * Code blocks and inline code are left untouched.
 */

const FENCE = /^(?:[ \t]*(?:>|[-*+][ \t]|\d+[.)][ \t]))*[ \t]*(`{3,}|~{3,})(.*)$/
const CONTAINER = /^(?:[ \t]|>|(?:[-*+]|\d+[.)])[ \t]+)*/
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]/
const BLANK_LINE = /\n[ \t>]*\n/

export interface Prepared { text: string; math: boolean }

export function prepareMarkdown(md: string, cites = false): Prepared {
  let out = ''
  let math = false
  let prose = ''
  const flush = () => {
    if (!prose) return
    const r = scan(prose, cites)
    out += r.text
    math ||= r.math
    prose = ''
  }

  // Split off fenced and indented code blocks line by line; everything else goes through the scanner.
  let fence = '', indented = false, blankBefore = true, inList = false
  for (const line of md.split(/(?<=\n)/)) {
    const bare = line.replace(/\r?\n$/, '')
    const f = FENCE.exec(bare)
    if (fence) {
      out += line
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) { fence = ''; blankBefore = true }
      continue
    }
    if (f && !(f[1][0] === '`' && f[2].includes('`'))) {
      flush()
      fence = f[1]
      if (/^math\b/.test(f[2].trim())) math = true
      out += line
      continue
    }
    const blank = !bare.trim()
    if (LIST_ITEM.test(bare)) inList = true
    else if (!blank && !/^[ \t]/.test(bare)) inList = false
    if (/^(?: {4}|\t)/.test(bare) && !inList && (indented || blankBefore)) {
      flush()
      indented = true
      out += line
      continue
    }
    if (!blank) indented = false
    blankBefore = blank
    prose += line
  }
  flush()
  return { text: out, math }
}

function scan(s: string, cites: boolean): Prepared {
  let out = ''
  let plain = ''
  let math = false
  let i = 0
  // Citation markers are only linked in plain text, so `\sqrt[3]{x}` stays intact.
  const flush = () => {
    out += cites ? plain.replace(/\[(\d{1,3})\](?!\()/g, '[$1](#cite-$1)') : plain
    plain = ''
  }
  const keep = (to: number) => { plain += s.slice(i, to); i = to }
  const verbatim = (to: number) => { flush(); out += s.slice(i, to); i = to }

  const paragraphEnd = (from: number) => {
    const m = BLANK_LINE.exec(s.slice(from))
    return m ? from + m.index : s.length
  }

  /** Index of the next unescaped `close` before `end`, or -1. */
  const find = (close: string, from: number, end: number) => {
    for (let j = from; j < end; j++) {
      if (s.startsWith(close, j)) return j
      if (s[j] === '\\') j++
    }
    return -1
  }

  const inline = (tex: string, to: number) => {
    flush()
    out += '$$' + tex.replace(/\s*\n[ \t>]*/g, ' ').trim() + '$$'
    math = true
    i = to
  }

  /** `$$…$$` or `\[…\]` starting at `i`. */
  const display = (close: string) => {
    const lineStart = s.lastIndexOf('\n', i - 1) + 1
    const before = s.slice(lineStart, i)
    const prefix = CONTAINER.exec(before)![0]
    const startsLine = prefix === before
    const nl = s.indexOf('\n', i + 2)
    const alone = startsLine && !s.slice(i + 2, nl < 0 ? s.length : nl).trim()
    // An opener on its own line may have blank lines inside; otherwise stay within the paragraph.
    let end = find(close, i + 2, alone ? s.length : paragraphEnd(i))
    const tex = end < 0 ? '' : s.slice(i + 2, end)
    if (end < 0 || !tex.trim()) {
      if (end < 0 && startsLine) {
        // Still streaming (or never closed): show the source exactly as written until the closer arrives.
        const stop = paragraphEnd(i)
        flush()
        out += literal(s.slice(i, stop))
        i = stop
      } else {
        plain += close === '$$' ? '\\$\\$' : s.slice(i, i + 2)
        i += 2
      }
      return
    }
    end += 2
    // Tables and headings are single lines, so the maths has to stay inline there.
    const rest = before.slice(prefix.length)
    if (/^(\||#{1,6}\s)/.test(startsLine ? s.slice(i - before.length + prefix.length, i + 1) : rest)) return inline(tex, end)
    const indent = prefix.replace(/[^ \t>]/g, ' ')
    const quoted = indent.includes('>')
    const lines = tex.split('\n').map((l) => (quoted ? l.replace(/^[ \t]*(?:>[ \t]?)+/, '') : l).trim()).filter(Boolean)
    flush()
    if (!startsLine) out = out.replace(/[ \t]+$/, '') + '\n' + indent
    out += ['$$', ...lines, '$$'].join('\n' + indent)
    math = true
    i = end
    const tail = /^[ \t]*/.exec(s.slice(i))![0].length
    if (i + tail < s.length && s[i + tail] !== '\n') { out += '\n' + indent; i += tail }
  }

  /**
   * A single `$`, with the usual rules for telling maths from money: no space just inside either dollar, the closer is on
   * the same line and is not followed by a letter or digit. "$5 and $10" fails them and stays text.
   */
  const dollar = () => {
    const nl = s.indexOf('\n', i)
    const end = s[i + 1] && !/\s/.test(s[i + 1]) ? find('$', i + 1, nl < 0 ? s.length : nl) : -1
    if (end > 0 && !/\s/.test(s[end - 1]) && !/[\p{L}\p{N}$]/u.test(s[end + 1] ?? '')) {
      const tex = s.slice(i + 1, end)
      // "$USER and US$": words with spaces and nothing mathematical is prose
      const prose = /\s/.test(tex) && /\p{L}{2}/u.test(tex) && !/[\\^_=<>{}+*|]/.test(tex)
      if (!prose && !tex.includes('`')) return inline(tex, end + 1)
    }
    plain += '\\$'
    i++
  }

  const LINK = /(?:https?:\/\/[^\s<>()[\]`]+|\]\([^()\s]*(?:\([^()\s]*\)[^()\s]*)*\))/y
  while (i < s.length) {
    const c = s[i]
    if (c === '`') {
      const run = /`+/y
      run.lastIndex = i
      const ticks = run.exec(s)![0]
      const closer = new RegExp('(?<!`)' + ticks + '(?!`)', 'g')
      closer.lastIndex = i + ticks.length
      const m = closer.exec(s.slice(0, paragraphEnd(i)))
      if (m) verbatim(m.index + ticks.length)
      else keep(i + ticks.length)
    } else if (c === '\\') {
      if (s[i + 1] === '[') display('\\]')
      else if (s[i + 1] === '(') {
        const end = find('\\)', i + 2, paragraphEnd(i))
        if (end > 0 && s.slice(i + 2, end).trim()) inline(s.slice(i + 2, end), end + 2)
        else keep(i + 2)
      } else keep(i + 2)
    } else if (c === '$') {
      if (s[i + 1] === '$') display('$$')
      else dollar()
    } else {
      if (c === 'h' || c === ']') {
        LINK.lastIndex = i
        const m = LINK.exec(s)
        if (m) { keep(i + m[0].length); continue }
      }
      plain += c
      i++
    }
  }
  flush()
  return { text: out, math }
}

/** Escape a chunk so markdown prints it as typed. */
const literal = (s: string) => s.split('\n').map((l) => l.trim().replace(/[!-/:-@[-`{-~]/g, '\\$&')).filter(Boolean).join('\\\n')
