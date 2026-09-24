# 内部草稿与发布

本章介绍维护者如何使用 Portico CLI 进行服务的草稿保存、内部发布以及向组织外部提交公开候选。

---

## 1. 保存为草稿 (`catalog draft`)

当服务描述尚未定稿，或端点尚在联调中时，维护者可以先将其登记为草稿：

```bash
# 准备 draft-agent.json
cat << 'EOF' > draft-agent.json
{
  "id": "sql-optimizer",
  "name": "SQL 优化专家",
  "description": "分析复杂 SQL 执行计划并输出重写建议",
  "channels": ["cli"],
  "entry": {
    "kind": "package",
    "value": "jsr:@tools/sql-optimizer@0.1.0"
  },
  "version": "0.1.0",
  "visibility": "internal",
  "maintainers": [{ "id": "agent:sql-bot", "kind": "agent" }]
}
EOF

# 登记草稿
deno task cli -- catalog draft \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $MAINTAINER_SESSION \
  --input ./draft-agent.json
```

**特点**：
- 此时 `governanceState` 为 `draft`，`visibility` 为 `internal`。
- 其他普通 `reader` 角色调用 `catalog list` 时，该记录被自动过滤，不会造成视图干扰。

---

## 2. 内部正式发布 (`catalog publish internal`)

当草稿联调完毕，可将其发布为组织内部可消费的正式服务：

```bash
deno task cli -- catalog publish \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $MAINTAINER_SESSION \
  --id sql-optimizer \
  --visibility internal
```

**特点**：
- `governanceState` 转换为 `internal`。
- 组织内所有拥有 `reader`、`maintainer` 或 `auditor` 角色的成员均可在 Portal 内部笔记台或 CLI 查阅并使用该服务。
- 外部公网访问依然完全无法察觉该服务的存在。

---

## 3. 直接内部登记 (`catalog register`)

如果一开始服务就已完备，可直接一步登记为内部服务：

```bash
deno task cli -- catalog register \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $MAINTAINER_SESSION \
  --input ./sql-agent.json
```

> [!TIP]
> `catalog register` 创建的记录默认进入 `internal` 状态。若传入文件试图硬编码 `"visibility": "public"`，命令将直接抛出 `PUBLIC_REQUIRES_APPROVAL` 错误并拒绝写入。

---

## 4. 提交公开申请 (`catalog publish public`)

当希望向组织外部公开该服务时，维护者发起公开申请：

```bash
deno task cli -- catalog publish \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $MAINTAINER_SESSION \
  --id sql-optimizer \
  --visibility public
```

此时：
- 记录的 `governanceState` 变为 `pending_public`。
- 匿名公网访客**依然不可见**。
- 审批队列中将新增待办，等待独立人类审计者查验合规性。
