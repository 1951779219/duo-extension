# Duo: Search + Agents

一个二合一 SillyTavern 前端扩展：
- 联网搜索：DuckDuckGo HTML、SearXNG、Serper、Tavily、SerpAPI、Z.AI。
- DuckDuckGo 在 Luker 环境里优先使用 `/api/search/ddg`，旧版 SillyTavern 没有该接口时会回退到 HTML 抓取或 SearXNG。
- 剧情多智能体：多个短 agent 并行分析聊天，再由合成器生成剧情 capsule 并注入下一轮回复。
- 开箱即用：默认启用生成前自动运行；普通聊天会自动跑剧情 agent，出现“搜索 / 联网 / 查一下 / 最新 / 今天 / 新闻”等词时会自动搜索。
- 可见运行状态：自动搜索、agent 运行、合成和注入都会像 Luker 一样弹出状态提示，现在弹窗正文会显示每个阶段和当前细节。
- Agent 组合更完整：支持 Single、Fast、Director、Creative、Research、Quality、Audit、Balanced、Deep 等模式。
- Agent API 可选：可使用当前 SillyTavern 主 API，也可以指定 OpenAI/兼容、TextGen WebUI、Kobold、Kobold Horde、NovelAI；在 Luker 环境里还可以填写 Connection Profile 名称。
- 自动清理旧指导：删除/编辑消息、切换 swipe、删除 swipe、切换聊天或开始新一轮运行时，会清掉上一次 Duo 注入的剧情 capsule。
- 加速思路：默认 Fast 模式只跑 3 个 agent 并行 + 1 次合成，避免多阶段工作流的长串行链路。

## 安装

在 SillyTavern 的扩展安装界面填入仓库地址：
```text
https://github.com/1951779219/duo-extension
```

也可以手动克隆到：
```text
public/scripts/extensions/third-party/duo-extension
```

NAS/Docker 部署时，请持久化扩展目录或用户 data 目录，否则容器重建后扩展会丢失。

## 快速使用

1. 先在 SillyTavern 配置并测试聊天模型 API，确保普通聊天可以生成回复。
2. 安装后刷新页面，在扩展设置中展开 **Duo**，点击“推荐默认”。
3. 打开一段角色聊天并发送消息。默认 Fast 模式会运行 3 个剧情 agent，再合成为下一轮回复使用的剧情 capsule。
4. 需要资料时，可在消息里写“搜索某个主题”或“查一下某个主题”，自动搜索策略保持 `When requested`。
5. 需要手动处理时，在 Duo 面板点击“运行 Agent”；可用“注入”应用当前 capsule，用“清除”移除注入。

手动搜索可以在面板输入查询后点击“搜索”。搜索和多 agent 都可能增加请求数量、耗时及模型服务费用；Fast 模式包含多个 agent 请求和一次合成。

### 更新与排错

- 使用 SillyTavern 的扩展管理更新本扩展；手动克隆安装时，在扩展目录执行 `git pull --ff-only`，然后刷新页面。
- 找不到 Duo 面板：检查扩展是否成功安装，刷新页面，并查看浏览器控制台是否显示 `[Duo] loaded.`。
- 搜索失败：检查搜索源是否可用、服务端代理接口是否存在，以及对应服务的 secret 是否已配置；可换用自己的 SearXNG 实例。
- Agent 失败：先测试当前聊天 API；普通 SillyTavern 的“连接配置”保持为空。
- 响应较慢：切换 Single/Fast，调低并发、Agent 长度和阅读全文数。

## 兼容性

- 建议 SillyTavern 1.16.0+。
- DuckDuckGo HTML 搜索依赖 SillyTavern 的 `/api/search/visit` 后端代理。
- Serper、Tavily、SerpAPI、Z.AI 需要你在 SillyTavern 里配置对应 secret。
- Agent API 选择调用的是 SillyTavern `generateRaw` 支持的后端；如果选“当前主 API”，就跟随你当前聊天使用的 API。
- “连接配置”字段对应 Luker 的 Connection Profile / `apiPresetName`。普通 SillyTavern 没有这个能力时保持为空即可；OpenAI-compatible 自定义接口可以通过 ST 的 OpenAI/兼容 API 设置使用。
- Duo 生成的剧情 capsule 默认不是世界书条目；它写入 SillyTavern 扩展提示词通道，自动运行时优先写入本次生成 payload。面板里的“清除”会立即移除这段注入。

## 推荐设置

- 推荐默认：启用、生成前自动运行、按需搜索、Fast、并发 3、阅读全文数 0、Agent API 为“当前主 API”、连接配置为空。
- `Single`：1 个总编 agent，最快。
- `Fast`：连续性 / 角色 / 剧情 3 个 agent 并行，默认推荐。
- `Director`：意图 / 连续性 / 角色 / 剧情 / 节奏，适合常规剧情推进。
- `Creative`：角色 / 剧情 / 文风 / 节奏，适合提高创作味道。
- `Research`：资料 / 连续性 / 剧情 / 质检，适合联网资料参与剧情。
- `Quality`：意图 / 连续性 / 设定 / 真实感 / 质检，适合稳定性优先。
- `Audit`：连续性 / 设定 / 真实感 / 质检，适合检查跑偏。
- `Balanced`：意图 / 连续性 / 角色 / 剧情 / 资料，比较均衡。
- `Deep`：全量 agent，质量更高但更慢。

如果 NAS 模型响应慢，优先调低：
- Agent 模式：`Fast` 或 `Single`
- 并发数：`2`
- Agent 长度：`320-420`
- 合成长度：`500-720`
- 阅读全文数：`0`

## 许可

MIT
