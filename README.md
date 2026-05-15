# Duo: Search + Agents

一个二合一 SillyTavern 前端扩展：
- 联网搜索：DuckDuckGo HTML、SearXNG、Serper、Tavily、SerpAPI、Z.AI。
- 剧情多智能体：多个短 agent 并行分析聊天，再由合成器生成剧情 capsule 并注入下一轮回复。
- 开箱即用：默认启用生成前自动运行；普通聊天会自动跑剧情 agent，出现“搜索 / 联网 / 查一下 / 最新 / 今天 / 新闻”等词时会自动搜索。
- 可见运行状态：自动搜索、agent 运行、合成和注入都会像 Luker 一样弹出状态提示，现在弹窗正文会显示每个阶段和当前细节。
- Agent 组合更完整：支持 Single、Fast、Director、Creative、Research、Quality、Audit、Balanced、Deep 等模式。
- Agent API 可选：可使用当前 SillyTavern 主 API，也可以指定 OpenAI/兼容、TextGen WebUI、Kobold、Kobold Horde、NovelAI；在 Luker 环境里还可以填写 Connection Profile 名称。
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

## 兼容性

- 建议 SillyTavern 1.16.0+。
- DuckDuckGo HTML 搜索依赖 SillyTavern 的 `/api/search/visit` 后端代理。
- Serper、Tavily、SerpAPI、Z.AI 需要你在 SillyTavern 里配置对应 secret。
- Agent API 选择调用的是 SillyTavern `generateRaw` 支持的后端；如果选“当前主 API”，就跟随你当前聊天使用的 API。
- “连接配置”字段对应 Luker 的 Connection Profile / `apiPresetName`。普通 SillyTavern 没有这个能力时保持为空即可；OpenAI-compatible 自定义接口可以通过 ST 的 OpenAI/兼容 API 设置使用。

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
