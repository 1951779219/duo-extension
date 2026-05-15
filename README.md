# Duo: Search + Agents

一个二合一 SillyTavern 前端扩展：

- 联网搜索：DuckDuckGo HTML、SearXNG、Serper、Tavily、SerpAPI、Z.AI。
- 剧情多智能体：多个短 agent 并行分析聊天，再由合成器生成剧情 capsule 并注入下一轮回复。
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
- 多智能体调用使用当前 SillyTavern 主 API 配置。

## 速度设置

- `Single`：1 个 agent，最快。
- `Fast`：3 个 agent 并行，默认推荐。
- `Balanced`：4 个 agent 并行。
- `Deep`：5 个 agent，并发上限由“并发数”控制。

如果 NAS 模型响应慢，优先调低：

- Agent 模式：`Fast` 或 `Single`
- 并发数：`2`
- Agent 长度：`320-420`
- 合成长度：`500-720`
- 阅读全文数：`0`

## 许可

MIT
