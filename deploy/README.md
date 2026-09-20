# 部署

三份入口启动脚本 + 三份 systemd unit。**它们是版本化的**，因为部署的权限白名单决定了代码能不能跑，而重启合同必须覆盖全部三个入口：

## 为什么放在仓库里

每份脚本都用 `docker run ... deno run <权限> src/<入口>/main.ts` 的形式启动一个入口。那些权限参数是**代码的运行时契约**，不是运维细节：

- Portal 与 MCP 是只读入口，**不得**持有 `--allow-write`。
- Gateway 的写权限只覆盖审计文件与它的临时兄弟 `gateway-audit.json.tmp`，**不覆盖目录**。`src/fs.ts` 之所以先 `stat` 父目录、只在确实缺失时才 `mkdir`，就是因为 `mkdir` 需要目录写权限，而无条件调用会让每次审计追加都以 `Requires write access to "/app/data"` 失败——上一次把脚本留在服务器上，这个回归就是这样漏到生产上的。
- 三个入口都拿到同一个 `PORTICO_GATEWAY_AUDIT_PATH`，否则 Portal 与 MCP 的审计时间线会静默缺少 Gateway 访问事件，而 `audit list --audit` 有。
- Portal 与 MCP 都拿到同一个 `PORTICO_CONCLUSIONS_PATH`，否则 `GET /api/conclusions` / `portico_conclusions` 静默返回空结论，而 `audit conclusions` 有结论。该文件只由 CLI 写（Portal 与 MCP 无写权限），Gateway 不读它，因此不注入。

`tests/deploy_contract_test.ts` 会解析这些脚本并断言上述形状；改脚本而破坏契约会红。

## 变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORTICO_DEPLOY_BIND` | `127.0.0.1` | 监听地址，同时进入 `--allow-net` 白名单。内网部署时在安装现场注入 RFC1918 单播地址，不要写进仓库，不要改成 `0.0.0.0` |
| `PORTICO_DEPLOY_PORT` | 8788 / 8789 / 8790 | 各入口端口 |
| `PORTICO_DENO_IMAGE` | `denoland/deno:2.9.6` | 运行镜像（部分宿主 glibc 过旧，跑不了官方二进制） |
| `PORTICO_DOCKER` | `/usr/bin/docker` | docker 可执行文件 |

数据目录固定为检出目录下的 `data/`，只有 Gateway 以可写方式挂载它。

## systemd

内网测试部署（不是生产上线）用这三份 unit，`ExecStart` 必须指向本仓库的 `deploy/run-*.sh`，**不得**指向未纳入审查的额外副本。MCP 曾经以 `unless-stopped` 容器游离在 systemd 之外，只重启 portal/gateway 会留下旧 MCP 进程。

仓库里的 unit 是模板：`WorkingDirectory=/opt/portico`，`PORTICO_DEPLOY_BIND=127.0.0.1`。真实检出路径与内网绑定在安装现场用 drop-in 或 `EnvironmentFile` 注入。形状见 [`drop-in.example.conf`](drop-in.example.conf)：先清空 `ExecStart=` 再指向本检出的 `deploy/run-*.sh`，不要把 RFC1918 地址写进仓库。

```sh
sudo cp deploy/portico-portal.service deploy/portico-gateway.service deploy/portico-mcp.service /etc/systemd/system/
# drop-in: set WorkingDirectory, ExecStart, and PORTICO_DEPLOY_BIND for this host
sudo systemctl daemon-reload
sudo systemctl enable --now portico-portal portico-gateway portico-mcp
```

端口仍是 8788/8789/8790。不要改成 `0.0.0.0`，不要占用无关生产端口。`tests/deploy_contract_test.ts` 同样解析这些 unit。

# macOS（macstudio，LaunchDaemon）

模板在 `macos/`：`run.sh`（单监管整体，非三入口三守护）、
`run-cloudflared.sh` + `config.yml`（本地管理 ingress，公开同一域名：
`/review*` → Review 8791，其余 → Portal 8788，catch-all 404）、两份
LaunchDaemon plist。macstudio 不跑 Docker，
用本机 Deno（与发布镜像同版本）直接起 `src/up/main.ts`；权限仍以
`src/perms.ts` 为准，监管者只持 `--allow-env --allow-run`。形状由
`tests/deploy_macos_contract_test.ts` 锁定：模板不得含 `0.0.0.0`、
RFC1918 地址、真实用户名、真实隧道 id 与 token 明文。

选本地管理而不用 token + 仪表盘（mira 模式）的原因：`wrangler tunnel`
（已验证最新版 4.135.0）没有写 ingress 的子命令，而隧道配置接口拒绝
OAuth 与登录证书两种 CLI 鉴权（`10405` / 认证失败），只能走仪表盘点
一次；本地 `config.yml` 让建隧道到跑流量全程 CLI 可完成
（`ingress validate` / `ingress rule` 可机检验），代价是 ingress 住在主机
文件里而不是仪表盘。

现场步骤（`~/portico` 下已有 `app` 检出、`data`、`logs`、`bin/cloudflared`）：

1. `cloudflared tunnel create portico-macstudio`，把 `~/.cloudflared/<id>.json`
   移到 `~/portico/portico-macstudio.json`（`chmod 600`，原路径删干净，
   不出仓库）。
2. `cloudflared tunnel route dns [--overwrite-dns] <id> portico.talkincode.net`。
3. 按模板写好 `config.yml`（填真实隧道 id），`ingress validate` 与
   `ingress rule https://portico.talkincode.net/review`、
   `ingress rule https://portico.talkincode.net/public` 三检通过。
4. 按模板写好 `run.sh` / `portico.env` / `run-cloudflared.sh`（`plutil -lint`
   校验 plist），先手动各起一次验证三个本地端口，再：

```sh
sudo cp net.portico.macstudio.plist net.portico.cloudflared.plist /Library/LaunchDaemons/
sudo launchctl bootstrap system /Library/LaunchDaemons/net.portico.macstudio.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/net.portico.cloudflared.plist
```

5. 空库首次只给匿名视图（fail-closed），按上节“首次凭证引导”建首位人类
   审计者，再由其 `grant agent:<name> --kind agent --role maintainer` 给
   Agent 建维护身份；mira 的凭证在联调时再签发，避免提前签发的密钥闲置。

## 首次凭证引导

全新部署没有任何凭证，因此**只提供匿名视图**——这是有意的 fail-closed：身份只能靠会话证明，而没有凭证就没有会话。运维者需要执行一次 bootstrap，token 只打印一次，请交给审计者本人：

```sh
docker run --rm -it -v "$PWD:/app" -w /app denoland/deno:2.9.6 \
  run --allow-read=/app --allow-write=/app/data --allow-env \
  src/cli/main.ts identity credential issue \
    --identities /app/data/identities.json \
    --sessions /app/data/sessions.json \
    --id human:security-auditor
```

## 单写者假设

`data/` 下每个 JSON 文件假定只有一个写进程（Gateway 是 `gateway-audit.json` 的唯一写者）。同一进程内的读-改-写已串行化；跨进程并发仍可能互相覆盖。详见 `docs/roadmap.md`「本地持久化与写序」。
