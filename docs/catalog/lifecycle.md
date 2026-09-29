# 生命周期状态机

Portico 将服务的生命周期划分为 **5 种明确的状态**，状态流转受到角色权限与治理动作的刚性约束。

---

## 状态定义一览

| 状态标识 | 说明 | 组织内可见度 | 外部匿名可见度 | 允许的操作 |
| :--- | :--- | :---: | :---: | :--- |
| **`draft`** | 本地草稿，尚未在组织内发布 | 仅创建者可见 | ❌ 不可见 | `publish internal`, `update` |
| **`internal`** | 组织内部正式服务 | 组织内所有人可见 | ❌ 不可见 | `publish public`, `update` |
| **`pending_public`**| 公开候选，等待独立人类审计 | 组织内可见 | ❌ 不可见 | `approve`, `reject` (仅限审计者) |
| **`approved_public`**| 已通过审批，全网公开可用 | 全局可见 | ✅ 匿名可见 | `withdraw` (仅限审计者) |
| **`rejected`** | 公开审批被驳回，退回内部修改 | 组织内可见 | ❌ 不可见 | `update`, 重新 `publish` |

---

## 状态流转图解

| 从 | 动作 | 到 | 谁 |
| --- | --- | --- | --- |
| `draft` | `publish internal` | `internal` | 维护者 |
| `internal` | `publish public` | `pending_public` | 维护者 |
| `pending_public` | `approve` | `approved_public` | 人类审计者 |
| `pending_public` | `reject` | `rejected` | 人类审计者 |
| `approved_public` | `withdraw` | `internal` | 人类审计者 |
| `rejected` | 修改后再次 `publish public` | `pending_public` | 维护者 |

`rejected` 从未越过公开边界，维护者可以改完再提。`approved_public` 不能原地修改，必须先由审计者撤回。

---

## 核心流转规则说明

1. **草稿（draft）的隔离性**：
   维护者通过 `catalog draft` 创建的记录不会出现在常规 Reader 的列表中，便于维护者打磨描述。
2. **公开绝不能“顺便成功”**：
   无论调用者是谁，即使是拥有最高权限的系统管理员，调用 `catalog register` 或 `catalog publish --visibility public` 时，记录状态也**只能进入 `pending_public`**，绝对无法直接落盘为 `approved_public`。
3. **退回与可编辑性设计**：
   被驳回（`rejected`）的记录由于从未越过公开信任边界，因此允许维护者使用 `catalog update` 修改不合规的说明或端点，随后重新提交审批。
4. **已公开记录禁止原地偷改**：
   一旦记录成为 `approved_public`，维护者严禁直接调用 `update` 修改端点或版本（防止恶意替换已被批准的合规服务）。若需变更，审计者必须先执行 `withdraw` 撤回公开，再走重新提交流程。
