# 信任根与数据存储

Portico 采用诚实、透明的**本地数据文件**作为本地信任根（Local Trust Root）。

---

## 核心数据结构与职责划分

数据目录（默认为 `data/`）下由五个核心 JSON 文件维系系统的治理状态：

```text
data/
├── identities.json      # 身份名册与角色授权记录
├── sessions.json        # 签发的凭证哈希与活跃会话状态
├── catalog.json         # 服务登记表与历史变更日志
├── approvals.json       # 公开发布的独立审批/拒绝轨迹
└── gateway-audit.json   # MCP Gateway 鉴权与直连路由不可篡改流水
```

### 1. `identities.json` (身份名册)
记录系统认可的实体主体及其角色。结构如下：
```json
{
  "identities": [
    {
      "id": "human:security-auditor",
      "kind": "human",
      "roles": ["auditor"],
      "createdAt": "2026-09-14T10:00:00.000Z"
    },
    {
      "id": "agent:catalog-bot",
      "kind": "agent",
      "roles": ["maintainer"],
      "createdAt": "2026-09-14T10:05:00.000Z"
    }
  ]
}
```

### 2. `sessions.json` (凭证与会话库)
记录已发放的凭证哈希、生命周期及通过凭证登录换取的有效会话：
```json
{
  "credentials": [
    {
      "id": "cred-1",
      "identityId": "human:security-auditor",
      "tokenHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "createdAt": "2026-09-14T10:00:00.000Z",
      "revokedAt": null
    }
  ],
  "sessions": [
    {
      "token": "pst1_abc...",
      "identityId": "human:security-auditor",
      "credentialId": "cred-1",
      "createdAt": "2026-09-14T10:01:00.000Z",
      "expiresAt": "2026-09-15T10:01:00.000Z"
    }
  ]
}
```

---

## 文件级权限与运维边界

> [!IMPORTANT]
> **本地信任根的安全边界与操作系统文件权限对齐。**  
> 对 `data/` 目录拥有操作系统级别写入权限的进程或用户，理论上具备修改甚至重置名册的能力。因此，在生产环境中，数据目录必须严格配置所属用户组与文件权限（如 `chmod 700 ./data`）。

### 原子写入保证 (Atomic Persistence)
所有对 JSON 文件的持久化写入均由 `src/fs.ts` 的 `writeJsonAtomic` 实施原子操作：
1. 先写入附带 `.tmp.<pid>.<timestamp>` 后缀的临时文件。
2. 调用系统底层 `Deno.rename` 替换原文件。
3. 保证即使在遭遇强行杀进程、断电或磁盘写满时，原有文件要么完整更新，要么保持上一次一致状态，绝不产生半截脏文件。
