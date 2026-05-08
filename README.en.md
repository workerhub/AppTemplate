# AppTemplate

A full-stack application template built on **React 19** + **Cloudflare Workers** (Hono.js), ready to use as a starting point for new projects.

## Features

- **Authentication** — Email/password login, registration (with on/off switch), logout, password reset
- **2FA** — TOTP (authenticator app), Passkey (WebAuthn biometrics), Email OTP
- **Admin Panel** — User management (roles, activate/deactivate, impersonate), system settings, email configuration, security settings
- **User Settings** — Language (zh/en), light/dark/system theme, timezone, session management
- **Sessions** — Multi-device session listing and revocation
- **i18n** — Chinese and English, auto-detected from browser
- **Theme** — Light / Dark / System via ThemeProvider
- **Database** — Cloudflare D1 (SQLite) with optional table prefix for shared DB isolation

## Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS v4, shadcn/ui, React Router v7, react-i18next
- **Backend**: Cloudflare Workers, Hono.js, D1 (SQLite), KV
- **Auth**: JWT (access + refresh tokens, HttpOnly cookies), bcrypt, WebAuthn

## Quick Start

### 1. Clone and rename

```bash
git clone <this-repo> my-app
cd my-app
# Replace "app-template" and "AppTemplate" with your app name
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure Wrangler

Edit `worker/wrangler.toml`:
- Set your `account_id`
- Create a D1 database and set `database_id`
- Create a KV namespace and set its `id`

### 4. Set secrets

```bash
cd worker
wrangler secret put JWT_SECRET       # random 32+ char string
wrangler secret put SETUP_SECRET     # random string for DB init
```

### 5. Initialize the database

```bash
# Deploy first, then call setup:
curl -X POST https://your-worker.workers.dev/api/setup \
  -H "X-Setup-Secret: your-setup-secret"
```

### 6. Start development

```bash
pnpm dev
```

## Adding Business Logic

### New API route (backend)

1. Create `worker/src/routes/myfeature.ts`
2. Import and register in `worker/src/index.ts`:
   ```ts
   import { myFeatureRoutes } from './routes/myfeature'
   app.route('/api/myfeature', myFeatureRoutes)
   ```

### New page (frontend)

1. Create `web/src/pages/myfeature/MyFeaturePage.tsx`
2. Add route in `web/src/App.tsx`
3. Add nav item in `web/src/components/layout/AppLayout.tsx`

### Extend the database schema

1. Add tables to `worker/src/db/schema.sql`
2. Add the same CREATE TABLE statements to `getSchema()` in `worker/src/routes/setup.ts`
3. Add query functions in `worker/src/db/queries/`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Secret for signing JWTs (set via wrangler secret) |
| `SETUP_SECRET` | Secret for calling the setup endpoint |
| `TABLE_PREFIX` | Optional prefix for all DB table names (e.g. `myapp_`) |
