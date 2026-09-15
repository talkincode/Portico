# 受约束的组件盒 (UI Components)

为了满足自定义门户页面的诉求，同时杜绝引入任意 HTML 或富文本编辑器带来的 XSS 与视觉混乱风险，Portico 提供了**受严格约束的门户组件盒（Constrained Component Box）**。

---

## 门户不是 CMS

> **核心原则：组件盒保持小而硬。**  
> Portico 不是 WordPress，不是通用低代码建站器，也不提供任意 HTML 注入能力。维护者只能通过 JSON 格式组合系统预定义的受约束组件。

---

## 预定义组件类型一览

系统仅允许在页面配置（`page.json`）中使用以下 5 种组件：

| 组件标识符 | 功能说明 | 渲染安全限制 |
| :--- | :--- | :--- |
| **`catalog_card`** | 服务简要卡片，展示标题、描述片段、渠道 Badge 与状态标识。 | 仅展示已授权字段，自动转义所有文本。 |
| **`catalog_detail`** | 服务全量详情面板，展示完整的 Markdown 描述与连接方式。 | 严格过滤 HTML 标签与伪协议链接。 |
| **`permission_hint`** | 权限状态提示横条，告知访客当前是以匿名还是以某已登录角色浏览。 | 纯静态文本占位。 |
| **`approval_status`** | 公开审批状态卡片，呈现独立人类审计者的签字印章与审计时间戳。 | 仅对已签署的记录渲染。 |
| **`audit_snippet`** | 简要审计流水切片，展示该服务最近 3 次治理变更记录。 | 仅对拥有审计权限的人员可见。 |

---

## 页面配置与维护 (`page set / get`)

维护者可通过 CLI 设置门户的页面组件排布：

```bash
# 准备 page.json
cat << 'EOF' > page.json
{
  "title": "研发基础设施 Agent 导航台",
  "blocks": [
    {
      "type": "permission_hint"
    },
    {
      "type": "catalog_card",
      "targetId": "github-tools"
    },
    {
      "type": "catalog_card",
      "targetId": "code-review-cli"
    }
  ]
}
EOF

# 保存页面排布
deno task cli -- page set \
  --page ./data/page.json \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $MAINTAINER_SESSION \
  --input ./page.json
```

**安全保证**：
- 系统在保存前会逐一校验引用的 `targetId` 是否真实存在。
- 如果页面配置中引用了一个尚未审批通过公开的内部服务，匿名访客浏览页面时，系统会自动将该组件剔除，绝不发生通过页面排布泄露未审批服务信息的安全事故。
