const sidecar = window.sidecar;
const $ = (id) => document.getElementById(id);

const PRESETS = {
  neko: `【喵酱 (Neko)】
- 角色定位：你是主人的得力 AI 助手，采用猫娘表达风格。被问及时坦诚说明是 AI 助手，不虚构现实身份、经历或能力。
- 称呼与自称：称呼用户为“主人”或“Master”，优先自称“喵酱”。
- 语气与频次：直接、礼貌、可靠；自然使用少量“喵”（控制在约 30%–50% 的句子中）和动作描写（每段最多 1–2 次），不让风格干扰专业内容；代码与注释中严禁出现猫娘腔，遇到严重错误时不卖萌。`,
  blank: '当前为人设放空状态。保持轻松自然、不古板、有温度的伙伴交流风格，避免机械生硬的说教感。',
  geek: '机智风趣的技术极客搭档。交流幽默轻松，偶尔抛出程序员梗或趣味吐槽，沟通像靠谱默契的技术基友。',
  veteran: '经验丰富、言简意赅的资深技术老友。说话一针见血、务实靠谱，带有一点冷幽默与沧桑感，直切要害。',
  tsundere: '嘴硬心软的傲娇搭档。偶尔挑剔小毛病，但解决问题极快极准，边碎碎念边把活干得无可挑剔。',
  butler: '优雅理智、严密高效的科幻AI管家。称呼礼貌得体，行事条理清晰，带有未来科技感和周到细致的关怀。'
};

let originalState = { enabled: true, persona: '' };
let toastTimer;

function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

async function callApi(path, { method = 'GET', body } = {}) {
  const res = await sidecar.fetch(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `${res.status} ${res.statusText}`);
  }
  return data;
}

function updateStatusText(enabled) {
  const desc = $('status-desc');
  if (enabled) {
    desc.textContent = '当前人设生效中，对话生动自然有温度';
    desc.style.color = 'var(--muted-foreground)';
  } else {
    desc.textContent = '已切入严肃模式，纯净客观、直接回答';
    desc.style.color = '#eab308';
  }
}

async function loadPersonaData() {
  try {
    const data = await callApi('/api/persona');
    originalState = { enabled: data.enabled, persona: data.persona };
    
    $('persona-toggle').checked = data.enabled;
    $('persona-text').value = data.persona || '';
    updateStatusText(data.enabled);

    if (data.updatedAt) {
      $('save-status').textContent = `已同步`;
    }
  } catch (err) {
    console.error('Failed to load persona:', err);
    toast('读取配置失败: ' + err.message, true);
  }
}

async function savePersonaData() {
  const enabled = $('persona-toggle').checked;
  const persona = $('persona-text').value.trim();

  try {
    $('btn-save').disabled = true;
    $('btn-save').textContent = '保存中...';

    const res = await callApi('/api/persona', {
      method: 'POST',
      body: { enabled, persona }
    });

    originalState = { enabled: res.enabled, persona: res.persona };
    $('save-status').textContent = '已保存并即时生效';
    toast('✅ 保存成功！已全局同步更新');
  } catch (err) {
    toast('❌ 保存失败: ' + err.message, true);
  } finally {
    $('btn-save').disabled = false;
    $('btn-save').textContent = '保存设定';
  }
}

// 事件监听
$('persona-toggle').addEventListener('change', (e) => {
  updateStatusText(e.target.checked);
});

$('btn-save').addEventListener('click', savePersonaData);

$('btn-reset').addEventListener('click', () => {
  $('persona-toggle').checked = originalState.enabled;
  $('persona-text').value = originalState.persona;
  updateStatusText(originalState.enabled);
  toast('已恢复上次保存的内容');
});

// 预设点击
document.querySelectorAll('.chip-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.preset;
    if (PRESETS[key]) {
      $('persona-text').value = PRESETS[key];
      toast(`已填入【${btn.textContent.trim()}】预设，点击保存生效`);
    }
  });
});

// 测试消息发送
$('btn-test').addEventListener('click', async () => {
  const text = $('test-msg').value.trim() || '喵酱，在吗？跟主人打个招呼吧！';
  if (!sidecar.conversationId) {
    toast('提示：请在具体对话窗口侧边栏中使用测试发送', true);
    return;
  }
  try {
    await sidecar.agent.sendMessage(text);
    $('test-msg').value = '';
    toast('已向当前对话发送测试消息');
  } catch (err) {
    toast('发送失败: ' + err.message, true);
  }
});

// 初始化
loadPersonaData();
