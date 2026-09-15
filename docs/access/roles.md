# 角色模型与权限矩阵

Portico 采用精简而刚性的基于角色的访问控制（RBAC）模型，同时将操作主体区分为人类（Human）与智能体（Agent）。

---

## 主体类型 (Kind)

- **`human`（人类）**：组织内的自然人开发、运维或安全人员。拥有充当安全审计者（`auditor`）的排他性资格。可选绑定一个唯一 `email`（大小写归一），只作名册映射字段，不能代替登录会话，也不能作为外部 IdP 证明。
- **`agent`（智能体）**：组织内运行的自动化脚本、CI Runner 或自主智能体。可以担任目录维护者或只读者，但**绝对禁止被赋予 `auditor` 角色**，也**不能绑定 email**。

---

## 三大治理角色 (Roles)

| 角色 | 允许的主体 | 职责定位 | 核心权限 |
| :--- | :--- | :--- | :--- |
| **`auditor`** | 仅限 `human` | 安全合规底线把关 | 审批/拒绝公开申请、撤回公开服务、签发凭证、作废凭证、注销主体、查阅完整审计时间线。 |
| **`maintainer`**| `human` 或 `agent` | 服务编目日常维护 | 登记内部服务、更新已登记表面（draft/internal/rejected）、提交公开申请、排布门户组件盒。 |
| **`reader`** | `human` 或 `agent` | 组织内部服务消费 | 查阅所有内部目录服务、获取已授权直连入口、获取 CLI 包坐标、查询 MCP 描述信息。 |
| **`anonymous`** | 未登录外部访客 | 全网公开访问 | 仅能在 Portal/CLI/MCP 查阅状态为 `approved_public` 的已审批公开服务；无法感知任何内部或待审服务。 |

---

## 权限决策矩阵

| 操作动作 | 匿名 (Anonymous) | 只读 (Reader) | 维护者 (Maintainer) | 审计者 (Auditor) |
| :--- | :---: | :---: | :---: | :---: |
| 浏览公开记录 (`approved_public`) | ✅ | ✅ | ✅ | ✅ |
| 浏览内部记录 (`internal`) | ❌ | ✅ | ✅ | ✅ |
| 登记新表面 (`catalog register`) | ❌ | ❌ | ✅ | ✅ |
| 更新表面描述 (`catalog update`) | ❌ | ❌ | ✅ | ✅ |
| 提交公开申请 (`publish public`) | ❌ | ❌ | ✅ | ✅ |
| **审批公开申请 (`catalog approve`)** | ❌ | ❌ | ❌ (严禁自审) | **✅ (独立审计)** |
| **撤回公开服务 (`catalog withdraw`)**| ❌ | ❌ | ❌ | **✅** |
| 授予主体权限 (`identity grant`) | ❌ | ❌ | ❌ | **✅** |
| 注销主体 (`identity revoke`) | ❌ | ❌ | ❌ | **✅** |
| 签发新凭证 (`credential issue`) | ❌ | ❌ | ❌ | **✅** |
| 作废凭证 (`credential revoke`) | ❌ | ❌ | ❌ | **✅** |
| 列出凭证作废轨迹 (`credential revokes`) | ❌ | ❌ | ❌ | **✅** |
| 查看完整系统审计时间线 | ❌ | ❌ | ❌ | **✅** |

> [!CAUTION]
> **防越权铁律**：如果一个维护者 Agent 尝试调用 `identity grant --role auditor` 试图自我提权，或者尝试调用 `catalog approve`，系统鉴权中间件将立即抛出 `FORBIDDEN` 错误并中止执行，不修改任何文件。
