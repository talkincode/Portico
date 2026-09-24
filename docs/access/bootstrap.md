# 首位人类审计者引导 (Bootstrap)

在首次部署 Portico 时，系统面临典型的“先有鸡还是先有蛋”的信任根初始化难题：当名册文件完全为空时，谁来执行第一次授权？

Portico 设计了严谨的 **空名册一次性 Bootstrap 机制**。

---

## Bootstrap 的三步流程

### 第一步：登记首位人类审计者
当 `identities.json` 为空（或文件尚不存在）时，系统允许**无需任何会话参数**执行首次 `grant`：

```bash
deno task cli -- identity grant \
  --identities ./data/identities.json \
  --id human:security-auditor \
  --kind human \
  --role auditor
```

**内部校验规则**：
- 仅当名册内没有任何有效主体时，才允许无 `--session` 执行。
- 引导的主体必须显式指定 `--kind human` 且包含 `--role auditor`。严禁在引导阶段创建 Agent。

---

### 第二步：一次性发放首张初始凭证
首次签发凭证同样豁免会话校验：

```bash
deno task cli -- identity credential issue \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --id human:security-auditor
```

控制台将输出包含一次性明文 Token 的 JSON（令牌在 `data.token`）：
```json
{
  "ok": true,
  "data": {
    "id": "crd-human-security-auditor-20260924000000000-1a2b3c4d",
    "subjectId": "human:security-auditor",
    "credentialRef": "issued:crd-human-security-auditor-20260924000000000-1a2b3c4d",
    "token": "pct1_7f8a3c4d5e6f...",
    "issuedAt": "2026-09-24T00:00:00.000Z"
  }
}
```

> [!WARNING]
> **Token 仅在此时打印一次！**  
> 服务端在 `sessions.json` 中仅保存该 Token 的 SHA-256 哈希。一旦首张凭证签发完成，系统的 Bootstrap 模式即刻**永久关闭**。后续所有 `credential issue` 必须携带已登录审计者的有效会话。

---

### 第三步：凭证登录并获取初始会话

```bash
deno task cli -- identity login \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --id human:security-auditor \
  --token pct1_7f8a3c4d5e6f...
```

输出换取的 Session 令牌（字段是 `data.token`，不是 `data.session`）：
```json
{
  "ok": true,
  "data": {
    "sessionId": "ses-human-security-auditor-20260924000000000-9f8e7d6c",
    "token": "pst1_1a2b3c4d5e...",
    "actor": { "id": "human:security-auditor", "kind": "human", "role": "auditor" },
    "expiresAt": "2026-09-24T08:00:00.000Z"
  }
}
```

至此，首位人类审计者拥有了合法的会话令牌（`data.token` 里的 `pst1_...`）。同一枚 `pct1_` 凭证也能直接在浏览器上登录：`POST /login` 或 `GET /login` 表单，登录成功后落在 `/internal`。从此往后，系统中所有的名册变更、Agent 授权和凭证轮转，都必须出示该会话（或派生出的其他审计者会话）进行签名。
