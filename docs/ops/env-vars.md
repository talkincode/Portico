# 环境变量配置参考

Portico 支持通过环境变量对各进程的监听地址、端口与数据文件路径进行精细化配置。

---

## 核心环境变量清单

| 环境变量名 | 适用服务 | 默认值 | 详细说明 |
| :--- | :--- | :--- | :--- |
| **`PORTICO_DATA_DIR`** | 全局/up | `./data` | 数据总根目录。各服务的文件路径未单独指定时，从此目录派生。 |
| **`PORTICO_BIND`** | 全局 | `127.0.0.1` | 网络监听绑定地址。接受 `127.0.0.1`、`localhost` 或 RFC1918 私网 IP（如 `10.x.x.x`、`192.168.x.x`）。**拒绝绑定 `0.0.0.0` 或公网 IP**。 |
| **`PORTICO_PORT`** | Portal | `8788` | Portal 服务的 HTTP 监听端口。 |
| **`PORTICO_GATEWAY_PORT`**| Gateway | `8789` | MCP Gateway 网关服务的 HTTP 监听端口。 |
| **`PORTICO_MCP_PORT`** | MCP | `8790` | MCP Protocol Server 的 HTTP 监听端口。 |
| **`PORTICO_CATALOG_PATH`**| Portal/GW/MCP | `${DATA_DIR}/catalog.json` | 目录服务数据文件的绝对或相对路径。 |
| **`PORTICO_IDENTITIES_PATH`**| 全局 | `${DATA_DIR}/identities.json`| 身份名册数据文件路径。 |
| **`PORTICO_SESSIONS_PATH`** | 全局 | `${DATA_DIR}/sessions.json` | 凭证与会话数据文件路径。 |
| **`PORTICO_GATEWAY_AUDIT_PATH`**| GW/Portal/MCP| `${DATA_DIR}/gateway-audit.json`| 网关访问流水文件路径。若给 Portal/MCP 配置，则其审计视图会并入网关流水。 |
| **`PORTICO_PAGE_PATH`** | Portal/CLI | `${DATA_DIR}/page.json` | 自定义门户组件盒布局配置文件路径（可选）。 |
| **`PORTICO_CF_ACCESS_ENABLED`** | Portal | 关闭 | 是否启用 Cloudflare Access JWT 映射。未设为 `true`/`yes`/`on`/`1` 时忽略 JWT，现有会话路径不变。 |
| **`PORTICO_CF_ACCESS_TEAM`** | Portal | （无） | Cloudflare Access team 名，只允许 `[a-z0-9-]`。用于拼 ISS 与默认 JWKS URL。缺省则功能保持关闭。 |
| **`PORTICO_CF_ACCESS_AUD`** | Portal | （无） | Access Application audience。缺省则功能保持关闭。 |
| **`PORTICO_CF_ACCESS_JWKS_URL`** | Portal | team 默认证书 URL | 可选覆盖。只允许 `http://127.0.0.1/...`（测试）或该 team 的 `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`。其它 URL 会使功能保持关闭。操作说明见 [Cloudflare Access JWT 映射](../access/cf-access.md)。 |

---

## 内网监听绑定安全提示

> [!CAUTION]
> 出于严谨的最小暴露原则，Portico 默认仅绑定本地回环接口 `127.0.0.1`。  
> 若需要在内网集群中使用，请显式指定具体的私有网卡 IPv4 地址（例如 `PORTICO_BIND=192.168.1.100`）。系统会主动拒绝 `0.0.0.0`，以防止运维人员无意间将未加密的 HTTP 端口直接暴露在公网路由器上。
