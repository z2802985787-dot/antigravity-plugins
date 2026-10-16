# Antigravity Plugins (Antigravity 插件合集)

一套专为 Google Antigravity 设计的高效生产力扩展插件。

---

## 📦 插件列表

| 插件名称 | 目录 | 描述 |
| :--- | :--- | :--- |
| **token-monitor** | [`token-monitor/`](token-monitor/) | **Token 与上下文监控**：DSH 风格聊天框内嵌遥测条（输出速度 `tok/s`、前缀缓存命中率、真实上下文占比与浮层拆解），外加全局累计消耗、各项目/模型分布及 28 天活跃热力图。 |
| **custom-persona** | [`custom-persona/`](custom-persona/) | **动态人设与对话风格系统**：支持动态切换与即时开关 AI 助手的交互人设，在保证代码与专业技术绝对严谨的前提下提升日常交互体验。 |

---

## 🛠️ 安装方法

克隆本仓库到 Antigravity 插件配置目录即可全局生效：

```bash
# 目录位置通常为 ~/.gemini/config/plugins/
git clone <repository-url> ~/.gemini/config/plugins
```

或者将需要的插件目录单独复制到 `~/.gemini/config/plugins/` 下。

在 Antigravity 的 **Skills & Customizations** (Plugins) 面板中开启对应插件即可。
