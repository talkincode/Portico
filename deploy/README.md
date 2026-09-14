# 部署

三份入口启动脚本 + 一份 systemd unit。**它们是版本化的**，因为部署的权限白名单决定了代码能不能跑：

## 为什么放在仓库里

每份脚本都用 `docker run ... deno run <权限> src/<入口>/main.ts` 的形式启动一个入口。那些权限参数是**代码的运行时契约**，不是运维细节：

- Portal 与 MCP 是只读入口，**不得**持有 `--allow-write`。
- Gateway 的写权限只覆盖审计文件与它的临时兄弟 `gateway-audit.json.tmp`，**不覆盖目录**。`src/fs.ts` 之所以先 `stat` 父目录、只在确实缺失时才 `mkdir`，就是因为 `mkdir` 需要目录写权限，而无条件调用会让每次审计追加都以 `Requires write access to "/app/data"` 失败——上一次把脚本留在服务器上，这个回归就是这样漏到生产上的。
- 三个入口都拿到同一个 `PORTICO_GATEWAY_AUDIT_PATH`，否则 Portal 与 MCP 的审计时间线会静默缺少 Gateway 访问事件，而 `audit list --audit` 有。

`tests/deploy_contract_test.ts` 会解析这些脚本并断言上述形状；改脚本而破坏契约会红。

## 变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORTICO_DEPLOY_BIND` | `10.201.15.192` | 内网监听地址，同时进入 `--allow-net` 白名单 |
| `PORTICO_DEPLOY_PORT` | 8788 / 8789 / 8790 | 各入口端口 |
| `PORTICO_DENO_IMAGE` | `denoland/deno:2.9.6` | 运行镜像（宿主 glibc 2.27 跑不了官方二进制） |
| `PORTICO_DOCKER` | `/usr/bin/docker` | docker 可执行文件 |

数据目录固定为检出目录下的 `data/`，只有 Gateway 以可写方式挂载它。

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
