# Portico UI 规范

本文件是 Portal 页面层的设计契约。代码是事实来源；本规范与代码冲突时，以代码为准并同步修正本文。
实现位置：`src/portal/design/`。

> **适用范围：** 只约束「人看的页面」——内部笔记台与公开发布页。
> 不约束 `GET /api/*` 的 JSON 契约，也不约束 CLI / MCP 输出。

## 0. 两条不该被 UI 推翻的铁律

1. **公开页只渲染已过审批的记录。** `CatalogService.list` 对 reader / maintainer 会返回 `internal`
   与 `pending_public` 记录；公开页必须在视图层再筛一次（`publicOnly()`）。内部身份不得把公开页
   当作绕过审批的展示窗。
2. **维护者不能改界面。** 主题是固定预设，不是可配置字段；页面没有 body / HTML / 主题输入。
   组件盒仍只有 `catalog_card`、`catalog_detail`、`permission_hint`、`approval_status`、`audit_snippet`。

## 1. 两个平面（tone）

同一套 token 词汇，两种气质。差别只在密度、排版与强调色，不在语义。

| | `internal` 内部笔记台 | `public` 公开发布 |
| --- | --- | --- |
| 路由 | `/internal`、`/internal/c`、`/internal/audit`、`/internal/s/:id` | `/public`、`/public/t/:channel`、`/public/s/:id` |
| 读者 | 只读及以上（匿名 404） | 任何人（含匿名） |
| 可见记录 | 当前身份可见的全部（含草稿、待审、已拒绝） | 仅 `approved_public` |
| 布局 | 三栏器物面板：导航栏 + 记录列表 + 阅读区 | 报头 + 头条 + 分栏 + 右栏 |
| 字体 | 全无衬线 + 等宽数字 | 衬线标题 + 无衬线正文 + 等宽元数据 |
| 强调色 | 青绿（治理、工具） | 深绛红（出版物、署名） |
| 语气 | 陈述治理事实、给状态、给路径 | 陈述它是什么、怎么访问、为何公开 |

`/`（根路径）保持为兼容的发现索引（多角色表格），不是两个新平面的替代品。

## 2. 颜色主题

### 2.1 模式解析

模式是纯 CSS 属性，不需要脚本——Portal 的 CSP 是 `default-src 'none'`，需要脚本才能生效的主题
等于不能交付的主题。

**优先级**（`resolveTheme()`）：

1. `?theme=<preset>` 显式指定，且 preset 的 tone 必须与页面 tone 一致；
2. 非法 / 跨 tone 的值静默降级，不报错——读者拼错 URL 不该得到 500；
3. `Sec-CH-Prefers-Color-Scheme` / `X-Portico-Prefers-Color-Scheme` 请求头提示；
4. 落到该 tone 的默认预设（浅色）。

页头「浅色 / 深色」是链接（`?theme=...`），不是按钮：没有脚本时，唯一诚实的选择控件是导航，
而且链接可收藏、可被缓存正确对待。

### 2.2 预设

| preset | tone | mode |
| --- | --- | --- |
| `portico-internal-light` | internal | light |
| `portico-internal-dark` | internal | dark |
| `portico-editorial-light` | public | light |
| `portico-editorial-dark` | public | dark |

URL 短名同样被接受：`internal`、`internal-dark`、`editorial`、`editorial-dark`、`public`、`public-dark`、
`light`、`dark`。短名是 URL 契约的一部分，改动需视为破坏性变更。

### 2.3 基础 token

命名规则：`--tk-<语义>`。**布局尺寸与颜色共用 `--tk-` 命名空间，因此 palette 字段名不得等于任何
布局 token 名**（见 §6 回归测试）。

| 类别 | token |
| --- | --- |
| 画布与表面 | `canvas` `surface` `raised` `sunken` |
| 线 | `border` `borderStrong` `rule` |
| 文字 | `ink` `muted` `faint` |
| 强调 | `accent` `accentInk` `accentSoft` `accentLine` `accentOnFill` |
| 侧栏 | `panel` `panelBorder` `panelInk` `panelMuted` `panelActive` |
| 报头 | `mastheadInk` `mastheadMuted` |
| 阴影 | `--tk-shadow` `--tk-shadow-lift` |
| 字体 | `--tk-font-app` `--tk-font-body` `--tk-font-display` `--tk-font-mono` `--tk-font-num` |
| 圆角 | `--tk-r-xs` … `--tk-r-xl`、`--tk-r-pill` |
| 间距 | `--tk-s1`(4) `--tk-s2`(8) `--tk-s3`(12) `--tk-s4`(16) `--tk-s5`(20) `--tk-s6`(24) `--tk-s7`(32) `--tk-s8`(40) `--tk-s9`(56) `--tk-s10`(80) |
| 尺寸 | `--tk-shell`(1440) `--tk-read`(42rem) `--tk-list`(336px) `--tk-header-h`(56px) |
| 布局 | `--tk-rail`(232px) — 仅布局宽度，不是颜色 |

### 2.4 治理状态语义色

状态色是**语义**而非装饰：`待审公开` 在两个平面里都是同一个琥珀色。`draft` 与 `rejected` 刻意保持
中性——一个灰掉的 chip 不能看起来和「已公开」一样确定。

用法：容器上加 `data-state="state-<name>"`，自动获得 `--tk-state` / `--tk-state-soft` /
`--tk-state-line`。token 名与状态名一一对应，`stateAttr()` 是唯一生成入口。

| 状态 | token | 含义 |
| --- | --- | --- |
| `draft` | `state-draft` | 仅维护者可见 |
| `internal` | `state-internal` | 内部可达 |
| `pending_public` | `state-pending` | 待独立审批（chip 用虚线边） |
| `approved_public` | `state-public` | 已公开可达 |
| `rejected` | `state-rejected` | 惰性，公开面不可达 |

## 3. 间距、字体与密度

- 基础字号 15px，行高 1.6；正文行长上限 `--tk-read`（42rem）。
- 页面栅格上限 `--tk-shell`（1440px）。
- 字体栈**只用系统字体**：CSP 不允许引用远程字体，也不嵌入 base64 字体。
  - 正文 / 界面：`ui-sans-serif` + PingFang SC / Noto Sans CJK SC 回退
  - 公开展示字体：`Iowan Old Style` / Palatino / Georgia + Songti SC / Noto Serif CJK SC 回退
  - 等宽：`ui-monospace` / SF Mono / JetBrains Mono
- 所有数字（计数、日期、版本）用 `--tk-font-num` + `tabular-nums`，避免列表跳动。
- 断点：1080px（收起右栏 / 列表栏）、1180px（三栏 → 两栏）、900px（收起导航栏）、820px（报头导航隐藏）、720px（定义列表单列）。
- `prefers-reduced-motion: reduce` 时全部过渡降到 0.001ms。

## 4. 组件契约

公共组件在 `src/portal/design/components.ts`，两平面共用；平面专属在 `views/internal.ts` 与 `views/public.ts`。

| 组件 | 类名 | 规则 |
| --- | --- | --- |
| 状态 chip | `.tk-chip--state` | 必须来自 `stateChip()`，不手写颜色 |
| 渠道 chip | `.tk-chip--channel` | 只用 `cli` / `mcp` / `web`，显示为大写缩写 |
| 面板 | `.tk-panel` | 唯一的内容容器；不引入第二种卡片风格 |
| 缩略图 | `.int-thumb` / `.pub-art` | 由 id 哈希决定图案，禁用远程资源 |
| 空态 | `.tk-empty` | 必须同时给标题与下一步提示 |
| 边界提示 | `.tk-note--boundary` | 任何可能被误认为 runtime 的页面必须出现 |
| 键值表 | `.tk-dl` | 标签在左、值在右，窄屏单列 |
| 时间线 | `.tk-timeline` | 仅用于审计与近期轨迹 |

### 4.1 生成式图形

缩略图与插图由 `hash(id) % N` 选择 CSS 图案 + 渠道字形，**不使用图片、不引用网络、不接受
维护者输入**。CSP 里只放开了 `img-src data:`，这条约束保证它长期成立。

### 4.2 搜索框

`.tk-search` 是 `aria-hidden` 的装饰性占位，不是输入控件。Portal 是只读入口且不发送脚本，
渲染一个假的可用搜索框会是对用户的误导。真正可用的检索入口是 `/api/catalog` 与 CLI。

## 5. 无障碍

- 正文/画布对比度 ≥ 7:1；次要文字 ≥ 4.5:1；强调色 ≥ 4.5:1。由 `auditContrast()` 断言。
- 焦点环统一为 `:focus-visible` + `--tk-accent`，偏移 2px。
- 语义标签：`<header>` `<nav aria-label>` `<main>` `<aside>` `<footer>`；当前项用 `aria-current`。
- 装饰性图形 `aria-hidden="true"`；图标不承载语义。
- 面包屑、筛选组、主题切换均有可读标签。
- 打印样式：公开页隐藏报头、右栏与主题切换，图形不打印。

## 6. 安全与不变量（回归测试覆盖）

| 不变量 | 测试 |
| --- | --- |
| 公开页不出现 `internal` / `draft` / `pending_public` 记录，即使请求者是维护者 | `tests/portal_ui_test.ts` |
| 未审批记录的文章页返回 404 | `tests/portal_ui_test.ts` |
| 匿名访问 `/internal*` 返回 404，不泄漏 403 | `tests/portal_ui_test.ts` |
| 非审计者的审计页不出现在导航，也不出现在 HTML | `tests/portal_ui_test.ts` |
| 所有 token 对比度达标 | `tests/portal_theme_test.ts` |
| 布局 token 与 palette 名不冲突（`--tk-rail` 必须仍是长度） | `tests/portal_theme_test.ts` |
| 页面不含 `<script>`；CSP 保持 `default-src 'none'` | `tests/portal_ui_test.ts` |
| 名称、描述、入口转义后输出 | `tests/portal_ui_test.ts` |
| 包坐标不渲染成可下载链接 | `tests/portal_ui_test.ts` |

## 7. 修改 UI 的检查清单

1. 新颜色只能进 palette，作为语义 token；不得在模板里写十六进制色值。
2. 新 token 名不得与任何布局尺寸 token 重名（跑 `tests/portal_theme_test.ts`）。
3. 新页面若在两个平面都出现，差异必须落在 tone，不得复制两份语义。
4. 公开面新增任何内容前，先问「它是否已过审批边界」。
5. 不引入脚本、远程字体、远程图片、iframe。
6. 同步更新本文与 `docs/roadmap.md` 验收矩阵。
