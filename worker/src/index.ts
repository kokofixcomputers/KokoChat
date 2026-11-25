import { authenticate, requestCode, verifyCode } from './auth'
import * as sync from './sync'
import * as admin from './admin'
import * as shares from './shares'
import { proxySandbox } from './sandbox'
import { proxyCloudflare } from './cfproxy'
import { transcribe } from './stt'
import * as artifacts from './artifacts'
import { oneMinConfig, oneMinExchange } from './oauth1min'
import { corsHeaders, HttpError, json, type Env } from './util'

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(env, req)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    try {
      const url = new URL(req.url)
      const path = url.pathname.replace(/\/+$/, '')
      const body = async () => { try { return await req.json() } catch { throw new HttpError(400, 'Invalid JSON body') } }
      let res: Response

      if (path === '' || path === '/health') res = json({ ok: true, service: 'kokochat-sync' })
      else if (req.method === 'POST' && path === '/v1/auth/request') res = json(await requestCode(env, await body()))
      else if (req.method === 'POST' && path === '/v1/auth/verify') res = json(await verifyCode(env, await body()))
      else if (req.method === 'GET' && path === '/v1/oauth/1min/config') res = json(oneMinConfig(env))
      else if (req.method === 'POST' && path === '/v1/oauth/1min/exchange') res = json(await oneMinExchange(env, await body()))
      else if (path.startsWith('/v1/cf/')) res = await proxyCloudflare(req, path.slice('/v1/cf'.length))
      else if (req.method === 'GET' && path.startsWith('/artifact/')) res = await artifacts.serve(env, path.slice('/artifact/'.length))
      else if (req.method === 'GET' && path.startsWith('/v1/public/shares/')) res = json(await shares.getPublicShare(env, path.slice('/v1/public/shares/'.length)))
      else {
        const s = await authenticate(env, req)
        if (req.method === 'GET' && path === '/v1/me') {
          const u = await env.DB.prepare('SELECT salt FROM users WHERE user_id = ?').bind(s.userId).first<{ salt: string }>()
          res = json({ email: s.email, salt: u?.salt, usage: await sync.usage(env, s.userId), admin: admin.isAdmin(env, s.email) })
        } else if (req.method === 'POST' && path === '/v1/auth/logout') {
          await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(s.tokenHash).run()
          res = json({ ok: true })
        } else if (req.method === 'GET' && path === '/v1/sync/index') res = json(await sync.index(env, s.userId, admin.isAdmin(env, s.email)))
        else if (req.method === 'POST' && path === '/v1/sync/get') res = json(await sync.get(env, s.userId, await body()))
        else if (req.method === 'POST' && path === '/v1/sync/put') res = json(await sync.put(env, s.userId, await body()))
        else if (req.method === 'DELETE' && path === '/v1/account') { await sync.wipe(env, s.userId); res = json({ ok: true }) }
        else if (req.method === 'POST' && path === '/v1/artifacts') res = json(await artifacts.publish(env, s.userId, await body()))
        else if (req.method === 'GET' && path === '/v1/artifacts') res = json(await artifacts.list(env, s.userId))
        else if (req.method === 'DELETE' && path.startsWith('/v1/artifacts/')) res = json(await artifacts.unpublish(env, s.userId, path.slice('/v1/artifacts/'.length)))
        else if (req.method === 'POST' && path === '/v1/stt') res = await transcribe(env, req)
        else if (req.method === 'POST' && path === '/v1/shares') res = json(await shares.createShare(env, s.userId, await body()))
        else if (req.method === 'GET' && path === '/v1/shares') res = json(await shares.listShares(env, s.userId))
        else if (req.method === 'DELETE' && path.startsWith('/v1/shares/')) res = json(await shares.deleteShare(env, s.userId, path.slice('/v1/shares/'.length)))
        else if (path.startsWith('/v1/sandbox/')) res = await proxySandbox(env, req, s.email, path.slice('/v1/sandbox'.length))
        else if (path.startsWith('/v1/admin/')) {
          // checked on every request against the ADMIN_EMAILS variable, so removing an address revokes access immediately
          if (!admin.isAdmin(env, s.email)) throw new HttpError(403, 'Admin access required.')
          const m = /^\/v1\/admin\/users(?:\/([0-9a-f]{32})(?:\/(quota|disable|sessions))?)?$/.exec(path)
          if (!m) throw new HttpError(404, 'Not found')
          const [, id, action] = m
          if (!id && req.method === 'GET') res = json(await admin.listUsers(env))
          else if (id && !action && req.method === 'DELETE') res = json(await admin.deleteUser(env, id, s.userId))
          else if (id && action === 'quota' && req.method === 'POST') res = json(await admin.setQuota(env, id, await body()))
          else if (id && action === 'disable' && req.method === 'POST') res = json(await admin.setDisabled(env, id, await body(), s.userId))
          else if (id && action === 'sessions' && req.method === 'DELETE') res = json(await admin.revokeSessions(env, id))
          else throw new HttpError(405, 'Method not allowed')
        } else throw new HttpError(404, 'Not found')
      }
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
      return res
    } catch (e: any) {
      const status = e instanceof HttpError ? e.status : 500
      if (status === 500) console.error(e)
      return json({ error: e instanceof HttpError ? e.message : 'Internal error', ...(e?.extra ?? {}) }, status, cors)
    }
  },
}
