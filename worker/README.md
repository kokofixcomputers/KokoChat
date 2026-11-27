# Koko Chat sync worker

A small Cloudflare Worker that syncs your chats, artifacts, provider keys, tool/voice/image
settings, selected model, MCP servers and theme between devices. Sign-in is by **email one-time
code** sent through **your own SMTP server**.

- **D1** (SQLite) holds everything: users, sessions, one-time codes, the per-item revision index and the item payloads (split into chunks, so a single chat can be larger than D1's 2 MB row limit).
- **Storage quota:** each account may store 3 MB (`QUOTA_BYTES`, in bytes). The app shows usage in Settings → Sync.
- No cookies: the app sends `Authorization: Bearer <session token>`.

## Deploy

```bash
cd worker
npm install

# 1. Create the database
npx wrangler d1 create kokochat          # copy the database_id it prints into wrangler.toml
npm run db:init                          # applies schema.sql to the remote database

# 2. Configure email (see below), then
npx wrangler secret put SMTP_PASS
npm run deploy
```

Then in the app: **Settings → Sync**, paste your worker URL
(`https://kokochat-sync.<you>.workers.dev`), enter your email, type the 6-digit code.

## Email / SMTP settings

Set these in `wrangler.toml` under `[vars]` (or in the Cloudflare dashboard → Worker →
Settings → Variables). `SMTP_PASS` is a **secret**: use `wrangler secret put SMTP_PASS`.

| Name | Example | Notes |
| --- | --- | --- |
| `SMTP_HOST` | `smtp.fastmail.com` | required |
| `SMTP_PORT` | `465` | 465 (implicit TLS) or 587 (STARTTLS). **Port 25 is blocked by Cloudflare.** |
| `SMTP_SECURE` | `tls` or `starttls` | `tls` for 465, `starttls` for 587 |
| `SMTP_USER` | `you@example.com` | |
| `SMTP_PASS` | secret | app password |
| `SMTP_FROM` | `Koko Chat <you@example.com>` | must be allowed by your SMTP provider |
| `ALLOWED_EMAILS` | `you@example.com,me@example.org` | optional allow-list. **Set this**, otherwise anyone who finds your worker URL can create an account and store data. |
| `ALLOWED_ORIGINS` | `https://chat.example.com` | optional; origins allowed to call the API (`*` by default) |
| `APP_NAME` | `Koko Chat` | shown in the email |
| `ADMIN_EMAILS` | `you@example.com,me@example.org` | optional; these emails get an **Admin** tab in the app (see below). Admins can always sign in, even if they are not in `ALLOWED_EMAILS`. |
| `FREESTYLE_API_KEY` | secret | optional; used for admins who don't send their own key (sandbox) |
| `QUOTA_BYTES` | `3145728` | per-account storage cap (3 MB) |
| `VIEWER_URL` | `https://kokochat.pages.dev` | the deployed web app; published chart and diagram pages load their viewer from it |

Any SMTP provider works (Fastmail, Gmail app password, Resend/Postmark/SES SMTP, Mailgun…).

## Local development

```bash
cp .dev.vars.example .dev.vars        # fill in SMTP, or set DEV_LOG_CODES=true
npm run db:init:local
npm run dev                           # http://localhost:8787
```

With `DEV_LOG_CODES=true` the one-time code is printed in the worker log instead of emailed.
**Never enable that in production.**

## Admin mode

Put your email(s) in `ADMIN_EMAILS` and redeploy. After signing in with one of those addresses the
app shows **Settings → Admin**, where you can:

- see every registered user: email, join date, last sync, item count, active sessions and storage used,
- **change a user's quota** (or reset it to the default),
- **suspend / reactivate** a user (suspending signs them out and blocks sign-in),
- **sign a user out everywhere**,
- **delete a user** and all of their synced data.

The list is checked against `ADMIN_EMAILS` on every request, so removing an address revokes access
immediately. Admins can't suspend or delete themselves. A deleted user can sign up again unless
`ALLOWED_EMAILS` excludes them.

Upgrading an existing database? Run once:

```bash
npx wrangler d1 execute kokochat --remote --file=./migrations/0002_admin.sql
```

Publishing charts and diagrams needs the `kind` column. Run it once, **before** deploying the worker (and deploy the web app
too, since the published pages load `/viewer/viewer.js` from it):

```bash
npx wrangler d1 execute kokochat --remote --file=./migrations/0005_artifact_kind.sql
```

## Sandbox (Freestyle) proxy

The app's AI sandbox runs commands in [Freestyle](https://www.freestyle.sh) VMs. Freestyle's API
doesn't accept an `Authorization` header from browsers (CORS), so the app calls
`/v1/sandbox/v5/...` on this worker, which forwards a small allow-list of Freestyle endpoints
(VMs, exec, files, TLS rules). It requires a signed-in session. Each user pastes **their own**
Freestyle API key in Settings → Tools → Sandbox; it is sent per request in `X-Freestyle-Key` and is
never stored by the worker. Admins can alternatively set a worker secret
(`npx wrangler secret put FREESTYLE_API_KEY`) and leave the key field empty.

## How syncing and conflicts work

Each synced thing is an item: `settings`, `selected`, `provider:<id>`, `mcp:<id>`, `chat:<id>`.
The server stores a revision number per item and only accepts a write whose `baseRev` matches
(optimistic concurrency). Each device remembers the last revision and content it saw per item, so
it can do a three-way merge:

- **Only this device changed an item** → pushed.
- **Only the server changed it** → pulled.
- **Both changed it** →
  - **chats**: all messages from both sides are kept (by message id, ordered by time). A chat
    created on each device simply becomes two chats. Messages you deleted stay deleted.
  - **settings / providers / MCP servers**: merged field by field; if both devices changed the very
    same field, the device that is syncing wins.
- **Deleted on one device** → deleted everywhere, unless the other device edited it meanwhile
  (then the edit is kept).

Optional **end-to-end encryption**: set a passphrase in Settings → Sync (same on every device).
Payloads are encrypted in the browser with AES-GCM (key derived with PBKDF2), so the worker only ever sees ciphertext. A lost passphrase cannot be recovered.

## API

All routes are under `/v1`. `Authorization: Bearer <token>` is required except for auth.

| Method | Path | Body | |
| --- | --- | --- | --- |
| POST | `/auth/request` | `{email}` | emails a 6-digit code (valid 10 min, 30 s cooldown, 6/hour) |
| POST | `/auth/verify` | `{email, code}` | returns `{token, email, salt}` |
| POST | `/auth/logout` | | |
| GET | `/me` | | `{email, salt, usage, admin}` |
| GET | `/sync/index` | | `{items: {key: {rev, deleted, updatedAt, size}}, usage: {used, quota}}` |
| POST | `/sync/get` | `{keys: [...]}` | payloads (max 25 keys) |
| POST | `/sync/put` | `{changes: [{key, baseRev, data, deleted?}]}` | per-key `ok` / `conflict` / `quota` |
| GET | `/admin/users` | | admin only: all users with usage |
| POST | `/admin/users/:id/quota` | `{quotaBytes \| null}` | admin only |
| POST | `/admin/users/:id/disable` | `{disabled}` | admin only |
| DELETE | `/admin/users/:id/sessions` | | admin only: sign out everywhere |
| DELETE | `/admin/users/:id` | | admin only: delete user and data |
| DELETE | `/account` | | deletes all cloud data for the account |
