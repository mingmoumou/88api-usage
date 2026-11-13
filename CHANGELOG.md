# CHANGELOG

## v1.0.0 — 2026-11-13（版本基线）

首个稳定版本，作为后续升级与回滚的基准。

### 功能

- **桌面灵动岛挂件**：Electron 无边框透明窗口，置顶、不进任务栏；卡片 / 灵动岛双形态。
- **灵动岛形态**：拖到屏幕顶部中间自动吸附成胶囊；悬停展开完整信息、移出收回；双击胶囊恢复卡片。
- **多站点**：88API（new-api 内核）+ APIMart（OpenAI 兼容网关），各自独立拉取与聚合。
- **卡片视图**：余额、累计消费、近 24 小时 / 近 7 天曲线、今日消费 / 请求 / token、模型调用轮播（今日 / 总计，5 秒切换）。
- **站点选择**：卡片底部圆点选择器（金色=当前站点），仅显示已配置凭据的站点；单站点时自动隐藏圆点、不轮播。
- **灵动岛轮播**：多站点每 5 秒切换，显示站点名 + 余额 + token；轮播独立于数据刷新，不被 15 秒同步打断。
- **配置面板**：首次缺凭据自动弹出「配置站点凭据」，含 88API 访问令牌 + APIMart API Key 两个输入框（带显示/隐藏、获取链接）；右键菜单可随时重新打开。
- **失败提示**：APIMart 拉取失败时灵动岛显示「APIMart · 离线」，并在错误信息中提示需要代理/VPN。
- **数据落盘**：88API 逐条消费日志存 `data/logs.jsonl`（request_id 去重）；APIMart 用 `/v1/usage` 聚合。
- **命令行**：`node run.mjs sync | watch [秒] | serve [端口]`。

### 配置

- `auth.json`（gitignore 忽略，不提交）：
  ```json
  { "accessToken": "88API 只读令牌", "userId": "", "apimart": { "apiKey": "sk-..." } }
  ```
- 令牌读取优先级：环境变量 `API88_ACCESS_TOKEN` > 项目根 `auth.json` > `~/.88api/video-studio.json`。
- Electron 查找：`API88_ELECTRON` > `widget/node_modules/electron/dist` > 默认路径。

### 已知限制

- **APIMart 需要代理/VPN**：服务器在境外（`api.apimart.ai` → `104.244.43.231`），境内直连被阻断（实测 HTTP 000）。
- **APIMart 无逐条明细**：只有按模型 / 按天的聚合，`/v1/usage` 缓存 60 秒，今日数据最多 1 分钟延迟。
- **计价单位不同**：88API 显示 `¥`（quota / 500000），APIMart 显示 `C`（credits，1 credit = 0.1 USD）。
- APIMart 的「总计」为近 31 天（接口单次查询上限 31 天）。

### 升级与回滚

- 升级：`git pull`，保留本地 `auth.json` 与 `data/`（均被 gitignore，不会被覆盖）。
- 回滚到本版本：`git checkout v1.0.0`
- 本版本 commit 以 `git tag v1.0.0` 标注。

### 下一步候选（v1.1+）

- **桌面宠物（奶龙）**：活动范围与实现规格见 `PET-DESIGN.md`——卡片模式窗口 384×440（卡片下方 100px 活动区）、灵动岛模式 300×150（胶囊下方 98px 活动区）。素材有版权限制，需授权或用免费替代。
- 站点接入第三个平台时，把 `apimart.mjs` 抽成通用数据源适配层。
- 灵动岛轮播间隔可配置（当前固定 5 秒）。
- APIMart 代理支持：在 `auth.json` 增加 `proxy` 字段，用 undici ProxyAgent 显式走代理。
