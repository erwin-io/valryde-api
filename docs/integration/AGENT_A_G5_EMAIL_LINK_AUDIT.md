# Agent A — G5 Mobile Email Link Audit

**Checklist:** ID 1 (gap G5) · **Audited base:** `main` `827738c0f2c33ad3082f6a4a38a8e35669d4b0ea` · **Date:** 2026-10-22
**Approved contract applied:** `docs/integration/AGENT_A_UNIFIED_EMAIL_DELIVERY.md` (PR #11): preview/production use public HTTPS callbacks; no client-supplied redirect.

## 1. Current link contract (unchanged)

| Challenge | Callback setting | Client exchange |
|---|---|---|
| `VERIFY_EMAIL` | `APP_VERIFICATION_URL` | `POST /api/auth/verify-email` `{ token }` |
| `RESET_PASSWORD` | `APP_PASSWORD_RESET_URL` | `POST /api/auth/reset-password` `{ token, password }` |
| `VERIFY_EMAIL_CHANGE` | `APP_EMAIL_CHANGE_URL` | `POST /api/auth/confirm-email-change` `{ token }` |

The server appends one query parameter, `token`, to the configured URL (`src/services/notification-service.ts`). The client page reads it and posts it in a JSON body. The token is never accepted in a query string or path by the API.

## 2. Audit results

| Check | Result | Evidence |
|---|---|---|
| Token is random and stored hashed | PASS | 32 random bytes (`randomToken`), SHA-256 `tokenHash` in `src/lib/crypto.ts`; only `token_hash` is persisted. |
| Single use | PASS | `consumeChallenge` is one `UPDATE … WHERE consumed_at IS NULL AND expires_at > now()`, so concurrent replays cannot both succeed. |
| Expiry | PASS | `AUTH_CHALLENGE_TTL_MINUTES` (default 30) enforced in SQL. |
| Supersession | PASS | Issuing a new challenge consumes earlier open challenges of the same type for the user. |
| Resend/recovery throttling | PASS | Per-route rate limits plus `AUTH_RESEND_COOLDOWN_SECONDS`. |
| No client-supplied redirect/callback | PASS | No auth route accepts a redirect, callback, `returnUrl` or `next` parameter; destinations come only from server configuration. |
| Callback scheme restricted to `http`/`https` | PASS | `javascript:`, custom schemes such as `valryde://` are rejected at startup. |
| **Production callback must be HTTPS** | **FIXED** | Previously `http:` was accepted in every environment, so a production link could send the token in cleartext. Now `NODE_ENV=production` refuses to start unless each `APP_*_URL` is `https:`. |
| **No credentials in callback URL** | **FIXED** | Previously `https://user:pass@host/...` was accepted and would be mailed to every recipient. Now rejected in every environment. |
| HTML injection in email body | PASS | URL is HTML-escaped before insertion. |

Development and test keep `http://localhost:4200` callbacks and the Mailpit profile; only production is stricter.

## 3. Owner / client dependencies (not implemented here)

1. **Production and preview callback domain.** Owner chooses the HTTPS host(s). Nothing is hard-coded.
2. **Opening the mobile apps from an email.** Use verified HTTPS links (Android App Links with `/.well-known/assetlinks.json`; iOS Universal Links with `apple-app-site-association`) on that owner-chosen host. The API does not need a custom app scheme and still rejects one. The `.well-known` files and the app's intent filters belong to the hosting owner and Agents C/D.
3. **Per-role destinations** (Commuter vs Driver app) are not supported by one URL per challenge type. If required, propose a server-selected, allowlisted destination keyed on the stored account role through Tech Lead change control, as the approved contract already states. Not implemented.
4. **Client page hygiene** (Agents C/D/E): the landing page should set `Referrer-Policy: no-referrer`, avoid loading third-party resources before the exchange, and remove `token` from the address bar with `history.replaceState` after posting it.
5. **Agent D email-change route:** still not implemented by Agent D (per the unified email handoff).

## 4. Tests

`test/config.test.ts` — `Email callback URLs`: production rejects `http:`; production accepts `https:` and development accepts `http://localhost`; embedded credentials rejected; `javascript:` and `valryde://` rejected.
