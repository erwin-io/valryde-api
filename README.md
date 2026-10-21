# Valryde API

Fastify and PostgreSQL/PostGIS business API for Valryde, the public jeepney route live-tracking and fleet-monitoring platform.

This repository owns application identity, RBAC, business entities, official transit routes, approval workflows, API contracts, and audit records. Traccar remains authoritative for raw GPS positions, events, and history.

## Current implementation

The Agent A local backend now covers the foundation and API contracts for MVP checklist IDs 1-11:

- TypeScript, Fastify 5, TypeBox request/response schemas, and generated OpenAPI documentation
- direct `pg` database access with explicit SQL migrations
- PostgreSQL identity schema plus the initial PostGIS route-direction schema
- email/password registration, email verification, login, logout, password recovery, and password change
- short-lived access JWTs with credentials-version checks
- opaque, hashed, rotating refresh tokens with family revocation on replay
- Google ID-token verification and local identity linking
- server-authoritative RBAC for `COMMUTER`, `DRIVER`, `OPERATOR`, and `ADMIN`
- own-profile reads/updates, verified email changes, and Admin account enable/disable
- audit records for security-sensitive account mutations
- operator-scoped jeepneys, fleet groups, group membership, and transactional driver assignments
- Admin-owned transit routes and directions using validated GeoJSON `LineString` geometry in SRID 4326
- public active-route reads and operator-scoped jeepney/group route-direction assignments
- individual vehicle applications and Admin approval/rejection
- GPS request approval, scheduling, installation, unique IMEI/serial/Traccar mapping, and verification
- a hard activation gate: a jeepney becomes `ACTIVE` only after mapping plus power, SIM, server, and GPS-fix checks all pass

Email delivery uses a provider-neutral application interface with an SMTP adapter. Local development uses Mailpit; production provider settings remain environment-only. The API stores only hashed verification/recovery challenges and never logs the raw token.

## Requirements

- Node.js 22.12 or newer
- PostgreSQL 16 or newer
- PostGIS installed in the target PostgreSQL server
- a dedicated Valryde application database; do not point this API at the Traccar database

Valryde-owned tables are stored in the `dbo` schema. PostgreSQL extensions remain in `public`, and application connections use the search path `dbo,public`.

## Local setup

1. Copy `.env.example` to `.env` and replace the placeholder database URL, JWT secret, and SMTP settings. Interactive development uses a real authenticated SMTP provider; keep credentials only in the ignored `.env`.
2. Create an empty PostgreSQL database for Valryde.
3. Install dependencies and apply migrations:

   ```powershell
   npm install
   npm run db:migrate
   ```

4. Start the development server:

   ```powershell
   npm run dev
   ```

The health endpoint is `GET /api/health`. Interactive OpenAPI documentation is available at `/documentation`.

### Email delivery

Local development, preview/staging, and production all use the same provider-neutral SMTP implementation. Configure an authorized sender, provider host/port/TLS mode, credentials, and reachable application links through environment variables. See [Unified email delivery environments](docs/integration/AGENT_A_UNIFIED_EMAIL_DELIVERY.md) for the environment matrix, Gmail development example, frontend callback decision, seed exception, and validation gates.

Do not commit `.env`, provider credentials, App Passwords, or challenge tokens. Preview and production must use separate secrets, databases, sender configuration, and public HTTPS callback URLs.

### Optional Mailpit integration-test override

Mailpit remains available for automated/integration testing. It is not the default interactive development transport.

Start the local-only mail catcher:

```powershell
docker compose -f compose.mailpit.yaml up -d
```

On Windows without Docker, install the official package with `winget install --id axllent.mailpit --exact`, open a new terminal, and run `mailpit --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025`.

Temporarily override the SMTP host with `127.0.0.1`, port `1025`, and `SMTP_SECURE=false`; remove `SMTP_USER` and `SMTP_PASSWORD` unless the test server requires authentication. Captured messages are visible at `http://127.0.0.1:8025`. Restore the real SMTP profile before interactive development resumes.

Real SMTP credentials must be supplied only through the local ignored environment or deployment secret store. Never place credentials or authentication challenge tokens in source files, logs, documentation, Postman assets, screenshots, or command arguments.

## Create the first Admin

After migrations have been applied, create the first internal Admin with temporary environment variables. Do not put the password in a command argument or save it in `.env`:

```powershell
$env:ADMIN_BOOTSTRAP_EMAIL = 'admin@example.com'
$env:ADMIN_BOOTSTRAP_DISPLAY_NAME = 'Valryde Administrator'
$env:ADMIN_BOOTSTRAP_PASSWORD = Read-Host 'Temporary Admin password' -MaskInput
$env:ADMIN_BOOTSTRAP_CONFIRM = 'CREATE_FIRST_ADMIN'

try {
  npm run admin:bootstrap
} finally {
  Remove-Item Env:ADMIN_BOOTSTRAP_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:ADMIN_BOOTSTRAP_DISPLAY_NAME -ErrorAction SilentlyContinue
  Remove-Item Env:ADMIN_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:ADMIN_BOOTSTRAP_CONFIRM -ErrorAction SilentlyContinue
}
```

The exact `ADMIN_BOOTSTRAP_CONFIRM` value is a deliberate one-time authorization guard. The password must contain 12 to 128 characters. The command creates a verified, active `ADMIN` account with an Argon2id password hash and an `ADMIN_BOOTSTRAPPED` audit record. It does not use public registration and does not dispatch an email. It is safe to rerun for the same active, verified Admin and will make no changes. It refuses to promote an existing non-Admin account or create a second initial Admin; additional Admin access must use a separately reviewed internal process. Never use a predictable default password, especially in preview or production.

## Verification

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Database integration tests run when `TEST_DATABASE_URL` is set. The target database must already have the migrations applied. CI uses a temporary PostGIS database and runs migrations before tests.

The automated suite removes all generated test entities, including audit records and device mappings. Physical tracker installation, connectivity, and the live Traccar bridge remain operator-gated checks outside this repository's automated tests.

## Security boundaries

- Public registration permits only Commuter, Driver, and Operator roles. Admin creation is an internal operational process.
- Client-supplied role or ownership identifiers never replace server-side authorization checks.
- Access tokens are rejected when a user is disabled, unverified, missing, or has a newer credentials version.
- Password reset, password change, verified email change, and account disablement revoke refresh sessions.
- Google sign-in uses Google's verified `sub` as the provider identifier and validates the configured audience.
- Logs redact authorization headers, cookies, passwords, refresh tokens, Google tokens, and challenge tokens.
- The API never returns raw Traccar credentials, SIM credentials, password hashes, or challenge hashes.

## Repository workflow

Agent work remains local and on focused branches until it is ready for Tech Lead review. Developer agents do not merge their own pull requests. Database migrations are versioned and must be reviewed before deployment.
