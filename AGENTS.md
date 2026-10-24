# AGENTS.md — dsh-local-no-auth

本规则适用于 `dsh-local-no-auth/`，并补充[集合约定](../AGENTS.md)。

## 铁律：上游源码零改动

本插件的存在理由就是"免认证而不改 `deepseek-harness/` 任何文件"。
- 禁止修改、stash、覆盖、打补丁 `deepseek-harness/` 下的任何源文件；
  需要新的认证站点时，在**本仓库内**扩展 `AUTH_METHODS` 与 README，
  不许回到改上游的路子。
- 对 `deepseek-harness/` 的任何拉取/指针移动一律走根仓库 `git add <子模块>`
  三步流程，不进入子模块提交。

## 运行时替换的边界

- **认证面**：只允许替换 `ctx.connection` 实例的 `requestRejection` / `admit` /
  `admitConnection` / `authorizeIndex` / `authenticatedUrl` 五个方法；新增覆盖必须先核对上游
  `HostConnectionHandle` 接口与对应调用点（`/api` HTTP 路由、API-stream WS upgrade、
  frontend-static 兜底席位、web-app URL 公告），并同步 README。
  **为什么第五个是 `admitConnection` 与 `admit`（2026-10-19，0.2.1 起）**：0.2.0 的 `admit`
  是 `requestRejection` 的薄包装，替换后者即可放行 `/api`；0.2.1 把认证搬进了 `admit` 自己，
  `/api` HTTP 与 API-stream 升级各走一条闸门，只替换旧三方法会得到"插件打印 active、`/api` 全 401"
  的最坏失效，详见下文 0.2.1 适配节。
- **元信息面（2026-09-23 新增，唯一的第二个替换面）**：额外允许包裹
  `ctx.pluginPackages` 实例的 `metaOf`，**仅**用于剥离上游 0.1.7-alpha.2 的假诊断
  （`Cannot assign to read only property 'stack'`，见下节）。硬约束：
  ① 只按该固定错误串精确匹配后剥离，其它 metadata 诊断一律原样透传，不得扩大匹配；
  ② `pluginPackages` **不得**加进 `inject`——免鉴权是主职责，不得变成依赖某个
  metadata 服务的条件行为；缺服务时跳过并 warn，不影响鉴权替换；
  ③ 同样是 apply 替换 / disposer 恢复，无 timer、无持久化状态、无 Client UI；
  ④ 剥离后必须用包 manifest 的 `name` / `description` 兜底显示文本，不能留空。
  除上述两面外，**不得**再新增任何运行时替换面。
- 方法在 `apply` 里替换、在 `ctx.effect` 的 disposer 里恢复；恢复逻辑
  不得删除。**注意（2026-09-23 实测）**：cordis 4.0.4 **没有 `'dispose'` 事件**——
  `ctx.on('dispose', …)` 是死代码，永不触发（`vendor/cordis/src/events.ts` 无该键，
  全仓无 `emit('dispose')`）。上游唯一清理惯用法是 `ctx.effect(() => () => { … })`。
  用错法的后果不是"无害"：热重载/卸载后补丁永久残留，且再次 apply 时 `originals`
  会把已替换的 no-op 当成原方法捕获，`dispose` 变成"恢复 no-op"的自锁。
- 替换前置校验：五个方法必须都是函数、`browserPeer` 必须可用，否则拒载——上游改接口时
  本插件宁可挂掉也不静默失效。
- **fail-loud 必须由本插件自己承担（2026-09-17，harness 0.1.6-alpha.1 起）**：
  四处拒载点全部走 `refuseStart(ctx, reason)`，它做三件事——往 stderr 写含原因的
  `refusing to start` 行、调 `ctx.get('appExit')(1)` 请求非零退出、然后抛错。
  **不得退化为"只抛错"**：上游已把 `assertEntriesActivated` 换成只对私有必需
  entry 清单致命的 `auditStartupEntries`，本插件 entry 不在表内，单靠抛错只会
  得到一条 `warning: N entry did not activate`，而服务照常启动、鉴权完好——
  用户会误以为免鉴权已生效。抛错保留是为了在更老 harness 上仍然致命。
  若上游将来连 `ctx.appExit` 也移除，需重新评估该机制（这是当前唯一的受支持
  退出缝，`packages/boot/cmdline`，由启动器在树挂载前提供）。
- 不在插件内引入 timer、持久化状态或 Client UI（纯 Host 监听器约定）。

## 安全前置

- 只在本机构成下合法：`dsh web` 回环绑定 + CLI 拒绝 `0.0.0.0`。README 的
  安全边界节与注释不可删除。
- **绑定地址闸门（必须保留）**：`apply` 必须先校验实时 `webServer` 绑定
  主机为回环字面量（`127.0.0.1` / `localhost`），否则走 `refuseStart` 拒载；
  不允许删除该校验或放宽白名单（上游 webserver Config schema 只接受
  `'127.0.0.1' | '0.0.0.0'`，`0.0.0.0` 恒被拒）。校验用 `ctx.webServer.host`
  getter（读 config 值，非 socket 探测），`inject` 必须同时声明
  `connection` 与 `webServer`。
- profile 安装路径：`dsh plugin --profile <p> add`（本地目录或发布后的
  github 提法）。CLI **有** `--patch <file>`（可重复，实测 0.2.0-rc.2 可用），
  但它叠加的是配置层、不安装包；被叠加文件若按**包名**引用插件，该包仍须先装进
  profile。

## harness 0.1.7-alpha.2 适配（2026-09-23）

peer 基线为 **`>=0.1.7-alpha.1`**，cordis `>=4.0.4`（vendor 在 0.1.7 升到 4.0.4）。
peer 清单按**实际用到的包**逐一声明（除 cordis 外全部 `optional`——它们在 profile 里由
dsh 安装提供、不在 profile 的 node_modules 中，标 required 只会产生无意义告警）：
`dsh-client-connection`（`ctx.connection` 三方法）、`dsh-host-webserver`
（`ctx.webServer.host`）、`dsh-cmdline`（`ctx.appExit` fail-loud 缝）、
`dsh-app-boot`（`ctx.pluginPackages.metaOf`，元信息 shim 的包裹目标）。

上游 0.1.6 引入的 `auditStartupEntries`（只对私有必需 entry 清单致命）在 0.1.7 上
仍然如此（`packages/boot/app-boot/src/index.ts`），所以 `refuseStart` 里
`ctx.get('appExit')(1)` 这条 fail-loud 路径保持必需——不要因为"上游又发新版"而删掉它。
`ctx.appExit` 仍由启动器在树挂载前提供（`packages/boot/cmdline`）。

## harness 0.2.1-rc.3 适配（2026-10-24）：零改动

上游 `687f282e86`（rc.2）→ `22ddee3792`（master HEAD，`dsh-v0.2.1-rc.3-1533-g22ddee3792`），
**1539 个提交**；版本列车仍是 **0.2.1**（rc.2 → rc.3），vendor `cordis 4.0.5` /
`schemastery 3.18.5` 未变 → peer 下界 **`>=0.2.1-rc.1` 不动**。

两个替换面与 fail-loud 缝逐条核对（**全部仍在**，源码无需改动）：

- **认证面**：`HostConnectionHandle` 的五个方法 `requestRejection` / `admit` /
  `admitConnection` / `authorizeIndex` / `authenticatedUrl` 全部仍在
  （`packages/client/connection/src/{rpc.ts,rpc-host.ts,browser-auth.ts}`），
  `rpc-host.ts` 里 `browserPeer` 仍在（4 处引用），`admit` 的形态与 rc.2 一致
  （自己认证、不委托 `requestRejection`），AUTH_METHODS 五个无需变动。
  `connection` 包这一轮 9 个文件的改动**全是新增 locale 文件**（de/es/fr/ja/pt/ru），
  代码只加了一个可选的 `resolveAsset?(reference)`（worker tunnel 用，本插件不碰）。
- **元信息面**：假诊断的来源**未修**——`profile-resolution/resolver.ts:819` 仍无条件执行
  `error.stack = stack.replace(originalMessage, error.message)`，`package-meta.ts:82` 的
  `missingResource()` 仍只认 `ERR_PACKAGE_PATH_NOT_EXPORTED` / `ERR_MODULE_NOT_FOUND` /
  `MODULE_NOT_FOUND` / `ENOENT` / `ENOTDIR`，认不出被改写 stack 后抛出的 TypeError。
  故 `pluginPackages.metaOf` 兜底**继续必要**。
- **绑定闸门**：`packages/host/webserver/src/index.ts:411` 的 `get host()` 仍在，
  schema 仍只收 `'127.0.0.1' | '0.0.0.0'`。
- **fail-loud 缝**：`ctx.appExit` 仍由启动器在树挂载前 provide
  （`packages/boot/cmdline/src/index.ts:87` 的 `ctx.provide('appExit', host.exit)`）。
- `app-boot` 这轮改动（60 增 / 170 删）主要是**把官方 bundle 目录搬进新包
  `@deepseek-ai/dsh-official-bundles`**（`INSTALLATION_OWNED_PROFILE_TUPLES` /
  `PROFILE_TEMPLATES` / `RETIRED_BUNDLES`），`pluginInventory` 与 `plugin-compatibility`
  的判定逻辑（`engines.dsh` 优先、否则逐 peer）未变。

端到端复核（3099 隔离实例，`DSH_HOME=~/.dsh-web`，0.2.1-rc.3）：服务日志打印
`[dsh-local-no-auth] active: browser token/cookie checks bypassed; URLs printed clean
(bind host "127.0.0.1", loopback-only)`；**无 token 直连** `GET /` 返回 200（页面渲染出
`0.2.1-rc.3-22ddee3`），`POST /api/pluginInventory/list` 与 `/api/settings/describe` 均 200
（证明五个方法的替换在 rc.3 上依然覆盖 `/api` HTTP 与流式升级两条闸门）；
`pluginInventory/list` 中 `include:dsh-local-no-auth` 为 `enabled:true` / `fiberPhase:active`；
**204 个条目的 `meta.error` 计数为 0**——元信息兜底在 rc.3 上仍正常工作。
离线 `lna-refusestart-probe.mjs` 29 项全绿。

## harness 0.2.1-rc.2 适配（2026-10-19）：认证面从三个方法扩到五个

peer 下界升至 **`>=0.2.1-rc.1`**（0.2.1 列车），vendor 升至 cordis `>=4.0.5` /
schemastery `>=3.18.5`。`peer-range-probe.mjs` 的规则是"声明的列车下界必须与 checkout
同列车"——0.2.1 是**真实换车**（不是 0.2.0 内的补丁），所以下界必须跟着走。

**破坏性变更（本次唯一一处，且是本插件存在的理由被直接命中）**：上游重写了
`connection.admit`。0.2.0 的形态是薄包装——

```ts
admit(request) {
  const rejection = this.requestRejection(request)          // 0.2.0：委托
  return rejection === undefined ? { peer: this.operator } : { rejection }
}
```

0.2.1 改为**自己认证**，不再经过 `requestRejection`：

```ts
admit(request) {
  const secure = …                                        // 直接走 isTrusted +
  if (this.isTrusted(request) || …) return { peer }        // browserAuth.isAuthenticated /
  …this.browserAuth.isAuthenticated(request, secure)…      // authenticateApi
}
```

后果：只替换三方法时，`/api` 的每一个 RPC 仍然 401，**而插件照常打印
`active: … bypassed`**——最坏的失效形态（用户以为免鉴权已生效）。实测于 0.2.1-rc.2：
`POST /api/pluginInventory/list` 与 `/api/settings/describe` 均 401。

**修复**：`AUTH_METHODS` 扩为五个（`requestRejection` / `admit` / `admitConnection` /
`authorizeIndex` / `authenticatedUrl`），`admit` 返回 `{ peer: connection.browserPeer }`，
`admitConnection` 返回 `{ peer: connection.browserPeer, release: () => Promise.resolve() }`。
三点设计理由：

1. **复用 `browserPeer`**，不新造 Peer：它就是上游 `admit()` 认证成功时返回的那个
   owner Peer（`rpc-host.ts` 的 `this.browserPeer = new Peer(ctx, { principal: { kind: 'owner' } })`），
   所以免鉴权路径与真实登录在 principal、interaction participation、生命周期上完全一致，
   下游（权限判定、Peer 归属）看不出差别。
2. **`release` 是 resolved no-op**：上游 `admitConnection` 只为**逐 socket 的 API Peer**
   登记释放（`Promise.all(releases)`），共享的 browser Peer 没有 socket 所有权可弃，
   返回一个 resolved Promise 保持载体的契约形状。
3. **`browserPeer` 缺失即 fail-loud 拒载**（`refuseStart`）：宁可挂掉，也不返回一个
   下游会当成"某人"的半成品 admission。

`/api` 走 `connection.admit(req)`（`packages/client/connection/src/index.ts`），
API-stream WS upgrade 走 `connection.admitConnection(req)`（`packages/api/gateway/src/index.ts`），
两者是**不同的闸门**，缺一不可。`requestRejection` 的替换保留：侧路（`open-in-app`、
inspector）仍在用它。

**回归闸门**：`exploration/fc-plugin-load-probe.mjs` 与 `exploration/lna-refusestart-probe.mjs`
的 mock 都已补上 `admit`/`admitConnection`/`browserPeer`，并断言五个方法全部被替换、
`admitConnection().release` 是 resolved Promise、dispose 后五个方法全部还原。

端到端复核（3099 实例，`DSH_HOME=~/.dsh-web`，0.2.1-rc.2）：`POST /api/pluginInventory/list`
与 `/api/settings/describe` **均 200**；`include:dsh-local-no-auth` 为
`enabled:true` / `fiberPhase:active`；无 token 直连 `GET /` 返回 200 且页面渲染出
`0.2.1-rc.2-687f282`。

## harness 0.2.0-rc.2 复核（2026-09-30）：零改动

peer 下界保持 `>=0.2.0-rc.1`（0.2.0 列车；rc.1 → rc.2 是同列车补丁，纯下界本就不该收窄）。
两个替换面与 fail-loud 缝逐条复核，rc.2 上**全部仍在**：

- **认证面**：`HostConnectionHandle` 接口的 `requestRejection` / `authorizeIndex` /
  `authenticatedUrl` 三方法仍在（`packages/client/connection/src/rpc.ts` 的接口声明，
  `rpc-host.ts` 的实例实现），替换点不变。
- **元信息面**：假诊断的来源未修——`packages/boot/app-boot/src/profile-resolution/resolver.ts`
  仍在 `throwWithImporter` / `throwWithoutCjsAnchor` 里**无条件**改写 `error.stack`
  （`if (stack !== undefined) error.stack = stack.replace(...)`），而
  `package-meta.ts` 的 `missingResource()` 仍只认 `ERR_PACKAGE_PATH_NOT_EXPORTED` /
  `ERR_MODULE_NOT_FOUND`（认不出被改写 stack 时抛出的 TypeError）。故 `metaOf` 兜底**继续必要**。
- **绑定闸门**：`ctx.webServer.host` getter 仍在，schema 仍只收 `'127.0.0.1' | '0.0.0.0'`。
- **fail-loud 缝**：`ctx.appExit` 仍由启动器在树挂载前 provide（`packages/boot/cmdline/src/index.ts`）。

端到端复核（3080 web 实例 + `DSH_HOME=~/.dsh-web`）：`pluginInventory/list` 中
`include:dsh-local-no-auth` 为 `enabled:true` / `fiberPhase:active`，服务日志打印
`[dsh-local-no-auth] active: browser token/cookie checks bypassed; URLs printed clean`，
无 token 直连 `http://127.0.0.1:3080/` 与 `/api/*` 均 200。**本仓库源码与文档无需改动**，
故 version 不动。

## 上游插件元信息假错误（2026-09-23，靠配置无解，故由本插件兜底）

harness 0.1.7-alpha.2 起，profile-resolution 拦截层在转发解析错误前会**无条件**改写
`error.stack`（`packages/boot/app-boot/src/profile-resolution/resolver.ts` 的
`throwWithImporter` 与 `throwWithoutCjsAnchor`）。Node 内部错误
`ERR_PACKAGE_PATH_NOT_EXPORTED` 的 `stack` 在部分 Node 构建上是**不可写的 own 属性**
（本机实测描述符 `{writable:false, configurable:true}`，keys
`["name","message","stack","code"]`），于是赋值抛
`TypeError: Cannot assign to read only property 'stack'`。该 TypeError 不再匹配
`package-meta.ts` 的 `missingResource()`（它本已把该 code 当"资源不存在"而静默跳过），
最终冒到 `readPluginMeta` 的 catch，插件页面对**几乎所有包**（含官方 `dsh-llm`、
`cordis-plugin-timer`、`dsh-persona` 等）显示"包元信息错误"。

**为何配置层修不了**：`readPluginInventory`（`packages/host/plugin-inventory/src/index.ts`）
与 `plugin-manager`（`packages/boot/plugin-manager/src/index.ts`）都**无条件**调
`pluginPackages.metaOf`；`plugin-inventory` 没有 Config，`plugin-manager` 的 Config 只有
pnpm / registry 项，`pluginPackages` 只有 `resolution`——**没有任何 metadata/locale 开关**，
且崩溃点位于所有配置面之下（解析拦截层内部）。因此 `cordis.patch.yml` 无论如何都够不到，
唯一不动上游源码的修法就是运行期包裹 `metaOf`（即上文"元信息面"那条例外）。

**影响面：纯显示，不影响加载**。实测某次清单：184 个 entry，`enabled && !active` 为 **0**，
带该错误的 entry `fiberPhase` 全部是 `active`。故本插件只剥离这条诊断，绝不改插件启用状态。

**何时可以删除本兜底**：上游把这两处赋值改成 try/catch（或让 `missingResource` 覆盖该
TypeError）之后即可移除，届时本插件应回到只做免鉴权。

## 显示元数据（`locale/*.json` + `icon`，2026-09-30 补齐）

宿主 `readPluginMeta`（`packages/boot/app-boot/src/package-meta.ts`）在不执行插件代码的前提下按
`${specifier}/locale/en.json` 读标题与描述、按清单顶层 `icon` 读图标，两者都要经 `exports` 发布
（否则解析报 `ERR_PACKAGE_PATH_NOT_EXPORTED`，被当"资源不存在"静默跳过，回退到 package.json 的
`name`/`description`）。此前两者都缺，插件卡片显示的是那一整段 npm 描述；现在：

- `locale/en.json` = `{ meta: { title: "Local no-auth", description: … } }` + `locale/zh.json`；
- `icon.svg`（开锁图形）；
- `exports` 加 `"./locale/*.json"`，`files` 加 `"locale/*.json"` 与 `"icon.svg"`。

**注意**：这是在补显示面，**不新增任何运行时替换面**（见上文铁律）；本插件仍然没有 Client 半部、
没有 `dsh.client` 声明、没有 `./client` 导出。清单变更需重启实例才生效（profile-resolution 启动时
快照插件 exports）。回归闸门：`node exploration/plugin-manifest-check.mjs`。

## 规范符合性说明（2026-09-30 评审）

按上游 `cordis-plugin-development` skill 与 `docs/user/develop/**` 核对，本插件与其它两个插件一样：
组合包 manifest 齐全、Host 插件只具名导出（**无 default export**）、注册即 `ctx.effect`（unload 恢复
五个方法与 `metaOf`）、`Config` 声明的可调项齐全（本插件无可调项）、fail-loud 走 `ctx.appExit`。

两处**有意偏离**，改动前先读这一节：

1. **运行期替换 `ctx.connection` 五方法与包裹 `pluginPackages.metaOf` 都不是官方扩展点**。
   规范要求"新行为挂在文档化的扩展点上"，但认证面与那条假诊断**都没有官方出口**（后者位于所有
   配置面之下的解析拦截层内），所以这是"规范无解法"的折中：边界、恢复、fail-loud 都在上文
   "运行时替换的边界"里写死了，不得再扩大。
2. **日志用 `console.log` / `console.warn`**（Host 插件通常该走 `ctx.logger`）。这里保留 `console`
   是因为 `refuseStart` 必须在**任何服务都不可用**（包括 logger）时仍能往 stderr 说话；那行
   `[dsh-local-no-auth] active: …` 也是启动脚本 grep 的判据。

## 提交规范

- 独立 git 仓库（远程：`falling-ts/dsh-local-no-auth`，branch `main`），
  遵循根工作区三步提交约定（`git add . && git commit && git push`）。
- 内容变更（行为/文档/安全边界）与 version bump 同提交。