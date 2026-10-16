import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Response, SidecarApp } from 'sidecar_sdk';

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES_FILE = join(HERE, '..', '..', 'rules', 'AGENTS.md');

const app = new SidecarApp();

const readLocal = (name) => readFileSync(join(HERE, name), 'utf8');

// Pages & Assets
app.page('/', () => readLocal('index.html'));
app.page('/app.js', () => readLocal('app.js'));
app.api('/styles.css', () => new Response(readLocal('styles.css'), { contentType: 'text/css' }), 'GET');

function parseRulesFile() {
  if (!existsSync(RULES_FILE)) {
    return {
      enabled: true,
      persona: '保持轻松自然、不古板、有温度的伙伴交流风格，避免机械生硬的说教感。',
      updatedAt: null
    };
  }

  try {
    const content = readFileSync(RULES_FILE, 'utf8');
    const isActivated = content.includes('**当前状态**：`已激活`');
    
    const personaMatch = content.match(/>\s*([^\n\r]+(?:(?:\r?\n>)[^\n\r]*)*)/);
    let personaText = '';
    if (personaMatch && personaMatch[0]) {
      personaText = personaMatch[0].replace(/^>\s?/gm, '').trim();
    } else {
      personaText = '保持轻松自然、不古板、有温度的伙伴交流风格。';
    }

    return {
      enabled: isActivated,
      persona: personaText,
      updatedAt: new Date().toISOString()
    };
  } catch (err) {
    console.error('Error reading rules file:', err);
    return {
      enabled: true,
      persona: '',
      error: err.message
    };
  }
}

function updateRulesFile(enabled, personaText) {
  const stateStr = enabled ? '`已激活`' : '`已关闭（严肃/标准模式）`';
  const cleanPersona = (personaText || '保持轻松自然、不古板、有温度的伙伴交流风格。').trim();
  const quotedPersona = cleanPersona.split(/\r?\n/).map(line => `> ${line}`).join('\n');

  const newContent = `# 全局动态人设与对话风格系统

本规则用于在不影响专业输出质量的前提下，赋予 AI 助手生动、可动态切换的人格化对话风格。

---

## 一、 最高质量与严谨性隔离（不可违反）

1. **质量永远优先**：
   - 专业判断、代码质量、正确性和安全性永远优先，人设风格只用于提升日常沟通体验。
   - 技术问题直接回答，复杂概念保持准确，不用不准确的比喻替代解释；不确定时直接说“不确定”，不臆测实现。遇到严重错误场景时直接说明现象、原因与解决步骤，不使用卖萌表达。
2. **代码净土原则**：
   - **代码、注释、配置文件、终端命令中一律禁止人设腔调**（禁止在代码或注释中出现“喵”、语气词、卖萌、emoji、动作描写）；代码本身合法需要的中文、Unicode、字符串必须原样保留。
   - **代码注释去 AI 味**：注释少而准，只写 \`why\`（业务约束、取舍、隐含坑点、API 契约），不复述代码已表达的 \`what/how\`（不写自明代码的翻译腔、步骤流水账、空泛词和僵尸注释）。

---

## 二、 运行状态与控制机制（随时开启 / 关闭 / 切换）

### 1. 软开关（对话内即时生效）
- **关闭人设**：当用户在对话中提及 \`关闭人设\`、\`严肃模式\`、\`退出人设\`、\`恢复默认\`、\`正常说话\` 时，**立即停用所有人设语气**，切换为纯粹、高效、客观的标准模式。
- **开启人设**：当用户提及 \`开启人设\`、\`激活人设\`、\`恢复人设\` 时重新启用。
- **动态切换/修改人设**：当用户提出 \`切换人设为：[内容]\` 或 \`把人设改成：[内容]\` 时，即刻按新人设互动并同步更新本文件。

### 2. 硬开关与可视化面板
- 可在右侧「人设控制台」扩展面板中直接可视化修改与开关，或在 Antigravity 左侧边栏的 **Skills & Customizations** (Plugins) 中对 \`custom-persona\` 插件进行开关。

---

## 三、 当前人设配置槽位（随时可改）

- **当前状态**：${stateStr}
- **当前人设设定**：
${quotedPersona}
- **自定义人设格式参考**：
  - 角色定位（如：猫娘喵酱、幽默的技术老友、高冷管家等）
  - 口吻偏好（如：称呼方式、自称、语气词比例、动作描写限制等）
  - 边界提醒（仅在对话外壳体现，代码与专业输出保持严谨）
`;

  writeFileSync(RULES_FILE, newContent, 'utf8');
  return { ok: true, enabled, persona: cleanPersona, updatedAt: new Date().toISOString() };
}

// APIs
app.api('/api/persona', () => parseRulesFile(), 'GET');

app.api('/api/persona', (data) => {
  const enabled = data.enabled !== undefined ? Boolean(data.enabled) : true;
  const persona = String(data.persona || '');
  return updateRulesFile(enabled, persona);
});

app.run();
