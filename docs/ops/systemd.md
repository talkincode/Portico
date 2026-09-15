# Systemd 生产服务编排

在 Linux 生产环境中，推荐使用 Systemd 托管独立编译的二进制服务。

仓库的 `deploy/` 目录下提供了完整的开箱即用脚本与服务配置模板。

---

## 服务架构切分方案

生产环境推荐将 Portal、Gateway、MCP 作为三个独立的 Systemd 服务运行：

```text
/etc/systemd/system/
├── portico-portal.service
├── portico-gateway.service
└── portico-mcp.service
```

---

## Systemd 单元配置示例 (`portico-mcp.service`)

参考 `deploy/portico-mcp.service`：

```ini
[Unit]
Description=Portico MCP Protocol Server
After=network.target

[Service]
Type=simple
User=portico
Group=portico
WorkingDirectory=/opt/portico
Environment=PORTICO_DATA_DIR=/var/lib/portico
Environment=PORTICO_BIND=127.0.0.1
Environment=PORTICO_MCP_PORT=8790
ExecStart=/opt/portico/bin/portico-mcp
Restart=always
RestartSec=5s

# 强化 Linux 命名空间与沙箱隔离
ProtectSystem=strict
ProtectHome=true
ReadOnlyPaths=/var/lib/portico/catalog.json /var/lib/portico/identities.json /var/lib/portico/sessions.json
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

### 生产配置关键点
- **专用非特权用户**：使用无特权的 `portico` 系统账号运行。
- **只读挂载**：在 Systemd 层面使用 `ReadOnlyPaths` 为 Portal 和 MCP 进程锁死底层数据文件的读取权限，即便在 Linux 内核级别也禁止其改写数据。
