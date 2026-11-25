import { connect } from 'cloudflare:sockets'
import type { Env } from './util'

/** Minimal SMTP client over Workers TCP sockets (implicit TLS on 465 or STARTTLS on 587). */

const enc = new TextEncoder()
const dec = new TextDecoder()

class Conn {
  private buf = ''
  private reader: ReadableStreamDefaultReader<Uint8Array>
  private writer: WritableStreamDefaultWriter<Uint8Array>
  constructor(public socket: Socket) {
    this.reader = socket.readable.getReader()
    this.writer = socket.writable.getWriter()
  }
  /** Read one (possibly multi-line) SMTP reply. */
  async reply(): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = []
    for (;;) {
      let i: number
      while ((i = this.buf.indexOf('\r\n')) < 0) {
        const { done, value } = await this.reader.read()
        if (done) throw new Error('SMTP connection closed unexpectedly')
        this.buf += dec.decode(value, { stream: true })
      }
      const line = this.buf.slice(0, i)
      this.buf = this.buf.slice(i + 2)
      lines.push(line)
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) return { code: Number(line.slice(0, 3)), lines }
    }
  }
  async send(cmd: string) { await this.writer.write(enc.encode(cmd + '\r\n')) }
  async cmd(cmd: string, ok: number[]) {
    await this.send(cmd)
    const r = await this.reply()
    if (!ok.includes(r.code)) throw new Error(`SMTP ${cmd.split(' ')[0]} failed: ${r.lines.join(' ')}`)
    return r
  }
  release() { this.reader.releaseLock(); this.writer.releaseLock() }
  close() { try { this.socket.close() } catch { /* ignore */ } }
}

const b64 = (s: string) => btoa(String.fromCharCode(...enc.encode(s)))
const wrap76 = (s: string) => s.replace(/(.{76})/g, '$1\r\n')
const addr = (from: string) => /<([^>]+)>/.exec(from)?.[1] ?? from.trim()
const hdrSafe = (s: string) => s.replace(/[\r\n]+/g, ' ')

export interface Mail { to: string; subject: string; text: string; html: string }

export async function sendMail(env: Env, mail: Mail): Promise<void> {
  if (!env.SMTP_HOST || !env.SMTP_FROM) throw new Error('SMTP is not configured on the server (SMTP_HOST / SMTP_FROM).')
  const port = Number(env.SMTP_PORT || 465)
  const implicit = (env.SMTP_SECURE || 'tls').toLowerCase() === 'tls'
  const socket = connect({ hostname: env.SMTP_HOST, port }, { secureTransport: implicit ? 'on' : 'starttls', allowHalfOpen: false })
  let c = new Conn(socket)

  const work = (async () => {
    const hello = await c.reply()
    if (hello.code !== 220) throw new Error('SMTP greeting failed: ' + hello.lines.join(' '))
    let ehlo = await c.cmd('EHLO kokochat-sync.workers.dev', [250])
    let secure = implicit
    if (!implicit) {
      if (/STARTTLS/i.test(ehlo.lines.join(' '))) {
        await c.cmd('STARTTLS', [220])
        c.release()
        c = new Conn(socket.startTls())
        ehlo = await c.cmd('EHLO kokochat-sync.workers.dev', [250])
        secure = true
      } else if (!/^(localhost|127\.0\.0\.1)$/.test(env.SMTP_HOST)) {
        throw new Error('The SMTP server does not offer STARTTLS; refusing to send credentials in plain text.')
      }
    }
    void secure
    if (env.SMTP_USER && env.SMTP_PASS) {
      const caps = ehlo.lines.join(' ').toUpperCase()
      if (caps.includes('AUTH') && !/AUTH[^\r\n]*PLAIN/.test(caps) && /AUTH[^\r\n]*LOGIN/.test(caps)) {
        await c.cmd('AUTH LOGIN', [334])
        await c.cmd(b64(env.SMTP_USER), [334])
        await c.cmd(b64(env.SMTP_PASS), [235])
      } else {
        await c.cmd('AUTH PLAIN ' + b64(`\0${env.SMTP_USER}\0${env.SMTP_PASS}`), [235])
      }
    }
    await c.cmd(`MAIL FROM:<${addr(env.SMTP_FROM)}>`, [250])
    await c.cmd(`RCPT TO:<${mail.to}>`, [250, 251])
    await c.cmd('DATA', [354])

    const boundary = 'kk_' + crypto.randomUUID().replace(/-/g, '')
    const domain = addr(env.SMTP_FROM).split('@')[1] ?? 'localhost'
    const msg = [
      `From: ${hdrSafe(env.SMTP_FROM)}`,
      `To: ${hdrSafe(mail.to)}`,
      `Subject: =?UTF-8?B?${b64(mail.subject)}?=`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@${domain}>`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(b64(mail.text)),
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(b64(mail.html)),
      `--${boundary}--`,
      '',
    ].join('\r\n')
    // base64 bodies never start a line with "." but dot-stuff defensively
    await c.send(msg.replace(/^\./gm, '..') + '.')
    const done = await c.reply()
    if (done.code !== 250) throw new Error('SMTP rejected the message: ' + done.lines.join(' '))
    await c.send('QUIT')
  })()

  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('SMTP timed out')), 20000))
  try { await Promise.race([work, timeout]) } finally { c.close() }
}
