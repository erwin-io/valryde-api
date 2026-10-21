# Agent A unified email delivery environments

**Owner:** Agent A — Core Platform / Fastify API (Checklist IDs 1 and 3)  
**Baseline:** `main` at `2e8cc4d36fe1066534e07863c3112ec95688f905`  
**Scope:** Environment standardization and integration guidance. No authentication endpoint, DTO, RBAC rule, database schema, or token contract changes.

## 1. Runtime invariant

Every interactive environment uses the existing `SmtpEmailService` through `EmailNotificationService`:

- local development: real authenticated SMTP;
- preview/staging: real authenticated SMTP with approved external testers;
- production: a dedicated authenticated transactional SMTP provider;
- automated/integration tests only: Mailpit may temporarily replace the real provider;
- controlled direct database seeding only: no notification is sent.

Only one SMTP profile is active in an API process. The application remains provider-neutral. Provider host, port, implicit TLS, credentials, sender, and link destinations come only from environment variables.

## 2. Canonical variables

```dotenv
EMAIL_DELIVERY_MODE=smtp
EMAIL_FROM="VALRYDE <AUTHORIZED_SENDER>"

SMTP_HOST=SMTP_PROVIDER_HOST
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=SMTP_USERNAME
SMTP_PASSWORD=SMTP_SECRET

APP_VERIFICATION_URL=FRONTEND_OR_CALLBACK/auth/verify-email
APP_PASSWORD_RESET_URL=FRONTEND_OR_CALLBACK/auth/reset-password
APP_EMAIL_CHANGE_URL=FRONTEND_OR_CALLBACK/account/confirm-email-change
```

Use `SMTP_PASSWORD`, never `SMTP_PASS`. `SMTP_USER` and `SMTP_PASSWORD` must either both be present or both be absent. Real interactive profiles require both. Keep TLS certificate validation enabled; the adapter does not set a TLS bypass.

### Controlled Gmail development example

```dotenv
EMAIL_DELIVERY_MODE=smtp
EMAIL_FROM="VALRYDE <AUTHORIZED_GMAIL_ADDRESS>"
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=AUTHORIZED_GMAIL_ADDRESS
SMTP_PASSWORD=OWNER_CONFIGURED_APP_PASSWORD
```

The owner writes the App Password directly to the ignored local `.env`. It must never be pasted into chat, Git, screenshots, test fixtures, Postman files, or command arguments.

## 3. Environment profiles

| Profile | SMTP and data isolation | Link requirements | Operational rule |
|---|---|---|---|
| Local development | Real authenticated development sender; isolated local PostgreSQL/PostGIS | A frontend/callback actually reachable by the browser running the email link | Restrict recipients to owner-approved test inboxes. Mailpit is an explicit temporary test override only. |
| Preview/staging | Separate provider credentials, sender identity, secrets, and staging database | Public HTTPS preview callback | Only approved external testers; never reuse production credentials or database. |
| Production | Dedicated transactional provider, production secret store and production database | Stable production HTTPS callback | Configure SPF/DKIM/DMARC and provider-authorized sender/domain; monitor bounces and provider limits. |

Never modify a live environment merely by merging this documentation. Deployment secrets and sender/domain authorization remain owner-controlled operations.

## 4. Optional Mailpit test override

```dotenv
EMAIL_DELIVERY_MODE=smtp
EMAIL_FROM="VALRYDE <no-reply@valryde.local>"
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURE=false
```

Remove `SMTP_USER` and `SMTP_PASSWORD` unless the test server explicitly requires them. CI does not configure SMTP and injects test notification services, so routine tests cannot send external email. Do not leave Mailpit active as the normal interactive profile.

## 5. Frontend callback decision

The current three `APP_*_URL` values form a single callback set. They cannot independently select Agent C, D, or E per recipient. The safe contract-compatible choice is one role-neutral web callback origin that implements all three routes and then lets the user return to the appropriate app.

Current repository evidence:

- Agent C implements `/auth/verify-email`, `/auth/reset-password`, and `/account/confirm-email-change` and is the current complete callback candidate.
- Agent D implements verification and reset routes, but not the email-change callback; its Capacitor Android origin is `https://localhost`.
- Agent E does not currently own public email-action routes and Admin accounts are internally bootstrapped.

For browser-only local testing, start Agent C at `http://localhost:4200` before using the existing local URLs. Those URLs are not reachable from a physical Android device merely because the API runs on the development computer. Physical-device, preview, and production tests require an owner-approved reachable HTTPS callback.

No arbitrary redirect URL may be accepted from a public auth request. If native per-role deep links are later required, propose a server-selected, allowlisted destination based on trusted challenge/account data through Tech Lead change control. Do not implement a client-supplied redirect parameter.

## 6. Seed-account exception audit

The only non-test account seeder is `npm run admin:bootstrap`.

- It calls `bootstrapFirstAdmin()` directly; it does not call `AuthService.register()` or any notification service.
- It inserts one verified, active Admin because public Admin registration is forbidden.
- It requires `ADMIN_BOOTSTRAP_CONFIRM=CREATE_FIRST_ADMIN` and an owner-supplied 12–128 character password.
- It hashes the password with Argon2id.
- It records `ADMIN_BOOTSTRAPPED` with `{ "source": "INTERNAL_CLI" }` in `audit_logs`.
- It refuses a second Admin or promotion of an existing non-Admin account.
- It sends no registration, recovery, or email-change notification.

This is the approved controlled no-email exception. Do not add public verification bypasses, predictable default passwords, or seed accounts through normal registration. Test factories use injected repositories/notification captures and non-production addresses; they are not runtime seeders.

## 7. Delivery and failure behavior

- Registration persists the account even when delivery fails; the account remains unverified and resend can retry.
- Verification resend and password recovery retain generic public responses to prevent account enumeration.
- Failed challenges are invalidated and `AUTH_EMAIL_DELIVERY_FAILED` is audited without provider credentials or raw token data.
- Email-change delivery failure returns `503 EMAIL_DELIVERY_UNAVAILABLE` without provider details.
- Verification/reset/email-change tokens are random, stored only as hashes, expire, and cannot be reused after consumption.
- Registration and recovery rate limits remain enforced; `429 RATE_LIMITED` preserves `retry-after`.

## 8. Validation gates

Report each environment independently:

| Gate | Evidence required |
|---|---|
| `SMTP_CONFIG_READY` | Complete environment variables, authorized sender, reachable callback, secret isolation. |
| `REAL_SMTP_AUTHENTICATED` | Provider authentication succeeds without credential disclosure. |
| `REAL_EMAIL_DELIVERED` | Approved external inbox receives a message. |
| `REGISTRATION_VERIFICATION_PASSED` | COMMUTER, DRIVER, and OPERATOR register through the public API and consume real verification messages. |
| `PASSWORD_RECOVERY_PASSED` | Real reset message is received, reset succeeds, old password fails, new password succeeds. |
| `SEED_NO_EMAIL_VERIFIED` | Bootstrap audit/test confirms direct Admin creation and no notification path. |
| `AGENT_D_INTEGRATION_READY` | Real DRIVER/OPERATOR accounts are verified, API URL and callback origin are reachable, and credentials are handed over through an owner-approved secure channel. |

Mailpit or mocked notification results must be labeled as local test evidence, never as real external delivery.

## 9. Agent D handoff

After the real gates pass, provide Agent D only:

- environment name and development API base URL;
- verified DRIVER/OPERATOR account identifiers and verification state;
- `/api/auth/login`, `/refresh`, `/logout`, `/me`, `/forgot-password`, and `/reset-password` availability;
- chosen callback URLs and required `https://localhost` CORS origin for Capacitor;
- known network/deep-link limitations.

Passwords and refresh/access tokens must travel only through an owner-approved secure local method and must never enter GitHub, this document, status reports, or chat transcripts.
