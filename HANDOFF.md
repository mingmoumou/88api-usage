# 交接文档 HANDOFF —— 88API 用量桌面挂件

> 给接手继续开发的 AI / 人看。读完这份就能动手，不需要再去问原作者。
> 最后更新：2026-11-11

## 1. 这是什么

一个常驻 Windows 桌面的小程序，实时显示 **88api.ai**（new-api 中转站）账号的花钱情况：
余额、累计消费、今日消费/请求/token、按模型的消费排行、最近一条请求、折线走势。

- 形态：Electron 无边框透明卡片（384×280），置顶、可拖动、不进任务栏、有托盘图标。
- 数据来源：88api 的 HTTP 接口（**没有 WebSocket / SSE**，所谓"实时"= 每 15 秒轮询一次增量日志）。
- 数据落盘：本地 `data/logs.jsonl`（一行一条请求），所以历史不依赖站点保留期。
- 附带产物：`dashboard.html`（网页版完整看板，挂件每轮顺手重写）。

## 2. 目录结构与数据流

```
88api-usage/
├─ sync.mjs          取数层：鉴权、读接口、翻页、去重、增量窗口、落盘
├─ report.mjs        聚合层：算钱、按天/按模型/按 Key 汇总、渲染 HTML
├─ run.mjs           CLI：sync | watch | serve（挂件不需要它，别和挂件同时跑）
├─ selftest.mjs      纯 node 跑一遍取数+聚合，验证链路
├─ rendercheck.mjs   用 node:vm + 假 DOM 跑 index.html 的脚本，验证渲染层
├─ make-ico.py       icon.png → 多尺寸 88api.ico（DIB 帧，见坑 #6）
├─ create-shortcut.ps1        建桌面快捷方式（图标复制到 LocalAppData）
├─ 打开挂件.bat / 诊断启动.bat / 创建桌面快捷方式.bat / 安装开机自启.bat / 移除开机自启.bat
├─ dashboard.html    生成物
├─ data/
│  ├─ logs.jsonl     全量流水（一行一条 JSON，按 id 唯一）
│  ├─ state.json     采集水位
│  └─ snapshot.json  最近一次聚合结果（给外部程序读）
└─ widget/
   ├─ main.js        主进程：轮询 tick、托盘、右键菜单、窗口状态、IPC、截图模式
   ├─ preload.js     contextBridge：onData / onPinned / act
   ├─ index.html     卡片 UI（自包含 CSS/JS + SVG sparkline）
   ├─ package.json   main: main.js
   ├─ window.json    窗口位置/尺寸/刷新间隔/置顶（运行时生成）
   ├─ debug.log      boot / ready / before-quit / 异常堆栈
   ├─ icon.png       256×256 源图
   └─ 88api.ico      桌面图标本体
```

数据流（全部在 `widget/main.js` 的 `tick()` 里）：

```
loadAuth()            → 从 %USERPROFILE%\.88api\video-studio.json 读 accessToken / userId
loadSettings(headers) → GET /api/status，缓存一次（quota_per_unit=500000 等）
loadStore(LOG)        → 读 logs.jsonl
since = max(ts) - 120 → 增量起点（重叠窗口，防漏）
fetchConsumption      → GET /api/log/self?p=1..&page_size=100&start_timestamp=since&type=2
去重 → appendStore     → 只追加没见过的 id
loadAccount           → GET /api/user/self（余额 / 累计消费 / 请求数）
aggregate(rows, st)   → 今日、模型、Key、近 14 天、最近 25 条、均价
writeAll(...)         → data/snapshot.json + dashboard.html
webContents.send('data', payload) → 渲染层
```

## 3. 接口（都实测过，鉴权只要两个头）

```
Authorization: Bearer <accessToken>
New-API-User: <userId>
```

| 用途 | 请求 | 关键字段 |
|---|---|---|
| 流水 | `GET /api/log/self?p=1&page_size=100&type=2[&start_timestamp=<秒>][&model_name=]` | `data.items[]`：`id, created_at(秒), model_name, quota, prompt_tokens, completion_tokens, use_time, is_stream, token_name, token_id, group, channel, request_id, other(JSON 字符串)` |
| 账号 | `GET /api/user/self` | `data.quota`(余额 quota), `data.used_quota`(累计), `data.request_count` |
| 站点 | `GET /api/status` | `quota_per_unit=500000`, `display_in_currency`, `quota_display_type="CNY"`, `price`, `usd_exchange_rate`, `log_max_range_days=365` |
| 其他 | `GET /api/user/models`、`GET /api/pricing`、`GET /api/token/?p=0&size=10` | 可用模型 / 计价表达式 / Key 列表 |

**金额换算：`金额 = quota / 500000`（元）**，与站点钱包页一致。`other` 里还有 `billing_unit`（`image`/`request`/token 类）、`cache_tokens`、`model_price`、`matched_tier`。

`GET /api/user/dashboard` 普通用户是 **403 AUTH_INSUFFICIENT_PRIVILEGE**，别用。

## 4. 已经踩过的坑（照做，别重试错的方向）

1. **分页 `p` 从 1 开始**。`p=0` 和 `p=1` 返回同一页（offset 都是 0），从 0 翻会重复抓第一页。必须 `p=1` 起，且单次抓取内按 `id` 去重。
2. **排序是 `created_at` 降序，`id` 不随时间单调**（id=1 是最新）。增量只能靠 `start_timestamp` + 120 秒重叠窗口，不能拿 id 当水位。
3. **`total` 与翻页结果可能不一致**，靠 id 去重收敛，不要等 total。
4. **日志累计 ≠ 钱包累计**：本机 459 条日志合计 ¥26.26，`used_quota` 只有 ¥25.14。差额是失败请求退款（日志留着、钱退回去了）。看板两个数都显示，不强行对齐。
5. **日志在请求结束后才写入**，进行中的请求看不到；流式请求按结束时刻落一条。
6. **自制 ICO 别用 PNG 帧**：Pillow 默认每帧都写 PNG，Windows 只认 256×256 的 PNG 帧，其它尺寸必须是 DIB/BMP，否则资源管理器显示成空白文件图标。`make-ico.py` 已按此实现（16→128 用 DIB，256 用 PNG）。
7. **桌面快捷方式的 `.ico` 不能放在工作区里**：资源管理器读不到（沙箱 ACL），会显示空白图标。必须复制到 `%LOCALAPPDATA%\88api-widget\icon.ico` 再引用。两个建快捷方式的脚本都已这么做。
8. **工具 shell 里有 `ELECTRON_RUN_AS_NODE=1`**，直接跑 electron.exe 会被当 node 用（报 Cannot find module 'electron'）。启动前 `unset ELECTRON_RUN_AS_NODE`。
9. **electron 在受限沙箱里起不来**（0x80000003 / crashpad not connected / tasklist Access denied）。要在正常用户会话里启动；用 `powershell Start-Process` 之类**分离**方式启动，否则进程会挂在启动它的 shell/job 下，shell 一结束挂件就没了（已实测）。
10. **挂件和 `run.mjs serve` 不能同时跑**，两者都写 `data/logs.jsonl`。

## 5. 运行环境

| 依赖 | 本机位置 / 说明 |
|---|---|
| Electron | `C:\Users\23572\.dsh\electron\electron.exe`（43.3.0 / Node 24.18.1，**不需要 npm install**） |
| Node | `C:\Users\23572\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`（PATH 里没有，跑脚本要全路径或用 `API88_NODE`） |
| Python + Pillow | 只有 `make-ico.py` 用到；也可以直接沿用已生成的 `widget/88api.ico` |
| 凭据 | `C:\Users\23572\.88api\video-studio.json` 的 `accessToken` / `userId`；也可用环境变量 `API88_ACCESS_TOKEN` / `API88_USER_ID` 覆盖 |

**换机器要改的地方**：electron 路径（`create-shortcut.ps1`、`安装开机自启.bat`、两个 .bat 里的字号都是显式路径，可换成一个共享的 `config`）、node 路径（只影响命令行脚本）。挂件本体、数据、UI 都是相对路径，搬走即可用。

环境变量开关（都在代码里）：
`API88_BASE` / `API88_ACCESS_TOKEN` / `API88_USER_ID` / `API88_USAGE_DIR` / `API88_POLL` / `API88_WIDGET_POLL` / `API88_WIDGET_SHOT`（截图自检模式）。

## 6. 安全

- 读账用的是**只读个人访问令牌**，不是 API Key。别把 token 写进代码或提交进仓库；`.88api\video-studio.json` 在用户目录，不在工程里。
- `C:\Users\23572\.88api\image-gen.json` 里的 API Key 是明文（很早前配的），与本工程无关，但**不要读取或外泄**。
- `data/logs.jsonl` 是真实消费记录（模型名、金额、Key 名），属于隐私数据，外发前先脱敏。

## 7. 搬目录之后必做

快捷方式里存的是绝对路径，挪动工程后要重建：

1. 双击 `创建桌面快捷方式.bat`
2. 双击 `安装开机自启.bat`

（或者直接运行 `迁移工程.bat`，它会复制到新位置并自动重建这两处。）

## 8. 值得继续做的方向（按性价比排序）

1. **落盘换 SQLite**：现在每次全量读 `logs.jsonl` 再聚合，日志过万后内存和耗时都会上来；换成 SQLite + 按天/模型建索引，顺便解决并发写。
2. **日志轮转**：jsonl 只增不减，按年归档或压缩旧的。
3. **失败重试与退避**：现在接口抖一下会跳过这一轮，只在 UI 上标"同步失败"；可以加 3 次指数退避 + 断点续传。
4. **告警**：余额 < N 元、今日花费 > N 元时托盘气泡/系统通知；这是这个挂件最实用的下一步。
5. **刷新策略自适应**：请求进行中（有 in-flight）时加快到 3 秒，安静时降到 60 秒，省接口调用。
6. **多账号**：目前写死单账号；`/api/token` 已经能列 Key，可做按 Key 分账视图。
7. **时区/口径配置**：`ymd()` 现在硬编码 +8h，出国或跨时区要可配。
8. **测试**：`selftest.mjs` + `rendercheck.mjs` 是脚本不是测试框架；至少给 `aggregate()` 补单测（纯函数，最好测）。
9. **打包**：现在依赖 DSH 自带的 electron.exe；要分发给别人得用 electron-builder 打成独立 exe。

## 9. 给接手的 AI 的提示词（直接粘贴）

> 这个项目是一个 Electron 桌面挂件，用来实时展示 88api.ai 中转站的消费情况。请先读 HANDOFF.md 和 README.md，再读 sync.mjs → report.mjs → widget/main.js → widget/index.html。
> 代码是纯 ESM + CommonJS 混合（主进程里用 `await import(pathToFileURL(...))` 加载 .mjs），没有 npm 依赖，没有构建步骤，改完直接重启用 `打开挂件.bat`。
> 数据都在 data/logs.jsonl，验证聚合逻辑用 `node selftest.mjs`，验证 UI 逻辑用 `node rendercheck.mjs`，截图自检用 `API88_WIDGET_SHOT=路径 electron.exe widget`。
> 改完请保持：卡片仍是自包含单文件、不加外部 CDN、不动 `data/` 里的真实数据、不把 token 写进代码。
