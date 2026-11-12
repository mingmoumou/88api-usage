# 88API 用量实时记录（可行性验证 + 可运行原型）

**结论：完全可行，而且已经跑通。** 88API 的后台是 new-api 内核（`v1.0.0-rc.46-88api.2`），它把每一次请求都写成一条消费日志，
用「只读访问令牌」就能把 **模型 / 输入 token / 输出 token / 缓存 token / 金额 / 耗时 / 用的哪个 Key** 逐条拉下来。
本目录就是一个零依赖的采集器 + 本地实时看板。

## 1. 原理

后台不提供推送（没有 WebSocket / SSE），但提供了查询接口，所以「实时」= **轮询 + 去重落盘**。
一条请求结束后几秒内出现在日志里，轮询间隔设 5–10 秒即可做到近实时。

| 用途 | 接口 | 说明 |
| --- | --- | --- |
| 消费明细（核心） | `GET /api/log/self?p=1&page_size=100&type=2` | 每次请求一条，含 `model_name`、`prompt_tokens`、`completion_tokens`、`quota`、`use_time`、`token_name`、`group`、`is_stream`、`created_at`、`request_id`、`other`（缓存 token、计费模式、倍率） |
| 增量拉取 | `...&start_timestamp=<秒级时间戳>` | 只取该时间之后的记录，用于增量同步 |
| 按模型筛选 | `...&model_name=gpt-6.1-sol` | 可选 |
| 余额 / 累计消费 | `GET /api/user/self` | `quota`（余额）、`used_quota`（累计消费）、`request_count` |
| 计费参数 | `GET /api/status` | `quota_per_unit`（本机 500000：`1 元 = 50 万 quota`）、`quota_display_type`、`usd_exchange_rate` |
| 可用模型 / 价格 | `GET /api/user/models`、`GET /api/pricing` | 模型清单与官方价目 |

鉴权只需请求头 `Authorization: Bearer <访问令牌>`。令牌在 `~/.88api/video-studio.json`（seedance-studio 插件早前配置的
只读令牌，权限是「查看」类），它 **不能** 用于付费生成，也不会产生费用。也可以改用环境变量 `API88_ACCESS_TOKEN`。

费用换算：`金额 = quota / 500000`（与站点钱包页一致）。

## 2. 用法

```bash
# 一次性增量同步 + 打印报表 + 生成 dashboard.html
node run.mjs sync

# 常驻轮询（默认 10 秒），写日志并刷新 dashboard.html
node run.mjs watch 10

# 本地实时看板（推荐）：浏览器打开 http://127.0.0.1:8788
node run.mjs serve 8788
```

Windows 上用 DSH 自带的 node：

```powershell
& "C:\Users\23572\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" run.mjs serve 8788
```

产出：

- `data/logs.jsonl` —— 全量明细，一行一条，按请求去重（站点日志只留 365 天，本地这份长期保存）
- `data/state.json` —— 最近一次同步的账户、计费参数、时间水位
- `data/snapshot.json` —— 聚合快照（按模型 / Key / 天）
- `dashboard.html` —— 自包含看板，`sync`/`watch` 会自动重写，可直接双击打开

## 3. 已经验证到的坑

1. **分页 `p` 从 1 开始**：`p=0` 和 `p=1` 返回同一页（offset 都是 0），从 0 开始翻页会重复抓第一页。
2. `total` 与翻页结果可能不一致（`type=2` 时报 459，实际翻到位也是 459，但 `p=0` 时 total 是按全部类型算的）。
   采集器按 id 去重即可，不依赖 total 收敛。
3. **日志累计 ≠ 钱包累计**：本机 459 条日志合计 ¥26.26，而 `used_quota` 是 ¥25.14。
   差在失败请求的退款——日志仍留在明细里，钱包已扣回。看板同时展示两个数，不强行对齐。
4. 日志是**请求结束后**才写入的，进行中的请求看不到；流式请求按结束时刻落一条。
5. 站点日志保留 `log_max_range_days = 365` 天，超期会清，所以本地落盘是必要的。
6. 图片 / 视频任务（`seedance-*`）也走同一张日志表，`billing_unit` 是 `image`/`request` 之类，`prompt_tokens` 为 0，金额看 `quota`。
7. **自制 ICO 别用 PNG 帧**：Pillow 默认把每一帧都写成 PNG，Windows 只认 256×256 的 PNG 帧，其余尺寸必须是 DIB/BMP，否则资源管理器显示成空白文件图标（`make-ico.py` 已按此实现）。
8. 桌面快捷方式的 `.ico` 不能放在本工作区里，Explorer 读不到（沙箱 ACL），会显示空白图标——复制到 `%LOCALAPPDATA%` 再引用。

## 4. 桌面挂件（Electron，无须安装依赖）

双击桌面 **「88API 用量」** 图标，或双击 **`打开挂件.bat`** → 桌面右上角出现一张常驻卡片（384×280，无边框、半透明、置顶、不进任务栏）。
挂件自己轮询、落盘、聚合，**不需要再跑 `run.mjs serve`**；每轮顺便重写 `dashboard.html`。

卡片显示：余额、累计消费、近 24 小时（当天没量时自动切成近 7 天）迷你曲线、今日消费/请求/token、
按模型前 3、最新一条请求与更新时间；同步失败时右上角变红点、底部显示「同步失败」。

交互：拖动移动、拖边角改大小（位置尺寸存 `widget/window.json`）；`◉` 置顶开关、`↻` 立即刷新、
`⤢` 打开完整看板、`✕` 退出；右键菜单可改刷新间隔（5/10/15/30/60 秒）、打开数据目录；托盘图标同样能显示隐藏/刷新/退出。

| 文件 | 作用 |
| --- | --- |
| `widget/main.js` | 主进程：轮询接口、去重落盘、聚合、通过 IPC 推给卡片 |
| `widget/preload.js` | 只暴露 `onData` / `onPinned` / `act` 三个通道 |
| `widget/index.html` | 卡片界面（自包含 CSS/JS，含 sparkline） |
| `widget/package.json` | 让 electron 把该目录当应用入口 |
| `打开挂件.bat` | 正常启动（无控制台窗口） |
| `创建桌面快捷方式.bat` | 在桌面建「88API 用量」图标（`create-shortcut.ps1` 干活，可重复运行） |
| `诊断启动.bat` | 在控制台里启动，退出后打印退出码和 `widget/debug.log` 尾部 |
| `安装开机自启.bat` / `移除开机自启.bat` | 在「启动」文件夹建/删快捷方式 |
| `widget/88api.ico` / `make-ico.py` | 桌面图标本体（16–256 七种尺寸）与它的生成脚本 |

桌面快捷方式指向 `electron.exe` + `widget` 目录；挂件已在运行时双击它只会把已有窗口提到前面（单实例锁），不会开第二份。
图标不直接引用工作区里的 `.ico`：`create-shortcut.ps1` 会把它复制到 `%LOCALAPPDATA%\88api-widget\icon.ico` 再让快捷方式指过去——桌面/资源管理器读不到工作区路径下的图标文件（沙箱 ACL），直接引用会在桌面上显示成空白文件图标。

用的是 DSH 自带的 `C:\Users\23572\.dsh\electron\electron.exe`，不需要 `npm install`。

注意：
- 挂件和 `run.mjs serve` **不要同时跑**，两者都会写 `data/logs.jsonl`。
- 挂件启动会写 `widget/debug.log`（boot / ready / before-quit 与异常堆栈），出问题先看它。

## 5. 可以继续做

- 加阈值告警（今日消费 > N 元 / 余额 < N 元时托盘气泡提示）
- 按「项目」维度记账：给不同用途建不同 API Key，报表里天然按 `token_name` 分组
- 把 `data/snapshot.json` 接进 Grafana / 飞书机器人日报
