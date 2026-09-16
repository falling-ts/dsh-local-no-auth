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

- 只允许替换 `ctx.connection` 实例的 `requestRejection` / `authorizeIndex` /
  `authenticatedUrl` 三个方法；新增覆盖必须先核对上游 `HostConnectionHandle`
  接口与对应调用点（`/api` 路由、frontend-static 兜底席位、API 网关、
  web-app URL 公告），并同步 README。
- 方法在 `apply` 里替换、在 `dispose` 里恢复（`ctx.on('dispose')`）；恢复逻辑
  不得删除。
- 替换前置校验：三个方法必须都是函数，否则拒载——上游改接口时本插件宁可挂掉
  也不静默失效。
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
  github 提法）；`dsh web` 无 `--patch` 叠加，勿在文档里承诺它。

## 提交规范

- 独立 git 仓库（远程：`falling-ts/dsh-local-no-auth`，branch `main`），
  遵循根工作区三步提交约定（`git add . && git commit && git push`）。
- 内容变更（行为/文档/安全边界）与 version bump 同提交。