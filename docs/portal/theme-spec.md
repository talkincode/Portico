# 颜色主题系统与无脚本规范

Portico 的 Web 界面全面践行现代 CSS 现代化设计，不依赖任何构建期打包工具或第三方 CSS 框架（如 Tailwind、Bootstrap），完全依靠原生 CSS 自定义属性（Variables）与纯语义 Token 实现主题渲染。

---

## 四大固定颜色主题预设

根据双平面（内部工作台 vs 公开发布页）与明暗模式的组合，Portico 固化了四个精心调校的主题预设：

| 主题标识符 | 适用平面 | 调性基调 | 典型色彩 |
| :--- | :--- | :--- | :--- |
| **`internal-light`** | 内部笔记台 | 沉稳纸质白底、高信息对比度 | 背景 `#f6f4ee`，文字 `#1b2228`，边框 `#d5d0c3` |
| **`internal-dark`** | 内部笔记台 | 工程控制台深灰、护眼暗调 | 背景 `#11161b`，文字 `#e1e7ec`，强调色 `#3bb273` |
| **`editorial-light`**| 公开发布页 | 社论杂志纸张米白、典雅排版 | 背景 `#faf8f5`，标题 `#121820`，品牌蓝 `#1f4e5b` |
| **`editorial-dark`** | 公开发布页 | 雅致夜间杂志黑、精致对比 | 背景 `#0e1318`，柔和白 `#f0f4f8`，点缀金 `#e6af2e` |

---

## 主题切换机制与优雅降级

用户可通过 URL 查询参数 `?theme=<theme_name>` 显式指定期望的视觉主题：

```text
http://127.0.0.1:8788/internal?theme=internal-dark
http://127.0.0.1:8788/public?theme=editorial-dark
```

### 解析与降级决策顺序
1. **URL 参数优先**：若 `?theme=` 参数为合法预设，则优先使用。
2. **操作系统偏好探测**：若未显式传参，浏览器将通过媒体查询 `@media (prefers-color-scheme: dark)` 自动选择该平面的暗色或浅色版本。
3. **非法与跨平面降级**：
   - 若在 `/internal` 传入了不存在的主题（如 `?theme=unknown`），系统静默回退为 `internal-light`。
   - 若在 `/public` 强行传入内部主题（如 `?theme=internal-dark`），系统将其优雅降级为公开发布页对应的 `editorial-dark`，杜绝因非法参数造成 500 异常。

---

## 零 JavaScript 规范 (Zero-JS Policy)

Portico 的前端页面具备严格的防御性安全边界：
- 严格禁止引入 `<script>` 标签与内联 JS 事件代码（如 `onclick="..."`）。
- 抽屉展示、模态浮层、分类标签高亮均采用纯 CSS（如 CSS `:checked`、`:target` 或详情标签 `<details>/<summary>`）实现。
- 绝不调用任何外部字体（如 Google Fonts）或外部 CDN 样式表，所有排版字体优先采用操作系统无衬线系统字体栈（System Font Stack），确保在无外网连接的物理隔离内网中秒级秒开。
