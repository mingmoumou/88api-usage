# 交接文档 HANDOFF —— API 用量灵动岛（多站点）

> 给接手继续开发的 AI / 人看。读完这份就能动手，不需要再去问原作者。
> 最后更新：2026-11-20 ｜ 版本：**v1.0.7**（`VERSION`）

## 1. 这是什么

一个常驻 Windows 桌面的小挂件，实时显示 **API 中转站账号的花钱情况**：余额、今日消费 / 请求 / token、
按模型的调用次数与金额、近 24 小时走势。目前支持两个站点：

| 站点 | 内核 | 鉴权 | 余额单位 |
|---|---|---|---|
| 88API（88api.ai） | new-api | 只读「访问令牌」 | `¥`（quota / 500000） |
| APIMart（apimart.ai） | OpenAI 兼容网关 | `sk-` API Key | credits |

- **没有 WebSocket / SSE**，所谓「实时」= 每 N 秒（默认 5–15s）轮询接口。
- 88API 的消费日志逐条落盘到 `data/logs.jsonl`，历史不依赖站点保留期；APIMart **只有聚合数据**（无逐条明细）。
- 挂件每轮顺手重写 `dashboard.html`（网页版看板）。

## 2. 形态与交互（v1.0.7 现状）

| 形态 | 窗口尺寸 | 说明 |
|---|---|---|
| `card` 卡片 | 384×**340**（内容可视高 328，`body` 有 6px 内边距） | 完整信息；可拖边角改大小（`window.json` 的 `w`/`h`） |
| `island` 横胶囊 | 300×**52**（胶囊可视高 40） | 余额 + 今日 token + 站点名；多站点每 5s 轮播 |
| `side-l` / `side-r` 竖条 | 52×**300** | 整个胶囊 `rotate(±90°)` 贴住左右屏幕边缘 |
| `expanded` | 384×340 | **已废弃**，只有截图模式 `API88_WIDGET_MODE=expanded` 会用到 |

交互（都改过好几轮，别再按老印象写）：

| 手势 | 行为 |
|---|---|
| 拖卡片**标题栏** | 移动卡片窗口（手动拖动，3px 阈值区分点击/拖动） |
| 把卡片拖到屏幕顶部（**从下方越过分界线**） | 收成横胶囊，x 跟随卡片中心 |
| **双击标题栏** | 直接收回横胶囊 |
| 双击胶囊 / 右键「恢复为卡片」 | 展开卡片：**顶边与胶囊对齐、水平居中**（不会往下跳） |
| 按住横胶囊拖动 | 随意移动；松手时若贴左/右边缘（≤40px）→ 变竖条 |
| 按住竖条拖离边缘 | 变回横胶囊（纵向位置沿用） |
| **卡片正文右键** / 点 `⋯` | 自定义菜单（见 §4 坑 #11：标题栏上右键是系统菜单） |

关键状态都在 `widget/window.json`：`x/y/w/h`（卡片）、`island{x,y}`、`hidden:[]`（不显示的站点）、`poll`、`pinned`。

## 3. 目录结构与数据流

```
88api-usage/
├─ sync.mjs          88API 取数层：鉴权、翻页、按 request_id 去重、增量窗口、落盘
├─ apimart.mjs       APIMart 取数层：/v1/user/balance + /v1/usage 聚合（缓存 60s）
├─ report.mjs        聚合层：算钱、按天/按模型/按 Key 汇总、渲染 HTML
├─ run.mjs           CLI：sync | watch | serve（挂件不需要，别和挂件同时跑）
├─ selftest.mjs      纯 node 跑一遍 88API 取数+聚合
├─ rendercheck.mjs   node:vm + 假 DOM 跑 index.html 的脚本，验证渲染层
├─ make-ico.py       icon.png → 多尺寸 ico（DIB 帧，见坑 #6）
├─ auth.example.json 凭据模板（复制成 auth.json）
├─ auth.json         真实凭据，**gitignore，绝不提交**
├─ VERSION / CHANGELOG.md / HANDOFF.md / README.md
├─ docs/index.html   GitHub Pages 展示页（含 docs/preview.png）
├─ data/             隐私数据，gitignore
│  ├─ logs.jsonl     88API 全量流水（一行一条，按 requestId 唯一）
│  ├─ state.json     采集水位
│  └─ snapshot.json  最近一次聚合结果
└─ widget/
   ├─ main.js        主进程：多站点 tick、形态状态机、托盘、菜单、IPC、截图模式
   ├─ preload.js     contextBridge：onData / onPinned / onMode / onOpenConfig / act
   ├─ index.html     全部 UI（自包含 CSS/JS + SVG sparkline + 拖动手势）
   ├─ package.json   只有 devDependencies.electron，无构建步骤
   ├─ window.json    运行态（gitignore）
   ├─ debug.log      boot / ready / shown / menu / side-snap / restore / island-moved
   ├─ preview.png    README 用的脱敏预览图（DEMO 数据生成）
   ├─ icon.png / 88api.ico
```

数据流（`widget/main.js` 的 `tick()`）：

```
cycleAt = new Date()                    ← 一轮只取一次时间，所有站点共用（v1.0.4）
allSites = loadSiteConfigs(sync)        ← 已配凭据的站点
sites    = allSites - state.hidden      ← 用户隐藏掉的站点不拉、不显示
for 每个 site:
  tick88api  → pull()（增量日志）→ aggregate() → writeAll()（snapshot + dashboard）
  tickApimart→ /v1/user/balance + /v1/usage?group_by=model|date
  成功后 updatedAt = cycleAt
currentSiteId → 按 id 找下标（隐藏站点后不会错位）
send('data', { sites: [payload...], current }) → 渲染层
```

渲染层三个函数：`render(payload)`（卡片）、`renderIsland(payload)`（胶囊/竖条）、`renderDots()`（站点圆点）。

## 4. 已经踩过的坑（照做，别重试错的方向）

**88API 接口层**

1. **分页 `p` 从 1 开始**，从 0 翻会重复抓第一页。
2. **排序是 `created_at` 降序，`id` 是按时间倒序的「行号」不是全局 ID**。增量只能靠 `start_timestamp` + 120s 重叠窗口。
3. **去重必须用 `request_id`**。曾经用 `id` 去重，站点日志一多行号重排，新日志全被判成「已存在」丢掉 → 余额在变但 token 恒 0、模型列表「暂无调用」。
4. **`total` 与翻页结果可能不一致**，靠去重收敛，别等 total。
5. **日志累计 ≠ 钱包累计**：差额是失败请求退款。看板两个数都显示，不强行对齐。
6. **自制 ICO 别用 PNG 帧**：只有 256×256 能用 PNG，其余必须 DIB，否则资源管理器显示空白图标。
7. **快捷方式的 `.ico` 不能放工作区**：要复制到 `%LOCALAPPDATA%\88api-widget\icon.ico`。

**Electron / 窗口层**

8. **`-webkit-app-region: drag` 的区域，页面收不到任何鼠标事件**。它会让系统把那块当「窗口标题栏」：右键弹系统菜单（还原/移动/关闭），双击也不进页面。本项目的卡片标题栏、胶囊、竖条**全部改成手动拖动**（`mousedown` 记 screenX/screenY → IPC `move-by` → `win.setPosition`），就是为了保住右键菜单和双击。
9. **透明窗口里圆角元素的外投影会被方形窗口边界裁成直角**。别加外 `box-shadow`，用内高光替代。
10. **形态切换存在 IPC 与窗口缩放的时序竞争**：窗口先缩、内容后切，会看到卡片被挤在胶囊里。`index.html` 末尾用媒体查询按窗口尺寸兜底（`max-width:340px and max-height:200px`）。
11. **标题栏上右键仍是 Windows 系统菜单**——那块必须手动拖（见 #8），系统会接管；卡片正文右键才走自定义菜单。
12. **`ELECTRON_RUN_AS_NODE=1`** 时 electron.exe 会被当 node 跑（Cannot find module 'electron'），启动前要清掉。
13. **单实例锁**：已有挂件在跑时，新实例静默退出（日志只有 `boot` 没有 `ready`）。自动化测试前先 `Stop-Process -Name electron`。
14. **`persist()` 在动画/拖动中会写入中间尺寸**，污染下次启动几何。现在动画中以 `animating` 跳过、拖动中以 `dragging` 跳过。

**测试方法层**

15. **CDP (`--remote-debugging-port`) 的鼠标坐标是窗口内坐标**，窗口一移动 `screenX` 就自我放大，**不能用它验证拖动的绝对位移**（实测应走 100px 得到 490px）。拖动算法只能用假 DOM 单测验增量，绝对位移人工测。
16. CDP 注入的点击**绕过 Windows 命中测试**，所以 `app-region:drag` 会不会吞右键/双击这类问题，CDP 测不出来，只能看结构是否正确 + 人工复验。
17. **PowerShell `Set-Content -Encoding utf8` 写出的 JSON 带 BOM**，`JSON.parse` 会抛错并被 try/catch 吞掉 → 配置静默退回默认值。改配置用 Python `json.dump` 或 Write 工具。

## 5. 运行环境

| 依赖 | 说明 |
|---|---|
| Node.js（含 npm） | 只在 `npm install` 和命令行脚本（`selftest.mjs`/`rendercheck.mjs`/`run.mjs`）需要 |
| Electron | 查找顺序：`API88_ELECTRON` → `widget/node_modules/electron/dist/electron.exe` → 本机 `C:\Users\23572\.dsh\electron\electron.exe`。三个 .bat/.ps1 都已按此顺序查找 |

环境变量开关：

`API88_BASE` / `API88_ACCESS_TOKEN` / `API88_USER_ID` / `API88_USAGE_DIR` / `API88_POLL` /
`API88_ELECTRON` / `API88_WIDGET_POLL` / `API88_WIDGET_SHOT`（截图自检）/ `API88_WIDGET_MODE`（card|island|side-l|side-r|expanded）/
`API88_WIDGET_DEMO`（示例数据，不拉接口）/ `API88_WIDGET_NEEDTOKEN`（强制缺令牌面板）/ `API88_WIDGET_PET`（已作废，勿用）

凭据读取优先级（`sync.mjs` 的 `loadAuth()`）：环境变量 `API88_ACCESS_TOKEN` → 项目根 `auth.json` →
`~/.88api/video-studio.json`（早期 seedance 插件留下的，别人机器上没有，所以对外只宣传 `auth.json`）。
`userId` 可留空，`/api/user/self` 只靠 Bearer 就能识别用户。

自检：

```bash
node selftest.mjs        # 88API 取数 + 聚合
node rendercheck.mjs     # 渲染层（假 DOM，不需要窗口）
# 截图自检（DEMO 数据）：
API88_WIDGET_DEMO=1 API88_WIDGET_MODE=card API88_WIDGET_SHOT=widget/shot.png electron.exe widget
```

## 6. 安全

- 读账用**只读访问令牌**，不是 API Key。`auth.json` 已 gitignore；代码里不得出现任何凭据。
- APIMart 的 key 是**能付费调用**的 `sk-` 密钥，风险高于只读令牌，不要外传。
- `data/logs.jsonl` 是真实消费记录，外发前先脱敏；`dashboard.html`、`widget/window.json`、`debug.log`、`shot_*.png` 全部 gitignore。
- 仓库是公开的（`github.com/mingmoumou/88api-usage`），提交前务必 `git status` 检查有没有夹带隐私文件。

## 7. 版本与回滚

| tag | 内容 |
|---|---|
| `v1.0.0` | 首个稳定版：双形态、多站点、站点圆点、配置面板 |
| `v1.0.1` | 灵动岛可在屏幕上方任意位置收胶囊、胶囊可自由拖动；移除悬停展开 |
| `v1.0.2` | 拖到左右边缘吸附成竖条 |
| `v1.0.4` | 两站点刷新时间统一；右键可单独隐藏某站点 |
| `v1.0.5` | 修复展开卡片下移 56px，改为在胶囊原位展开 |
| `v1.0.6` | 修复右键弹系统菜单（标题栏不再整块可拖） |
| `v1.0.7` | 双击标题栏收回胶囊；标题栏改手动拖动 |

> `v1.0.3`（竖排文字版竖条）已被本人否掉并回滚，tag 已删、代码仍在历史里（`git revert 0a26041` 可找回）。
> 宠物功能（v1.1.0 计划）已作废，代码在分支 `archive/pet-v1.1.0`。

回滚：`git checkout v1.0.6`（或对应 tag）。

## 8. 继续做的方向（按性价比）

1. **告警**：余额 < N、今日花费 > N 时发系统通知——最实用的下一步。
2. **拖动节流 / 改回原生拖动**：现在每帧一次 IPC，若觉得发飘可改成 rAF 合并或 16ms 节流。
3. **落盘换 SQLite**：`logs.jsonl` 全量读+聚合，过万条会慢。
4. **打包**：现在依赖外部 electron.exe，分发要 electron-builder。
5. **第三个站点**：把 `apimart.mjs` 抽成通用适配层（88api / apimart 的字段映射差异都在各自模块里）。
6. **APIMart 代理**：`auth.json` 加 `proxy` 字段，用 undici ProxyAgent 显式走代理（目前靠系统代理）。

## 9. 给接手的 AI 的提示词（直接粘贴）

> 这是一个 Electron 桌面挂件（Windows），展示 API 中转站账号的余额与消费。先读 `HANDOFF.md` → `README.md` → `CHANGELOG.md`，
> 再读 `widget/main.js`（主进程 + 形态状态机）→ `widget/index.html`（UI + 手势）→ `sync.mjs` / `apimart.mjs`（取数）。
> 没有构建步骤、没有 npm 运行依赖，改完重启 `打开挂件.bat` 即生效。
> 验证方式：`node rendercheck.mjs`（渲染层）+ CDP 注入事件（`--remote-debugging-port`）+ 截图自检（`API88_WIDGET_DEMO=1`）。
> 动手前先看 §4 的坑，尤其是 #8（app-region 吞事件）和 #15（CDP 坐标不可用于验证拖动位移）。
> 改完请保持：卡片/胶囊仍是自包含单文件、不加外部 CDN、不动 `data/`、不把凭据写进代码、提交前确认无隐私文件。
