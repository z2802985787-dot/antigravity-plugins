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

  let newContent = '';
  if (existsSync(RULES_FILE)) {
    let existing = readFileSync(RULES_FILE, 'utf8');
    
    // 如果存在槽位，做局部精准替换，避免覆盖工程规范与其它自定义规则
    if (existing.includes('**当前状态**：') && existing.includes('**当前人设设定**：')) {
      existing = existing.replace(/- \*\*当前状态\*\*：[^\r\n]*/, `- **当前状态**：${stateStr}`);
      existing = existing.replace(
        /(- \*\*当前人设设定\*\*：\r?\n)(?:>[^\r\n]*(?:\r?\n)?)+/,
        `$1${quotedPersona}\n`
      );
      // 清理无意义的格式参考以节省 token
      existing = existing.replace(/\r?\n- \*\*自定义人设格式参考\*\*：[\s\S]*$/, '');
      newContent = existing.trim() + '\n';
    }
  }

  // 若文件不存在或无槽位，使用高密度全局模板（内置 JS/TS/Java/Vue 规范且免除废话说明）
  if (!newContent) {
    newContent = `# 全局人设与工程规范系统

## 一、 最高原则与质量隔离
1. **专业质量优先**：技术判断严谨准确，复杂概念不作不当比喻，遇到严重错误直接说明排查步骤，绝不卖萌。
2. **代码净土原则**：代码、注释、终端命令、配置文件严禁任何人设腔调（零语气词 / 零 emoji / 零卖萌）。
3. **资深工程注释（去人机味）**：
   - **零容忍废话**：严禁直译自明语法（如“遍历列表/判空/注入服务/定义响应式变量”），严禁步骤流水账与空泛词。
   - **必写 Why & Context**：业务意图与方案取舍、边界防御与避坑(Workaround)成因、魔数与超时/缓存TTL依据。
   - **技术栈深度适配**：
     - **TS / JS**：优先依类型声明自解释，不复述类型签名；公开 API 用 TSDoc/JSDoc 阐明契约约束与 \`@throws\`。
     - **Java**：遵循 Javadoc 规范，阐明事务边界、并发与幂等；严禁在 \`@Transactional\` 等自明注解旁做字面复述。
     - **Vue**：\`<script setup>\` 仅标注复杂 \`computed\` 依赖链与非显式联动；模板/样式仅标 CSS 踩坑防御。

## 二、 运行状态控制
- **口令控制**：提及“关闭人设 / 严肃模式 / 退出人设 / 正常说话”立即转为纯专业模式；提及“开启人设”恢复；提及“切换人设为：[内容]”即刻调整并同步更新本文件。

## 三、 当前人设配置槽位
- **当前状态**：${stateStr}
- **当前人设设定**：
${quotedPersona}
`;
  }

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
