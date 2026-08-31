/**
 * dsh-local-no-auth — a DSH Cordis function plugin.
 *
 * Bypasses the dsh web browser-session authentication for the loopback-local
 * instance WITHOUT touching any upstream source. It replaces the three
 * authentication methods on the live `ctx.connection` service instance:
 *
 *   - `requestRejection` — the `/api` surface's 401/403 gate (RPC, streams, gateway)
 *   - `authorizeIndex`   — the frontend index request's token/cookie exchange
 *   - `authenticatedUrl` — the startup URL line (drops the launch `?token=...`)
 *
 * Every authentication decision in the running app goes through these instance
 * methods by instance reference (the `/api` route, the frontend-static fallback
 * seat, the API gateway, and the web-app URL announcement), so replacing them
 * here makes the whole local surface token- and cookie-free:
 *
 *   http://127.0.0.1:<port>/   serves index.html immediately, no login round-trip
 *   /api/*                     answers RPC without a signed browser cookie
 *   the printed URL            stays clean (no launch token appended)
 *
 * Safety boundary: this bypass is only sound because `dsh web` binds loopback
 * and the CLI rejects `--host 0.0.0.0`. Never enable the plugin when the reach
 * in question can be accessed by other hosts (SSH forwarders, VLAN-reachable
 * loopback, NAT looping). Unload restores the original methods, so a disposed
 * plugin leaves the instance identical to an unpatched run.
 *
 * @module @falling-ts/dsh-local-no-auth
 */

/** Stable Cordis plugin name. */
export const name = 'dsh-local-no-auth'

/** Connection must be active before its instance methods can be replaced. */
export const inject = ['connection']

/** The connection instance methods that own every auth decision in this app. */
const AUTH_METHODS = ['requestRejection', 'authorizeIndex', 'authenticatedUrl']

/**
 * Replace the connection instance's authentication methods for this process.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context with `connection` active.
 */
export function apply(ctx) {
  const connection = ctx.connection
  if (!connection || typeof connection !== 'object') {
    throw new Error('dsh-local-no-auth: connection service unavailable')
  }
  const originals = {}
  for (const method of AUTH_METHODS) {
    if (typeof connection[method] !== 'function') {
      throw new Error(`dsh-local-no-auth: connection.${method} is not a function; refusing to start`)
    }
    originals[method] = connection[method]
  }
  connection.requestRejection = () => undefined
  connection.authorizeIndex = () => true
  connection.authenticatedUrl = (baseUrl) => baseUrl
  ctx.on('dispose', () => {
    for (const method of AUTH_METHODS) connection[method] = originals[method]
  })
  console.log('[dsh-local-no-auth] active: browser token/cookie checks bypassed; URLs printed clean (loopback-only)')
}