# dsh-local-no-auth

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Cordis
plugin that bypasses the `dsh web` browser-session authentication for the
**loopback-local** instance — no launch token, no cookie — **without modifying
a single line of upstream source**.

| | |
|---|---|
| Package | `@falling-ts/dsh-local-no-auth` |
| License | MIT |
| Platform | Host-only (no client half, no UI) |

## Why

`dsh web` guards its surface with a launch-token exchange (the `?token=...`
on the printed URL) plus a signed browser cookie. That is correct for remote
or shared deployments, but for a loopback-only local instance it is pure
ceremony: any host that can reach the port is a host already on the machine.

## How it works (no source changes)

Upstream routes every authentication decision through the live
`ctx.connection` service instance's methods:

| method | gate |
|---|---|
| `requestRejection` | `/api` surface (RPC, streams, gateway) — 401/403 |
| `authorizeIndex` | frontend index request — token/cookie exchange |
| `authenticatedUrl` | printed startup URL — appends the launch token |

This plugin, in its own `apply`, first checks the live webServer bind host and
**refuses to start** unless it is a loopback literal, then replaces those three
**instance methods** at runtime:

```js
connection.requestRejection = () => undefined   // every /api request proceeds
connection.authorizeIndex   = () => true        // index serves immediately
connection.authenticatedUrl = (url) => url      // printed URL stays clean
```

Every consumer (the `/api` route, the frontend-static fallback seat, the API
gateway, the web-app URL announcement) calls them by instance reference, so the
whole local surface becomes token- and cookie-free at once. On unload
(`dispose`) the original methods are restored.

## Safety boundary

- **Bind-host gate:** `apply` reads the live `webServer` bind host and refuses
  unless it is `127.0.0.1` or `localhost` (see *How a refusal reaches the
  process* below). The upstream webserver Config schema only accepts
  `'127.0.0.1' | '0.0.0.0'`, so `0.0.0.0` (all interfaces) always fails and the
  bypass never silently activates against a reachable-by-others listen.
- `dsh web` binds loopback and the CLI **rejects `--host 0.0.0.0`**, so this
  bypass cannot, by itself, expose the server to other hosts.
- Never combine with anything that makes the reach accessible beyond the local
  machine (SSH forwarders on shared boxes, VLAN loopback, NAT hairpin).
- Authorization of *remote* requests is unchanged only because there are none
  on a loopback bind; if upstream ever allows non-loopback binds, this plugin
  refuses rather than silently bypassing.

### How a refusal reaches the process

Three failures are possible: the `connection` service is missing, the
`webServer` bind host cannot be read, the host is not loopback, or one of the
three auth methods is no longer a function. Each one writes an explicit
`dsh-local-no-auth: refusing to start — …` line to stderr naming the reason,
requests a nonzero exit through the launcher's `ctx.appExit`, and then throws.

The `ctx.appExit` request is not decoration. Up to harness 0.1.5 a thrown
`apply` aborted the whole boot; since 0.1.6-alpha.1 upstream is fatal only for a
private list of required entries (`agent-loop`, `webserver`, `modules`,
`connection`, `headless-runner`, `acp`, `sdk-jsonrpc-server`), so **a plugin
entry cannot abort the boot by throwing** — it produces one generic
`warning: N entry did not activate` line and the server serves anyway. The
launcher's exit request is what restores a real nonzero exit; the throw is kept
for older harnesses, where it still is fatal.

**When auditing a running instance:** if this plugin's entry fails to activate
for any reason, `dsh web` still serves, with authentication intact. Confirm the
bypass is actually installed by the `[dsh-local-no-auth] active:` line on
stdout/stderr — not by the absence of a crash.

## Install

```sh
# local development install (directory path is accepted):
pnpm dsh plugin --profile web add <absolute-path-to-this-directory>

# after publishing:
dsh plugin --profile web add github:falling-ts/dsh-local-no-auth
```

`dsh web` has no `--patch` CLI overlay; the plugin activates through the
profile's own `cordis.patch.yml` referencing this package's `dsh.bundle.patch`
layer. Restart `dsh web` afterwards.

## Verify

```sh
curl -i http://127.0.0.1:<port>/          # 200 + index.html, no token needed
curl -i -X POST http://127.0.0.1:<port>/api/session/list \
  -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"probe","method":"session/list","payload":{}}'
# a business envelope arrives (2xx, result.ok true/false) — never 401
```

## Uninstall

```sh
dsh plugin --profile web remove dsh-local-no-auth
```

## Known limitations

- The bypass is process-wide: every plugin in the same composition sees
  unauthenticated `/api`. That is the point for a local dev box.
- Startup log line still says `dsh web: http://...` (clean URL) and, with
  `--trusted-host` LAN candidates, prints the LAN URL clean as well.