# Supervisor 进程管理 (up)

为了让开发者与运维人员在单机部署或本地开发时免除“开三个窗口分别起动三个进程”的繁琐步骤，Portico 提供了内置的监管脚本 `src/up/main.ts`（通过 `deno task up` 触发）。

---

## 协同退出与进程编排机制

`up` 是一个轻量的进程监督器，而不是将三个服务代码合并在同一个进程内执行：

1. **真实多进程隔离**：
   `up` 会通过操作系统 `Deno.Command` 分别派生出三个完全独立的子进程：
   - `portal` 子进程（严格无 `--allow-write`）
   - `gateway` 子进程（仅对审计文件开放 `--allow-write`）
   - `mcp` 子进程（严格无 `--allow-write`）
2. **信号级联联动（Cascading Shutdown）**：
   - 监听宿主的 `SIGINT`（Ctrl+C）与 `SIGTERM` 信号，收到后向三个子进程分发终止信号，优雅回收端口。
   - 监听任意子进程的崩溃事件：一旦其中某一个服务由于未捕获异常退出，`up` 会立即强行收走其余存活的子进程，**绝不留下一个 Gateway 还活着但 Portal 已经挂掉的半死系统**！

---

## 使用与机读输出

```bash
PORTICO_DATA_DIR=./data deno task up
```

起动成功后，标准输出将输出唯一一行标准机读 JSON：
```json
{"ok":true,"data":{"dataDir":"./data","portal":{"url":"http://127.0.0.1:8788"},"gateway":{"url":"http://127.0.0.1:8789"},"mcp":{"url":"http://127.0.0.1:8790"}}}
```

自动化部署脚本或外部进程管理器可直接解析该行 JSON 获取各入口的实际服务地址。
