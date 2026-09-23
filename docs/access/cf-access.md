# Cloudflare Access JWT 映射（Portal 与 Review 可选）

Portico 不是身份提供者，也不托管登录界面。Portal 与 Review 在**显式启用**时，可以把 Cloudflare Access 签发的 JWT 映射到本地名册上的人类身份。这不是第二套可写身份，也不会签发 `pst1_` 会话。

CLI、Gateway 与 MCP 继续只认 Portico 会话。Cloudflare 边缘的 GitHub/邮箱登录如果要存在，只存在于边缘，不进入本仓库；Review 自带的 GitHub OAuth 见下节。

---

## 何时启用

默认关闭。未设置 `PORTICO_CF_ACCESS_ENABLED`，或缺少合法 team / audience 时，现有 CLI 会话路径不变，JWT 被忽略。

同时满足下列条件才启用：

| 变量 | 作用 | 示例（占位符） |
| --- | --- | --- |
| `PORTICO_CF_ACCESS_ENABLED` | 打开映射。仅 `true` / `yes` / `on` / `1` 视为开启 | `true` |
| `PORTICO_CF_ACCESS_TEAM` | Access team 名，只允许 `[a-z0-9-]`，用于拼 ISS 与默认 JWKS | `example` |
| `PORTICO_CF_ACCESS_AUD` | Application audience，防止跨应用重放 | `example-audience` |
| `PORTICO_CF_ACCESS_JWKS_URL` | 可选覆盖。缺省为该 team 的 Cloudflare certs URL | `http://127.0.0.1:9/certs`（仅测试） |

`example` team 对应的 ISS 是 `https://example.cloudflareaccess.com`。JWKS 覆盖只允许：

- 测试用 `http://127.0.0.1/...`
- 该 team 的 `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`

其它 URL、缺 team、缺 audience：功能保持关闭，而不是 500。

真实 team 名与 AUD 只在安装现场注入，不要写进本仓库、CI 或示例实值。

---

## 名册绑定

外部登录成功不等于拥有特权。JWT 里的 email 必须命中名册中的**人类**身份；Agent 不能带邮箱。

```bash
deno task cli -- identity grant \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session "$AUDITOR_SESSION" \
  --id human:reader \
  --kind human \
  --role reader \
  --email reader@example.invalid
```

邮箱会大小写归一。`reader@example.invalid` 只是文档占位符。邮箱不是第二身份证明：没有合法 JWT 或会话时，它不会让请求变成已登录。

---

## Portal 如何判定身份

1. 已有 Portico 会话（`Authorization: Bearer` 或 `X-Portico-Session`）优先。
2. 无会话且功能已启用时，读取 `Cf-Access-Jwt-Assertion`，校验 RS256 签名、`aud`、`iss`、`exp`，再用已校验 email 查名册。
3. 明文 `Cf-Access-Authenticated-User-Email` **不是证明**，单独携带该头仍是匿名。
4. 都没有或任何一步失败：匿名。`/internal` 返回 HTML 404，不泄漏目录。

成功或失败都**不写** `identities.json` / `sessions.json`，不签发会话。Portal 进程仍然没有 `--allow-write`。

这是 fail-closed：伪造签名、过期、AUD 不匹配、JWKS 不可达、名册未登记，全部降为匿名，而不是变成 500 打开内部面。

---

## 边缘 IdP（不在本仓库）

GitHub 组织登录与邮箱 One-time PIN 在 [Cloudflare Access identity providers](https://developers.cloudflare.com/cloudflare-one/identity/idp-providers/) 配置。Client Secret 与 OTP 投递留在 Cloudflare，不要复制进 Portico、环境示例或审计日志。

JWT 校验口径见 [Validating JSON Web Tokens](https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/)。

---

## 明确不做

- 不在 Portal 实现邮箱 OTP 或本地 SMTP。
- 不把 Cloudflare Tunnel / `cloudflared` 配置、隧道 token 或反代模板收进本仓库。那是边缘基础设施。
- 不把 JWT 扩到 CLI、Gateway 或 MCP。
- 不把未审批对象变成公开可达。匿名与失败映射看到的仍是公开面。


---

## Portal GitHub OAuth 登录（统一入口）

Portal 提供统一的 GitHub OAuth 登录入口。`GET /login` 显示登录页（含 GitHub 按钮），`GET /oauth/start` 跳到 github.com（带 state cookie 防 CSRF），`GET /oauth/callback` 换 code、取用户与 verified 邮箱。allowlist（`PORTICO_REVIEW_ALLOWLIST`，GitHub login 或邮箱，空即全拒）先过，再用 verified 邮箱命中名册人类并签发普通 Portico 会话（`Secure; HttpOnly; SameSite=Lax` cookie，`Path=/`）。GitHub 决定"你是谁"，名册决定"你能看到什么"；非 auditor 照样不能访问审计面。一次性凭证登录表单保留作恢复入口。

环境变量（默认全关，缺任一项即关闭）：`PORTICO_REVIEW_GITHUB_ENABLED`、`PORTICO_REVIEW_GITHUB_CLIENT_ID`、`PORTICO_REVIEW_GITHUB_CLIENT_SECRET`（只在主机）、`PORTICO_REVIEW_GITHUB_CALLBACK`（必须 https）、`PORTICO_REVIEW_ALLOWLIST`。启用时 `up` 给 Portal 进程追加 `github.com` 与 `api.github.com` 出站权限。

**推荐部署**：将 GitHub OAuth App 的 Authorization callback URL 设置为 Portal `/oauth/callback`，例如 `https://portico.talkincode.net/oauth/callback`。Portal 和 Review 共用同一套凭证配置。Review 的 `/review/oauth/start` 会自动重定向到 Portal `/oauth/start`，实现统一登录。

---

## Review GitHub OAuth 登录（兼容模式）

如需保持 Review 独立的 OAuth 回调（回调 URL 为 `/review/oauth/callback`），Review 会直接处理 OAuth 流程。`GET /review/oauth/start` 跳到 github.com，`GET /review/oauth/callback` 完成登录。会话 cookie 的 `Path=/review`，仅限 Review 使用。

启用时 `up`/`build` 给 Review 进程追加 `github.com` 与 `api.github.com` 出站。如果回调 URL 指向 Portal（`/oauth/callback`），Review 的 `/review/oauth/start` 会 303 重定向到 `/oauth/start`，由 Portal 统一处理。
