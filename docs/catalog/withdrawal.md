# 公开发布撤回

当公开服务出现突发安全漏洞、上游依赖失效或业务下线时，必须能够迅速切断外部公开暴露。Portico 提供了安全、不可篡改的公开发布撤回机制（`catalog withdraw`）。

---

## 撤回的治理意义

撤回是公开信任边界的**收缩方向**：
- 撤回后，记录立即回到 `internal` 状态，对匿名公众与外部 API 调用完全隐藏，响应不泄漏任何端点。
- 组织内成员（Reader 及以上）依然可以从内部通道访问该记录，以便定位排查问题。
- 撤回操作与批准操作处于同一最高信任平面：**仅限拥有 `auditor` 角色的人类审计者可以执行**。维护者、只读人员或匿名访客执行撤回将收到 `FORBIDDEN` 错误。

---

## 撤回命令实操

```bash
deno task cli -- catalog withdraw \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $HUMAN_AUDITOR_SESSION \
  --id sql-optimizer
```

**响应示例**：
```json
{
  "ok": true,
  "data": {
    "id": "sql-optimizer",
    "governanceState": "internal",
    "visibility": "internal",
    "withdrawnAt": "2026-09-14T12:00:00.000Z"
  }
}
```

---

## 核心安全保障

1. **多端即时切断**：
   - Portal 的 `/public` 页面立刻移除该服务卡片；直接访问 `/public/s/sql-optimizer` 立即返回标准 HTML 404，且不返回任何内部入口地址。
   - Gateway 收到该服务的匿名鉴权请求立即返回 404。
   - MCP Protocol 端点对匿名只返回存活公开服务，被撤回服务瞬间消失。
2. **状态前置机读校验**：
   - 只有当前处于 `approved_public` 的记录才允许撤回。对 `internal`、`pending_public`、`rejected` 或已撤回的记录执行撤回，将返回 `INVALID_STATE`。
3. **不可篡改审计证据**：
   - 撤回事件会以 `action: "withdrawn"` 原子追加至 `approvals.json`（包含执行者、时间戳与版本号）。
4. **重新上线门槛**：
   - 撤回后的记录若需再次公开，维护者必须重新执行 `catalog publish --visibility public`，使其回到 `pending_public` 候选状态，必须重新经受独立人类审计者的全流程审批，绝无“自动恢复”后门。
