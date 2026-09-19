# 零明文密钥引用原则

在 Agent 生态中，硬编码密钥（如 OpenAI API Key、GitHub Personal Access Token、AWS AccessKey）是极易发生外泄的高危隐患。

Portico 实行彻底的**零明文密钥（Zero-Plaintext-Secrets）原则**。

---

## 密钥治理铁律

1. **绝对不存明文**：
   - 登记的 Catalog 元数据、自定义页面组件、审计流水中，严禁写入任何明文密码或 API Token。
   - 提交的数据如果包含疑似密钥字段（如检测到以 `sk-` 开头、AWS Access Key ID `AKIA`/`ASIA` 形值，或带有明文密码属性），写入校验逻辑将直接抛出错误并拒绝落盘。入口 URL 还会扫描查询参数名、查询值与 fragment；文档锚点或路径中的普通词（如 `/auth/token#installation`）不是密钥。区域名 `asia-pacific` 不是 Access Key。
2. **只引用，不托管**：
   - Agent 与服务若需要认证凭证，应在运行时通过外部专业的密钥管理系统（如 HashiCorp Vault、AWS Secrets Manager 或本地环境变量）自行注入。
   - Portico 只负责登记服务的访问入口，绝不代存、代传任何外部服务的调用密钥。
3. **日志与错误脱敏**：
   - CLI 与 Portal 在报错输出中严禁将可能包含敏感信息的环境变量内容或完整堆栈直接暴露给终端。
