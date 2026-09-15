# 防自批与会话防伪机制

在组织治理中，“既当运动员又当裁判员”是导致严重安全责任事故的温床。Portico 在代码内核深度固化了防自批（Anti-Self-Approval）与会话防伪机制。

---

## 防自批机制的深度实现

Portico 杜绝自审自批的防御逻辑包含多层交叉校验：

```typescript
// 伪代码展示 src/catalog/approval.ts 中的强校验逻辑
export function assertCanApprove(
  record: CatalogRecord,
  actor: SessionIdentity,
): void {
  // 1. 角色必须包含 auditor
  if (!actor.roles.includes("auditor")) {
    throw new PorticoError("FORBIDDEN", "只有审计者角色有权批准公开");
  }

  // 2. 主体必须为人类
  if (actor.kind !== "human") {
    throw new PorticoError("FORBIDDEN", "智能体主体严禁执行公开审批");
  }

  // 3. 核心防自批：当前审批者不得为服务维护者
  if (record.maintainer === actor.id) {
    throw new PorticoError(
      "SELF_APPROVAL",
      `禁止自我批准：主体 ${actor.id} 是该服务的登记维护者，必须由其他独立审计者审批`
    );
  }
}
```

### 为什么即使是人类审计者也不能自批？
假设某人类工程师张三同时拥有某代码助手服务的维护权与公司的 Auditor 角色：
- 当张三自己提交了一个服务公开申请时，他**依然不能批准自己提交的这一条申请**。
- 必须由团队内的另一位人类审计者李四进行交叉复审。
- 该设计彻底消除了因个人疏忽或内部账号被盗导致的单点安全沦陷。

---

## 会话防伪与不可逆哈希

为了防止客户端通过篡改网络包伪造身份：
1. **彻底废除自称请求头**：服务端不接受任何形式的 `X-Portico-Actor-Id` 或 `X-Portico-Actor-Role`。所有关于角色与身份的判定完全以服务端解出的有效 Session 为唯一事实来源。
2. **凭证单向哈希比对**：
   - 客户端持有的凭证为明文令牌（如 `pct1_...`）。
   - 服务端读取令牌后执行 `crypto.subtle.digest("SHA-256", tokenBytes)`，仅与库中存储的十六进制哈希比对。
   - 即使日志文件或中间临时文件外泄，攻击者也绝无法逆向推导出原始凭证以获取未授权会话。
