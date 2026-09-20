# 部署

三份入口启动脚本 + 三份 systemd unit。**它们是版本化的**，因为部署的权限白名单决定了代码能不能跑，而重启合同必须覆盖全部三个入口：

## 为什么放在仓库里

每份脚本都用 `docker run ... deno run <权限> src/<入口>/main.ts` 的形式启动一个入口。那些权限参数是**代码的运行时契约**，不是运维细节：

- Portal 与 MCP 是只读入口，**不得**持有 `--allow-write`。
- Gateway 的写权限只覆盖审计文件与它的临时兄弟 `gateway-audit.json.tmp`，**不覆盖目录**。`src/fs.ts` 之所以先 `stat` 父目录、只在确实缺失时才 `mkdir`，就是因为 `mkdir` 需要目录写权限，而无条件调用会让每次审计追加都以 `Requires write access to "/app/data"` 失败——上一次把脚本留在服务器上，这个回归就是这样漏到生产上的。
- 三个入口都拿到同一个 `PORTICO_GATEWAY_AUDIT_PATH`，否则 Portal 与 MCP 的审计时间线会静默缺少 Gateway 访问事件，而 `audit list --audit` 有。
- Portal 与 MCP 都拿到同一个 `PORTICO_CONCLUSIONS_PATH`，否则 `GET /api/conclusions` / `portico_conclusions` 静默返回空结论，而 `audit conclusions` 有结论。该文件只由 CLI 写（Portal 与 MCP 无写权限），Gateway 不读它，因此不注入。
- Portal 与 MCP 都拿到同一个 `PORTICO_SEAL_ANCHORS_PATH`，否则 `GET /api/audit-verify` / `portico_audit_verify` 把每个支柱都报成 `anchored: 0`，而 `audit verify --anchors` 会比对——整链重写或尾部截断在 web 面上看起来就是干净的。该文件只由 CLI `audit anchor` 写（Portal 与 MCP 无写权限），Gateway 不读它，因此不注入。

`tests/deploy_contract_test.ts` 会解析这些脚本并断言上述形状；改脚本而破坏契约会红。

## 变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORTICO_DEPLOY_BIND` | `127.0.0.1` | 监听地址，同时进入 `--allow-net` 白名单。内网部署时在安装现场注入 RFC1918 单播地址，不要写进仓库，不要改成 `0.0.0.0` |
| `PORTICO_DEPLOY_PORT` | 8788 / 8789 / 8790 | 各入口端口 |
| `PORTICO_DENO_IMAGE` | `denoland/deno:2.9.6` | 运行镜像（部分宿主 glibc 过旧，跑不了官方二进制） |
| `PORTICO_DOCKER` | `/usr/bin/docker` | docker 可执行文件 |
| `PORTICO_DEPLOY_REVIEW_ORIGIN` | `off` | 本部署对外提供的审核入口：`off` 表示不提供（页眉不出现审核链接），也可写成审核服务的绝对 origin，页眉会链到那里。未设置按「不提供」处理，不外推 |

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

## 验证（`verify.sh`）

部署之后跑只读门禁，确认**在服务的是新修订、而且是产品页**：

```sh
PORTICO_EXPECT_SHA=$(git rev-parse origin/main) ./deploy/verify.sh
PORTICO_DEPLOY_ALLOW_UNPINNED=1 ./deploy/verify.sh   # 只有拿不到修订时才这么跑
```

不打补丁、不重启、不需要 sudo、不写数据目录；唯一临时文件在 `$TMPDIR`。每条承诺按名字报 `ok` / `FAIL` / `skip`，任一 `FAIL` 即非零退出，所以「重启后没验证」不会被说成「已更新」。

`PORTICO_EXPECT_SHA` 是**必填**，不是可选项：探测只证明行为，而行为恰恰是「从没重启过的守护进程」也照样给出的回答，所以一次没点名修订的运行等于没验证过任何部署。把它留在绿色探测后面静默通过，正是当初加这条钉住要消掉的那种沉默。只有显式接受才会降级成 `skip`：主机不是检出时仍可探测，但记录上写明它只证明了行为。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORTICO_DEPLOY_BIND` | 不设 | 与 `run-*.sh` 同一个监听地址；内网实地用 drop-in / `EnvironmentFile` 注入，不要写进仓库。不设时门禁从监听表读地址；同一端口有两个监听地址就 FAIL，不猜 |
| `PORTICO_DEPLOY_PORTAL_PORT` / `PORTICO_DEPLOY_GATEWAY_PORT` / `PORTICO_DEPLOY_MCP_PORT` | 8788 / 8789 / 8790 | 三个入口的端口 |
| `PORTICO_DEPLOY_TREE` | 脚本的上一级 | 入口所服务的检出；用来判断监听进程是否比代码旧 |
| `PORTICO_EXPECT_SHA` | 不设即 FAIL | 钉住检出修订；不设且没有下面的显式接受时报 `FAIL checkout-revision`，不冒充通过 |
| `PORTICO_DEPLOY_ALLOW_UNPINNED` | 不设即不接受 | 只认 `1`/`true`/`yes`/`on`（与运行时的开关判定同一套口径，大小写不敏感）；置真后没钉修订的那条报 `skip` 并点名本变量 |
| `PORTICO_DEPLOY_REVIEW_ORIGIN` | `off` | 与 `run-portal.sh` 同一个声明；门禁据此判断产品页有没有挂出本部署不提供的审核入口 |

它分开检查的四件事各自都像成功：端口有回答、地址是部署声明的那个、页面有标题、进程还在跑。发现页与 404 壳共用同一个 `<title>`，所以门禁按发现壳的结构标记判断，而不是只看状态码。

`entrance-address` 与 `entrance-not-all-interfaces` 先把「验证的是哪个地址」说清楚。内网部署把入口绑到单播地址（既不是回环，也不是 `0.0.0.0`），门禁必须按同一个地址验证：地址来自 `PORTICO_DEPLOY_BIND`，没声明时来自监听表里唯一的那个地址，端口上有两个地址时 FAIL 并点名，绝不用回环默认值去替一份健康的内网部署宣布失败。同理，只按端口取进程会让同端口上的遗留入口冒充正在服务的那个，所以进程时间这条也按地址匹配。绑定到所有接口的入口只有在主机上才看得见，因此这条也只能在主机上判。macOS 侧的同名门禁在 `deploy/macos/verify.sh`。

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

现场 runbook（幂等，可重复执行收敛主机到仓库）：

```sh
cd ~/portico/app && git pull --ff-only origin main
PORTICO_HOME=~/portico PORTICO_TUNNEL_ID=<uuid> \
  PORTICO_EDGE_BIND=<本机出口 ip> PORTICO_USER=<本机用户名> \
  ./deploy/macos/render.sh
sudo cp ~/portico/net.portico.*.plist /Library/LaunchDaemons/
sudo launchctl kickstart -k system/net.portico.macstudio
sudo launchctl kickstart -k system/net.portico.cloudflared
PORTICO_EXPECT_SHA=$(git rev-parse HEAD) ./deploy/macos/verify.sh
```

注意：`kickstart -k` 只重启进程，不重读 plist 文件；改了 plist 内容
（新增环境变量、路径）后必须 `bootout` + `bootstrap` 一次，否则旧定义
继续生效（已因此丢过一次 `PORTICO_EDGE_BIND`，cloudflared 起不来）。纯
代码更新用 `kickstart -k` 即可。

`render.sh` 是无 sudo 的确定性渲染：模板里的 `/Users/example`、
`TUNNEL_ID`、`EDGE_BIND_IP`、daemon 用户全部来自上述四个变量；
`portico.env` 只在首次不存在时从示例创建，之后永不覆盖；渲染后自动
`bash -n`、`plutil -lint` 与 `ingress validate`。首次建隧道仍是三条 CLI：
`cloudflared tunnel create` → `route dns` → 填 `PORTICO_TUNNEL_ID` 重跑
`render.sh`。首次 bootstrap（空库只给匿名视图）见下节“首次凭证引导”：
建首位人类审计者，再由其 `grant agent:<name> --kind agent --role maintainer`
给 Agent 建维护身份；mira 的凭证在联调时再签发，避免提前签发的密钥闲置。

## macOS 门禁：`deploy/macos/verify.sh`

只读、不需 sudo，任一失败即非零退出。默认值就是本机部署的形状（四个入口在
回环、一个公网 origin），可用环境变量指向别的部署；四个入口的端口与 origin
都可覆盖，因为一份只能在宿主机上验证的门禁等于一份没法验证的门禁：

| 变量 | 默认 | 用途 |
| --- | --- | --- |
| `PORTICO_DEPLOY_BIND` | `127.0.0.1` | 四个入口服务的地址 |
| `PORTICO_DEPLOY_PORTAL_PORT` / `..._GATEWAY_PORT` / `..._MCP_PORT` / `..._REVIEW_PORT` | 8788 / 8789 / 8790 / 8791 | 四个入口的端口 |
| `PORTICO_DEPLOY_PUBLIC_ORIGIN` | `https://portico.talkincode.net` | 隧道对外服务的 origin |
| `PORTICO_DEPLOY_TREE` | 脚本所在的检出 | 入口所服务的检出；用来判断进程是否比代码旧 |
| `PORTICO_EXPECT_SHA` | 不设即 FAIL | 钉住检出修订；不设且没有下面的显式接受时报 `FAIL checkout-revision`，不冒充已验证 |
| `PORTICO_DEPLOY_ALLOW_UNPINNED` | 不设即不接受 | 只认 `1`/`true`/`yes`/`on`（与运行时的开关判定同一套口径）；置真后没钉修订的那条报 `skip` 并点名本变量 |

与 Linux 门禁同一套语义：钉住的修订对不上就 FAIL，**根本没钉也是 FAIL**——
行为探针只证明行为，而行为恰好是从没被替换过的旧进程照样给出的回答。
只有显式接受才会把那一条降级成 `skip`，并且在这一行里写明它只证明了
行为；主机不是检出时仍能探测，但记录上不会出现一条没点名修订的「全绿」。

它回答三个问题，按「最便宜发现、最贵漏掉」排序：检出是不是你钉的修订
（`checkout-revision`，没钉就没通过）、**四个入口分别是哪个进程在服务**
（`running-code-not-stale`）、每个入口是否各自兑现契约。

第二条是本机的重点。`launchctl kickstart -k` 是真正把 pull 送上线的那一步，
而「pull 了但没重启」会让上一版修订继续在同样的端口上用同样的产品页应答——
行为探针看不出区别，因为行为正是那个从未被替换的进程在回答。门禁因此把每个
入口解析到一个 pid（先按 `PORTICO_DEPLOY_BIND` 上的地址匹配，取不到再退回该
端口上的监听者），拿它的启动时刻与 `PORTICO_DEPLOY_TREE/src` 里最新的文件比：
进程比它服务的代码还旧，就是「静默空转的重启」。与 Linux 门禁不同，「入口没有
进程」在这里是 FAIL 而不是 `skip`：本部署固定是同一个监管者拉起的四个入口，
少一个不是未知，是系统没起来。绑定到所有接口的检查不在这里重复——运行时的
`src/runtime/bind.ts` 本身就拒绝 `0.0.0.0`、`::` 与公网地址，非回环绑定会先
让入口起不来。

入口契约四条：Portal `/public` 200、Review `/review/login` 200、Gateway 的
工具调用 POST 405（它鉴权与路由，不执行工具）、MCP 对 `initialize` 返回
`portico`；加上公网 origin 上的两条对应探测、匿名目录信封与匿名 `/internal`
404。端口开着不等于契约成立，所以 Gateway 与 MCP 是被直接问过的那两个。


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
