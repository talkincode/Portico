# 独立二进制编译 (build)

借助 Deno 内置的静态编译引擎，Portico 可以打包为完全独立的原生免依赖二进制文件。在目标生产服务器上，您甚至**无需安装 Deno、Node.js 或任何解释器**即可直接执行。

---

## 构建命令

执行全局构建：
```bash
deno task build
```

构建脚本（`src/build/main.ts`）将在根目录下的 `dist/` 文件夹内编译生成 4 个独立产物：
- `dist/portico`：Portico CLI 客户端工具。
- `dist/portico-portal`：Web Portal 服务端。
- `dist/portico-gateway`：MCP Gateway 网关服务。
- `dist/portico-mcp`：MCP Protocol Server 服务。

也可以指定单个产物进行按需构建：
```bash
deno task build cli
deno task build portal
```

---

## 权限内嵌特性 (Embedded Permissions)

这是 Deno 编译产物非常强大的安全特性：
- 在调用 `deno compile` 时，构建脚本已经将每个二进制所需的**最小权限白名单硬编码嵌入了二进制头部**。
- 例如：`portico-portal` 二进制在编译时未赋予 `--allow-write`，那么无论运维人员在宿主机上以何种用户权限运行该二进制，该进程物理上都绝对无法执行写文件操作，从而实现了操作系统级别的强沙箱固化。
