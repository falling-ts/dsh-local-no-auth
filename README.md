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

This plugin, in its own `apply`, replaces those three **instance methods**
at runtime:

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

- `dsh web` binds loopback and the CLI **rejects `--host 0.0.0.0`**, so this
  bypass cannot, by itself, expose the server to other hosts.
- Never combine with anything that makes the reach accessible beyond the local
  machine (SSH forwarders on shared boxes, VLAN loopback, NAT hairpin).
- Authorization of *remote* requests is unchanged only because there are none
  on a loopback bind; if upstream ever allows non-loopback binds, **do not**
  enable this plugin.

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
curl -i -X POST http://127.0.0.1:<port>/api/session.list \
  -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"probe","method":"session.list","payload":{}}'
# business response {result:{ok:true,...}} — not 401
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