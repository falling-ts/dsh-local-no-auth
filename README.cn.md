# dsh-local-no-auth

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的
Cordis 插件：让 `dsh web` 的**仅回环本地实例**免浏览器会话认证——不需要
launch token、不需要 cookie——而且**不改上游源码的一个字**。

| | |
|---|---|
| 包名 | `@falling-ts/dsh-local-no-auth` |
| License | MIT |
| 平台 | 纯 Host 插件（无客户端半部、无 UI） |

## 适用场景

`dsh web` 用"启动 URL 里的 `?token=...` 交换 + 签名 cookie"守卫全部访问。
这在远程/共享部署下是对的；但对只监听回环的本地实例纯属仪式——能连到这个
端口的主机，本来就是这台机器本身。

## 实现原理（零源码改动）

上游所有认证判定都经由 `ctx.connection` 服务**实例**的三个方法：

| 方法 | 管辖 |
|---|---|
| `requestRejection` | `/api` 面（RPC / 流 / 网关）的 401/403 判定 |
| `authorizeIndex` | 前端 index 请求的 token/cookie 认证 |
| `authenticatedUrl` | 打印的启动 URL（追加 launch token） |

本插件在自身 `apply` 里把这三个**实例方法**在运行时替换掉：

```js
connection.requestRejection = () => undefined   // 所有 /api 请求直接放行
connection.authorizeIndex   = () => true        // index 立即返回
connection.authenticatedUrl = (url) => url      // 打印的 URL 保持干净
```

各消费点（`/api` 路由、frontend-static 兜底席位、API 网关、web-app 的 URL
公告）都是按实例引用调用这三个方法的，因此整个本地面一次性变为免 token、
免 cookie。插件卸载（`dispose`）时恢复原方法。

## 安全边界

- `dsh web` 只绑回环，CLI **拒绝 `--host 0.0.0.0`**，所以本插件自身不会把
  服务暴露给其它主机。
- **不要**与任何让该端口可达性超出本机的手段搭配（共享机器上的 SSH 转发、
  VLAN 回环、NAT hairpin）。
- 若上游未来允许非回环绑定，**不要**启用本插件。

## 安装

```sh
# 本地目录安装（支持目录路径）：
pnpm dsh plugin --profile web add <本目录绝对路径>

# 发布后：
dsh plugin --profile web add github:falling-ts/dsh-local-no-auth
```

`dsh web` 没有 `--patch` 命令行叠加；插件通过 profile 自身的
`cordis.patch.yml` 引用本包的 `dsh.bundle.patch` 层激活。装完重启
`dsh web`。

## 验证

```sh
curl -i http://127.0.0.1:<port>/          # 200 + index.html，无需 token
curl -i -X POST http://127.0.0.1:<port>/api/session.list \
  -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"probe","method":"session.list","payload":{}}'
# 返回业务响应 {result:{ok:true,...}} —— 不是 401
```

## 卸载

```sh
dsh plugin --profile web remove dsh-local-no-auth
```

## 已知限制

- 放行是进程级的：同一组合里的所有插件都会看到免认证的 `/api`——这正是
  本地开发机想要的。
- 启动日志仍打印 `dsh web: http://...`（干净 URL）；配合
  `--trusted-host` 的 LAN 候选地址同样以干净 URL 打印。