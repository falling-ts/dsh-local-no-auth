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
- 替换前置校验：三个方法必须都是函数，否则 fail-loud 抛错拒绝启动——
  上游改接口时本插件宁可挂掉也不静默失效。
- 不在插件内引入 timer、持久化状态或 Client UI（纯 Host 监听器约定）。

## 安全前置

- 只在本机构成下合法：`dsh web` 回环绑定 + CLI 拒绝 `0.0.0.0`。README 的
  安全边界节与注释不可删除。
- profile 安装路径：`dsh plugin --profile <p> add`（本地目录或发布后的
  github 提法）；`dsh web` 无 `--patch` 叠加，勿在文档里承诺它。

## 提交规范

- 独立 git 仓库（远程：`falling-ts/dsh-local-no-auth`，branch `main`），
  遵循根工作区三步提交约定（`git add . && git commit && git push`）。
- 内容变更（行为/文档/安全边界）与 version bump 同提交。