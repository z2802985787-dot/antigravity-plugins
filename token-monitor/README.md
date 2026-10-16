# Token 与上下文监控 (token-monitor)

一个为 Google Antigravity 深度定制的 Token 生成速度、前缀缓存命中率、上下文容量与全局消耗监控插件。

---

## ✨ 核心特性

### 1. 底部聊天输入框实时遥测条（DSH 风格内嵌）
- **Token 速度 (`tok/s`)**：实时统计最新一轮模型输出速率、首字延迟（TTFT）与流式耗时。
- **前缀缓存命中率**：基于 `cacheReadTokens / (inputTokens + cacheReadTokens)` 实时计算。
- **上下文已用胶囊与环形图**：准确对应模型的真实上下文上限（如 256K / 1M）。
- **悬停/点击固定详情浮层**：将当前上下文容量精确拆解为**系统提示词**、**工具定义**与**对话消息**三大部分。

### 2. 全局统计与活动热力图（侧边栏 / 独立插件面板）
- **全局累计消耗总览**：总 Tokens、缓存读取、未缓存输入、模型输出（思考 + 回答）及全局平均流速。
- **按项目统计分布**：统计各工程的 Token 消耗与轮次（无项目归属的对话智能合并为「对话」）。
- **按模型速度与调用排行**：支持 Gemini 3.8 Flash、Gemini 3.8 Pro、Claude Sonnet 4.6、Claude Opus 4.6 等主流模型的速度跑分与吞吐对比。
- **GitHub 风格活跃热力图**：
  - 最近 28 天每日 Token 消耗活跃日历。
  - 24 小时各时段分布柱状图。
- **高消耗会话排行榜**：支持快速定位排查超大长上下文会话。

---

## 🚀 安装与启用

把本插件文件夹放置于 Antigravity 的插件目录中：
```bash
~/.gemini/config/plugins/token-monitor/
```

在 Antigravity 的 **Skills & Customizations** (Plugins) 面板中启用 `token-monitor` 即可开箱即用。
