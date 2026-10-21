# Tracking Bridge — Windows development operations (Stage 13a)

Agent B, IDs 13/14 (with 15/16 normalization groundwork). Scope: the approved Windows Traccar 6.16.0 development host only. Ubuntu/Vultr and Neon connectivity are out of scope for 13a.

## What runs

`src/bridge.ts` is a separate long-running Node.js process. The Fastify API never imports or starts it, and it must not be deployed to Vercel or any serverless runtime.

It:

1. Logs in to Traccar REST (`POST /api/session`) with the read-only service account and keeps the `JSESSIONID` cookie in process memory only.
2. Opens `ws(s)://<TRACCAR_BASE_URL host>/api/socket` using Node 22's built-in WebSocket. The cookie travels in the upgrade `Cookie` header, never in the URL, and no `Origin` header is sent. The bridge never requests Traccar `logs`.
3. On every (re)connect, rebuilds the device registry from `GET /api/devices` and reconciles `GET /api/positions` before applying queued socket frames in arrival order.
4. Validates frames and items. A bad item is skipped while its valid siblings are kept. A malformed, oversized or wrongly shaped frame closes the socket and forces a fresh reconnect and reconciliation.
5. Orders positions per device strictly by GPS `fixTime`. Duplicates, equal-time fixes, older fixes, `valid=false` fixes and fixes more than 5 s in the future are counted and dropped. Native events are deduplicated by ID.
6. Hands accepted telemetry to a sink. **Stage 13a only logs batch counts; nothing is persisted.** Latest-state persistence is Stage 13b.

Lifecycle states: `STOPPED → AUTHENTICATING → CONNECTING → RECONCILING → RUNNING`, with `BACKOFF` between attempts and `STOPPING` on shutdown.

## Configuration

Settings come from the process environment or a git-ignored `.env` in the working directory. Copy keys from `.env.example`; never commit values.

| Key | Default | Meaning |
|---|---|---|
| `TRACCAR_BASE_URL` | required | `http://127.0.0.1:8082` on the dev host. Remote hosts must use HTTPS. |
| `TRACCAR_EMAIL` / `TRACCAR_PASSWORD` | required | **Read-only service account only.** Never the admin account, never the Traccar JDBC role. |
| `BRIDGE_HEALTH_PORT` | `0` (off) | Loopback health listener, for example `8091`. |
| `BRIDGE_CONNECT_TIMEOUT_MS` | 5000 | Upgrade must open within this time. |
| `BRIDGE_SILENCE_TIMEOUT_MS` | 120000 | Traccar 6.16 sends `{}` every 55 s; silence beyond this reconnects. |
| `BRIDGE_RECONNECT_BASE_MS` / `_MAX_MS` | 1000 / 30000 | Exponential backoff with 50–100 % jitter. |
| `BRIDGE_STABLE_RESET_MS` | 60000 | Backoff resets only after this long in `RUNNING`. |
| `BRIDGE_SHUTDOWN_TIMEOUT_MS` | 10000 | Drain deadline; exit code 1 if exceeded. |
| `BRIDGE_MAX_FRAME_BYTES` / `_ITEMS` / `BRIDGE_MAX_QUEUED_FRAMES` | 1 MiB / 1000 / 1000 | Memory bounds; exceeding them forces reconnect and reconciliation. |
| `BRIDGE_FUTURE_TOLERANCE_MS` | 5000 | Clock-skew allowance for future fix times. |
| `TRACCAR_TIMEOUT_MS`, `TRACCAR_MAX_RETRIES`, `TRACCAR_RETRY_*` | see `.env.example` | Per-request REST settings shared with the accepted adapter. |

These are operational settings. They do not change the locked 30 s commuter availability rule or the route-compliance thresholds.

### Credential provisioning

The owner provisions only the read-only service account's email and password into the bridge's private runtime environment: user environment variables for the Windows account that runs the bridge, or a `.env` readable only by that account. Do not grant the bridge access to `C:\ProgramData\VALRYDE\secrets\development.dpapi`, because it also contains admin material. Do not paste credentials into chat, Git, CLI arguments or logs.

## Running

```powershell
npm ci
npm run build
npm run bridge:start      # node dist/bridge.js
```

Use `npm run bridge:dev` (tsx) for development only. Logs are JSON lines on stdout: state changes, reconnect reasons and per-batch counts. Credentials, cookies, device uniqueIds and coordinates are never logged.

### Health

With `BRIDGE_HEALTH_PORT` set:

```powershell
curl.exe -s http://127.0.0.1:8091/health
```

The endpoint returns `200` only in `RUNNING`, otherwise `503`, with state, timestamps, `lastError`, reconnect and failure counts, known device count and counters. It binds `127.0.0.1` only; do not expose it through firewall rules or tunnels. Holding the port also stops a second bridge instance from starting on the host (`EADDRINUSE`). Until Stage 13b adds the database advisory lock, keep the health port enabled or otherwise ensure only one instance runs.

`lastError` values: `AUTHENTICATION`, `FORBIDDEN`, `TIMEOUT`, `NETWORK`, `UNAVAILABLE`, `RATE_LIMITED`, `INVALID_RESPONSE`, `REQUEST_REJECTED`, `CONNECT_TIMEOUT`, `SOCKET_ERROR`, `SOCKET_CLOSED`, `SILENCE_TIMEOUT`, `INVALID_FRAME`, `QUEUE_OVERFLOW`, `SINK_FAILURE`, `UNEXPECTED_ERROR`.

A persistent `AUTHENTICATION` means wrong or revoked service credentials. The bridge keeps retrying at the capped backoff (at most one login per ~15–30 s), so fix the credentials rather than restarting it in a loop.

### Shutdown

Ctrl+C (SIGINT) or SIGTERM stops intake, cancels backoff and connect, closes the socket, drains in-flight sink work up to the deadline, then exits. On Windows, `taskkill /F` or `Stop-Process -Force` terminates immediately without draining. That is acceptable in 13a because nothing is persisted, but from 13b onward prefer a console Ctrl+C.

### Keeping it running (development)

No service wrapper is installed by this stage, and no infrastructure change is authorized. Options for the owner:

- Run it in a dedicated terminal during development and testing.
- Task Scheduler "At log on" for the bridge's own Windows account, running `node dist\bridge.js` in the repository directory, with "restart on failure" enabled.

Installing it as a Windows service (for example with a third-party wrapper) is an infrastructure decision for the owner and Infrastructure agent, not part of 13a.

## Verification

On a resource-constrained Windows host, run the full suite with `npx vitest run --maxWorkers=1 --no-file-parallelism`, supplying the approved application test DB settings privately. This limits concurrent workers; it does not increase test/hook timeouts or change production settings. During Codex takeover on Node24.19.0, this run passed101 tests with only the credential-gated live test skipped after a test-only socket-loss diagnostic correction. Keep the initial failed parallel run in evidence.

For live tests, provision only service-account credentials in the child environment first. The Vitest test does not import the Bridge entrypoint's dotenv initialization; inherit the private variables or use `node --import dotenv/config node_modules/vitest/vitest.mjs run test/traccar-live.integration.test.ts`. Do not write secrets into tracked files. The existing live test does not open the health listener or test live reconnect/history/events; these require separate bounded assertions under the same explicit authorization. Current secure-delivery gate and full procedure: [Codex takeover evidence](TRACKING_BRIDGE_CODEX_TAKEOVER_VALIDATION.md).

- `npm test`: deterministic lifecycle and synthetic telemetry scenarios (`test/tracking-bridge.test.ts`), plus real HTTP/WebSocket transport against a local Traccar stand-in (`test/tracking-bridge.integration.test.ts`).
- Live, read-only, opt-in against the dev Traccar with provisioned credentials:

  ```powershell
  $env:TRACCAR_LIVE_TEST = '1'; npx vitest run test/traccar-live.integration.test.ts
  ```

  Add `$env:TRACCAR_LIVE_KEEPALIVE = '1'` to also wait for one real 55 s keepalive. The test sends no telemetry; use the infrastructure simulator separately and only with approval.
