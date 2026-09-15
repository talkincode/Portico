# 受治理的表面更新

在服务迭代过程中，维护者经常需要修订 Agent 的功能描述、更新入口版本号或增减访问渠道。Portico 提供了受治理的表面更新机制（`catalog update`）。

---

## 允许更新的范围与限制

```bash
deno task cli -- catalog update \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $MAINTAINER_SESSION \
  --id sql-optimizer \
  --input ./updated-patch.json
```

### 允许修改的字段
- `name`：修改人类可读名称。
- `description`：修改业务说明、参数指引等文档文本。
- `version`：更新版本号（如 `0.1.0` -> `0.2.0`）。
- `channels` & `entry`：调整通信渠道或更新入口地址（如更换 MCP 链接、升级 CLI 包版本）。

### 严格禁止直接修改的字段
- `id`：服务的唯一业务主键不可篡改。
- `maintainer`：维护归属关系受审计追踪约束。
- `governanceState` 与 `visibility`：**严禁通过 update 绕过状态机直接提权或发布公开**！

---

## 状态与可编辑性矩阵

Portico 针对不同生命周期阶段实行差异化编辑准入：

| 当前状态 | 是否允许直接 `update` | 治理设计原理 |
| :--- | :---: | :--- |
| **`draft`** | **允许** | 处于草稿阶段，维护者可自由修改调试。 |
| **`internal`** | **允许** | 组织内部服务，变更不会造成公开信任边界外泄。系统将记录原子变更日志。 |
| **`rejected`** | **允许** | **核心设计！** 被拒绝的表面从未越过边界。如果将其做成不可变终态，会导致“拒绝→修改→重新提交”闭环断裂，并永久污染该 `id`。 |
| **`pending_public`** | **禁止** | 正在接受审计，锁定快照，防止“偷梁换柱”（在审计者阅读后偷改恶意端点）。必须先由审计者 `reject` 退回。 |
| **`approved_public`** | **禁止** | 已对全网公开，必须保持与审批快照的一致性。若需更新，审计者必须先 `withdraw` 撤回至内部。 |

---

## 渠道与入口的一致性再校验

当 `catalog update` 同时或分别修改 `channels` 与 `entry` 时，系统会像首次登记一样执行强一致性校验：
- 若将 channels 扩展为 `["mcp", "web"]`，但 `entry` 中未提供 `url`，更新将被立即拒绝并回滚。
- 若传入了非法协议（如 `javascript:`）或疑似包含凭证的 URL，操作将报错拦截。
