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
 * Safety boundary: `apply` refuses to start unless the live webServer bind host
 * is a loopback literal. The upstream webserver Config schema only accepts
 * `'127.0.0.1' | '0.0.0.0'`, so in practice `127.0.0.1` passes and `0.0.0.0`
 * (all interfaces) fails; `localhost` is kept as a loopback alias for future
 * schema latitude. Any other value fails loud — the bypass never silently
 * activates against a reachable-by-others listen. Never enable the plugin when
 * the reach in question can be accessed by other hosts anyway (SSH forwarders,
 * VLAN-reachable loopback, NAT looping). Unload restores the original methods,
 * so a disposed plugin leaves the instance identical to an unpatched run.
 *
 * Refusal mechanics (harness 0.1.6-alpha.1 onward): the same checks now report on
 * stderr AND request a nonzero process exit through the launcher's `ctx.appExit`,
 * in addition to throwing — because upstream stopped treating a non-required
 * entry's `apply` failure as fatal (see {@link refuseStart}). Consequence to know
 * when auditing a running instance: if this plugin's entry fails to activate for
 * ANY reason, the server still serves, with authentication intact.
 *
 * Second responsibility (2026-09): suppress ONE upstream plugin-metadata crash
 * that is unrelated to authentication, but is not reachable from configuration.
 * On harness 0.1.7-alpha.2 the profile-resolution decorator rewrites
 * `error.stack` on Node's internal `ERR_PACKAGE_PATH_NOT_EXPORTED` error, whose
 * `stack` is a NON-WRITABLE own property on some Node builds. The resulting
 * `TypeError: Cannot assign to read only property 'stack'` no longer matches the
 * metadata reader's "resource absent" classification, so the Plugins page shows
 * "包元信息错误 / Plugin metadata for <pkg>: TypeError: …" for nearly every
 * package (official ones included). `apply` therefore also wraps
 * `ctx.pluginPackages.metaOf`, dropping EXACTLY that diagnostic and recovering
 * the display title/description from the package manifest instead. This is
 * best-effort and never fatal: if the service is absent the shim is skipped and
 * the authentication bypass proceeds.
 *
 * @module @falling-ts/dsh-local-no-auth
 */

/** Stable Cordis plugin name. */
export const name = 'dsh-local-no-auth'

/** Connection and webServer must be active before their members can be read. */
export const inject = ['connection', 'webServer']

/** The connection instance methods that own every auth decision in this app. */
const AUTH_METHODS = ['requestRejection', 'authorizeIndex', 'authenticatedUrl']

/** Bind hosts this bypass may operate under: loopback literals only. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost'])

/**
 * Refuse to continue: report loudly on stderr, ask the launcher for a nonzero
 * exit, and still throw.
 *
 * WHY NOT JUST THROW (harness 0.1.6-alpha.1, 2026-09):
 * `packages/boot/app-boot` replaced its blanket "every enabled-but-inactive entry
 * aborts the boot" audit with `auditStartupEntries`, which is fatal only for a
 * private required-entry list (`agent-loop`, `webserver`, `modules`, `connection`,
 * `headless-runner`, `acp`, `sdk-jsonrpc-server`) plus bootstrap includes. This
 * plugin's entry is not in that list and cannot join it, so a thrown `apply` now
 * yields one generic `warning: N entry did not activate` line and `dsh web` serves
 * anyway — with the auth fence intact while the operator believes the bypass is on.
 * `ctx.appExit` is the launcher-provided exit request (wired to its shutdown
 * controller before the tree mounts, `apps/cli/src/profile-boot.ts`), and the
 * launcher explicitly tolerates an exit request that lands while setup is still in
 * flight. The throw is kept for older harnesses, where it IS fatal.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {string} reason - why the bypass cannot be installed safely.
 * @returns {never} always throws.
 */
function refuseStart(ctx, reason) {
  const message = `dsh-local-no-auth: refusing to start — ${reason}. `
    + 'The no-auth bypass is NOT active on this instance: it still requires the launch token / browser cookie.'
  try {
    process.stderr.write(`${message}\n`)
  } catch { /* no stderr sink: the exit request and throw below still report */ }
  let requested = false
  try {
    const exit = typeof ctx.get === 'function' ? ctx.get('appExit') : undefined
    if (typeof exit === 'function') {
      exit(1)
      requested = true
    }
  } catch { /* no launcher exit seam: rely on the throw */ }
  throw new Error(requested ? `${message} (nonzero exit requested)` : message)
}

/**
 * Exact upstream crash text this plugin neutralizes — kept narrow on purpose so
 * that a genuinely different metadata failure is never hidden.
 */
const META_CRASH_MARKER = "Cannot assign to read only property 'stack'"

/**
 * Recover display text from the owning package manifest when the localized read
 * crashed. Mirrors `readPluginMeta`'s own fallback: the manifest's `name` as the
 * title and its `description` as the description. Never throws.
 * @param {object} packages - the live pluginPackages service instance.
 * @param {string} specifier - configured plugin module specifier.
 * @param {string} parentURL - owning Loader tree's resolution base.
 * @returns {{title?: string, description?: string}|undefined}
 */
function manifestText(packages, specifier, parentURL) {
  let manifest
  try {
    manifest = packages.packageOf?.(specifier, parentURL)?.manifest
  } catch {
    return undefined
  }
  if (manifest === null || typeof manifest !== 'object') return undefined
  const title = typeof manifest.name === 'string' && manifest.name.length > 0 ? manifest.name : undefined
  const description = typeof manifest.description === 'string' && manifest.description.length > 0
    ? manifest.description
    : undefined
  if (title === undefined && description === undefined) return undefined
  return { ...(title === undefined ? {} : { title }), ...(description === undefined ? {} : { description }) }
}

/**
 * Neutralize the upstream plugin-metadata crash described in the module header.
 *
 * WHY HERE: that crash is unreachable from configuration — no config key gates the
 * metadata read, and the failure happens below the resolution seam. The only
 * upstream-source-free fix is a runtime wrapper around the one method every
 * metadata consumer calls (`plugin-inventory`, `plugin-manager`), i.e. exactly the
 * instance-replacement technique this plugin already uses for `ctx.connection`.
 *
 * `pluginPackages` is deliberately NOT added to `inject`: the authentication
 * bypass is this plugin's primary job and must not become conditional on a
 * metadata service. The shim is therefore installed best-effort and skipped with a
 * warning when the service is absent. Restored on dispose; never throws.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 */
function installMetaErrorShim(ctx) {
  try {
    const packages = typeof ctx.get === 'function' ? ctx.get('pluginPackages') : undefined
    if (packages === null || typeof packages !== 'object' || typeof packages.metaOf !== 'function') {
      console.warn('[dsh-local-no-auth] pluginPackages.metaOf unavailable — plugin-metadata crash shim NOT installed')
      return
    }
    const original = packages.metaOf
    packages.metaOf = function (specifier, parentURL) {
      let meta
      try {
        meta = original.call(this, specifier, parentURL)
      } catch {
        return undefined
      }
      if (meta === null || typeof meta !== 'object'
        || typeof meta.error !== 'string' || !meta.error.includes(META_CRASH_MARKER)) {
        return meta
      }
      return manifestText(packages, specifier, parentURL)
    }
    ctx.effect(() => () => { packages.metaOf = original }, 'dsh-local-no-auth: restore pluginPackages.metaOf')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[dsh-local-no-auth] plugin-metadata crash shim NOT installed — ${message}`)
  }
}

/**
 * Replace the connection instance's authentication methods for this process,
 * but only while the instance listens on a loopback-only bind host.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context with `connection` and `webServer` active.
 */
export function apply(ctx) {
  const connection = ctx.connection
  if (!connection || typeof connection !== 'object') {
    refuseStart(ctx, 'connection service unavailable')
  }
  const webServer = ctx.webServer
  const bindHost = webServer && typeof webServer.host === 'string' ? webServer.host : undefined
  if (bindHost === undefined) {
    refuseStart(ctx, 'webServer bind host unavailable')
  }
  if (!LOOPBACK_HOSTS.has(bindHost)) {
    refuseStart(
      ctx,
      `webServer bind host "${bindHost}" is not loopback-only (allowed: ${[...LOOPBACK_HOSTS].join(', ')}); `
      + 'the bypass is only safe when no other host can reach the instance',
    )
  }
  const originals = {}
  for (const method of AUTH_METHODS) {
    if (typeof connection[method] !== 'function') {
      refuseStart(ctx, `connection.${method} is not a function`)
    }
    originals[method] = connection[method]
  }
  connection.requestRejection = () => undefined
  connection.authorizeIndex = () => true
  connection.authenticatedUrl = (baseUrl) => baseUrl
  ctx.effect(() => () => {
    for (const method of AUTH_METHODS) connection[method] = originals[method]
  }, 'dsh-local-no-auth: restore connection auth methods')
  console.log(`[dsh-local-no-auth] active: browser token/cookie checks bypassed; URLs printed clean (bind host "${bindHost}", loopback-only)`)
  installMetaErrorShim(ctx)
}