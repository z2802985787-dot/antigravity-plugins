const sidecar = window.sidecar;
const $ = (id) => document.getElementById(id);

let activeTab = 'global';
let selectedConvId = 'auto';
let globalMetricScope = 'gross'; // 'gross' (default) | 'net'
let lastMetrics = null;
let lastGlobalMetrics = null;
const expandedProjects = new Set();

function formatCompactTokens(num) {
  const n = Number(num || 0);
  if (n <= 0) return '0';
  if (n >= 1000000) {
    const m = n / 1000000;
    return `${m >= 100 ? m.toFixed(1) : m.toFixed(2)}M`;
  }
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 100 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  return String(Math.round(n));
}

function formatCapLabel(cap) {
  return cap >= 1000000 ? `${(cap / 1000000).toFixed(0)}M` : `${Math.round(cap / 1000)}K`;
}

function formatDurationHuman(totalSec) {
  const sec = Math.max(0, Math.round(Number(totalSec || 0)));
  if (sec < 60) return `${sec}s`;
  const mins = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (mins < 60) return `${mins}m ${remSec}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function callApi(path) {
  const fetchFn = sidecar && sidecar.fetch ? sidecar.fetch : window.fetch.bind(window);
  const res = await fetchFn(path, { method: 'GET' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `${res.status}`);
  }
  return data;
}

function switchTab(tabName) {
  activeTab = tabName;
  document.querySelectorAll('#view-tabs .view-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  $('tab-panel-session').hidden = tabName !== 'session';
  $('tab-panel-global').hidden = tabName !== 'global';

  if (tabName === 'global') {
    refreshGlobalMetrics();
  } else {
    refreshMetrics();
  }
}

function inspectConversation(convId) {
  selectedConvId = convId;
  const select = $('conv-select');
  if ([...select.options].some((o) => o.value === convId)) {
    select.value = convId;
  }
  switchTab('session');
}

async function loadConversationList() {
  try {
    const data = await callApi('/api/conversations');
    const list = Array.isArray(data.conversations) ? data.conversations : [];
    const select = $('conv-select');
    const prevValue = selectedConvId || select.value;

    const optionsHtml = [`<option value="auto">自动跟随活跃会话</option>`];

    if (sidecar?.conversationId) {
      const hostConv = list.find((c) => c.id === sidecar.conversationId);
      const hostTitle = hostConv ? hostConv.title : `当前面板会话 (${sidecar.conversationId.slice(0, 6)})`;
      optionsHtml.push(
        `<option value="${sidecar.conversationId}">[当前绑定] ${escapeHtml(hostTitle)}</option>`
      );
    }

    for (const c of list) {
      if (sidecar?.conversationId && c.id === sidecar.conversationId) continue;
      optionsHtml.push(`<option value="${c.id}">${escapeHtml(c.title)}</option>`);
    }

    select.innerHTML = optionsHtml.join('');
    if ([...select.options].some((o) => o.value === prevValue)) {
      select.value = prevValue;
    }
  } catch (err) {
    console.error('Failed to load conversations:', err);
  }
}

function renderMetrics(m) {
  if (!m || !m.context) return;
  lastMetrics = m;

  const used = Number(m.context.usedTokens || 0);
  const cap = Number(m.context.maxTokensPlanner || 256000);
  const rawPct = cap > 0 ? (used / cap) * 100 : 0;
  const displayPct = rawPct > 0 && rawPct < 1 ? rawPct.toFixed(1) : Math.round(rawPct);

  $('live-dot').classList.toggle('running', Boolean(m.isRunning));
  $('model-badge').textContent = m.modelName || 'Gemini';

  $('ctx-pct-title').textContent = `${displayPct}%`;
  $('ctx-fraction').textContent = `~${formatCompactTokens(used)} / ${formatCapLabel(cap)}`;

  const b = m.context.breakdown || {};
  const sysTok = Number(b.systemPromptTokens || 0);
  const toolTok = Number(b.toolDefTokens || 0);
  const chatTok = Number(b.conversationTokens || 0);

  $('val-system').textContent = `~${formatCompactTokens(sysTok)}`;
  $('val-tools').textContent = `~${formatCompactTokens(toolTok)}`;
  $('val-chat').textContent = `~${formatCompactTokens(chatTok)}`;
  $('val-chat-pure').textContent = `~${formatCompactTokens(b.chatMessageTokens || 0)}`;
  $('val-chat-tool').textContent = `~${formatCompactTokens(b.toolMessageTokens || 0)}`;

  const visualTotalPct = used > 0 ? Math.min(100, Math.max(rawPct, 3.5)) : 0;
  const sumParts = Math.max(1, sysTok + toolTok + chatTok);
  $('seg-system').style.width = `${((sysTok / sumParts) * visualTotalPct).toFixed(2)}%`;
  $('seg-tools').style.width = `${((toolTok / sumParts) * visualTotalPct).toFixed(2)}%`;
  $('seg-chat').style.width = `${((chatTok / sumParts) * visualTotalPct).toFixed(2)}%`;

  const cur = m.current || {};
  $('bar-speed').textContent = cur.tokPerSec > 0 ? `${Math.round(cur.tokPerSec)} tok/s` : '-- tok/s';
  $('bar-cache').textContent = `${Math.round(cur.cacheHitRate || 0)}%`;
  $('bar-ctx-pct').textContent = `${displayPct}%`;

  const circumference = 43.98;
  const ringPct = Math.min(100, Math.max(0, rawPct));
  $('bar-ring-fg').style.strokeDashoffset = (circumference - (ringPct / 100) * circumference).toFixed(2);

  $('turn-indicator').textContent = `共 ${m.totalTurns || 0} 轮 · ${m.totalSteps || 0} 步`;
  $('detail-speed').textContent = cur.tokPerSec > 0 ? `${cur.tokPerSec} tok/s` : '-- tok/s';
  $('detail-avg-speed').textContent = `会话均值 ${cur.avgTokPerSec > 0 ? cur.avgTokPerSec : '--'} tok/s`;
  $('detail-stream-speed').textContent = cur.streamTokPerSec > 0 ? `${cur.streamTokPerSec} tok/s` : '-- tok/s';
  $('detail-stream-sec').textContent = `流式耗时 ${cur.streamSec || 0}s`;
  $('detail-ttft').textContent = `${cur.ttftSec || 0}s`;
  $('detail-total-sec').textContent = `本轮总耗时 ${cur.totalSec || 0}s`;
  $('detail-out-tok').textContent = formatCompactTokens(cur.outputTokens || 0);
  $('detail-out-split').textContent = `思考 ${formatCompactTokens(cur.thinkingTokens)} · 回复 ${formatCompactTokens(cur.responseTokens)}`;

  $('session-cache-badge').textContent = `全会话累计均值 ${cur.sessionCacheHitRate || 0}%`;
  $('detail-cache-tok').textContent = formatCompactTokens(cur.cacheReadTokens || 0);
  $('detail-new-in-tok').textContent = `新增输入 ${formatCompactTokens(cur.inputTokens || 0)} (本轮命中 ${cur.cacheHitRate || 0}%)`;

  const totals = m.sessionTotals || {};
  $('total-in-tok').textContent = formatCompactTokens(totals.totalInputTokens || 0);
  $('total-cache-tok').textContent = `累计缓存 ${formatCompactTokens(totals.cacheReadTokens || 0)} · 累计输出 ${formatCompactTokens(totals.outputTokens || 0)}`;

  $('update-time').textContent = m.isRunning ? '生成中 · 实时刷新' : `更新于 ${new Date().toLocaleTimeString()}`;
  const turns = Array.isArray(m.turns) ? m.turns : [];
  const listEl = $('turns-list');
  if (turns.length === 0) {
    listEl.innerHTML = `<div class="empty-state muted">暂无模型生成记录</div>`;
  } else {
    listEl.innerHTML = turns
      .map((t) => {
        const sp = t.tokPerSec > 0 ? `${Math.round(t.tokPerSec)} tok/s` : '--';
        return `<div class="turn-item">
          <div class="turn-left">
            <span class="turn-badge">#${t.turnNumber}</span>
            <span class="turn-speed">${sp}</span>
          </div>
          <div class="turn-right">
            <span>缓存 ${Math.round(t.cacheHitRate)}%</span>
            <span>入 ${formatCompactTokens(t.totalInputTokens)} / 出 ${formatCompactTokens(t.outputTokens)}</span>
            <span>${t.totalSec}s</span>
          </div>
        </div>`;
      })
      .join('');
  }
}

function renderGlobalMetrics(g) {
  if (!g || !g.totals) return;
  lastGlobalMetrics = g;
  const t = g.totals;
  const isNet = globalMetricScope === 'net';

  // 1. Hero Totals
  const heroTok = isNet ? (t.netTokens || t.uncachedInputTokens + t.outputTokens) : (t.grossTokens || t.totalTokens);
  $('g-hero-label').textContent = isNet ? '全站实际净新增输入/输出 Token' : '全站多轮上下文累计总 Token';
  $('g-total-tokens').textContent = formatCompactTokens(heroTok);
  $('g-hero-sub').textContent = isNet
    ? `不含多轮次历史缓存读取 · 全量多轮总消耗 ~${formatCompactTokens(t.grossTokens)}`
    : `其中实际新增输入输出 ~${formatCompactTokens(t.netTokens)} · 跨轮次前缀缓存读取 ${formatCompactTokens(t.cacheReadTokens)}`;
  $('g-scope-hint').textContent = isNet
    ? '仅新增净消耗 = 仅统计未命中缓存的新增提示词与生成输出，不含轮次间反复读取的前缀缓存'
    : '全量多轮上下文 = 完整计入多轮对话每次调用的全部上下文与缓存流转，真实反映实际计算负荷';

  $('g-cache-rate').textContent = `全局缓存命中 ${t.cacheHitRate}%`;
  $('g-avg-speed').textContent = `全站均速 ${t.avgTokPerSec} tok/s`;

  const tot = Math.max(1, t.grossTokens || t.totalTokens);
  const cacheW = (t.cacheReadTokens / tot) * 100;
  const uncachedW = (t.uncachedInputTokens / tot) * 100;
  const outW = Math.max(t.outputTokens > 0 ? 1.5 : 0, (t.outputTokens / tot) * 100);

  $('g-seg-cache').style.width = `${cacheW.toFixed(2)}%`;
  $('g-seg-uncached').style.width = `${uncachedW.toFixed(2)}%`;
  $('g-seg-output').style.width = `${outW.toFixed(2)}%`;

  $('g-leg-cache').textContent = formatCompactTokens(t.cacheReadTokens);
  $('g-leg-uncached').textContent = formatCompactTokens(t.uncachedInputTokens);
  $('g-leg-output').textContent = formatCompactTokens(t.outputTokens);

  $('g-box-input').textContent = formatCompactTokens(t.totalInputTokens);
  $('g-box-input-sub').textContent = `缓存 ${formatCompactTokens(t.cacheReadTokens)} · 新增 ${formatCompactTokens(t.uncachedInputTokens)}`;

  $('g-box-output').textContent = formatCompactTokens(t.outputTokens);
  $('g-box-output-sub').textContent = `思考 ${formatCompactTokens(t.thinkingTokens)} · 回复 ${formatCompactTokens(t.responseTokens)}`;

  const subSuffix = t.subagentsCount > 0 ? ` (+${t.subagentsCount} 子Agent)` : '';
  $('g-box-convs').textContent = `${t.conversationsCount} 会话${subSuffix}`;
  $('g-box-turns').textContent = `累计 ${t.totalTurns} 轮模型调用`;

  $('g-box-duration').textContent = formatDurationHuman(t.totalGenerationSec);
  $('g-box-ttft').textContent = `平均首字延迟 ${t.avgTtftSec}s`;

  // 2. Activity Heatmaps (28-day calendar + 24-hour distribution)
  const hm = g.heatmap || {};
  const daily = hm.daily || {};
  const hourly = hm.hourly || {};

  $('g-heatmap-summary').textContent = `活跃 ${daily.activeDaysCount || 0} 天 · 共 ${t.totalTurns} 轮`;

  const dailyCells = Array.isArray(daily.cells) ? daily.cells : [];
  const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
  $('g-daily-heatmap').innerHTML = dailyCells
    .map((c) => {
      const cellTok = isNet ? (c.netTokens ?? c.totalTokens) : (c.grossTokens ?? c.totalTokens);
      const tokStr = cellTok > 0 ? formatCompactTokens(cellTok) : '-';
      const titleTip = `${c.date} (周${weekdayNames[c.weekday]})\n实际净消耗: ${formatCompactTokens(c.netTokens)} (输出 ${formatCompactTokens(c.outputTokens)})\n全量吞吐: ${formatCompactTokens(c.grossTokens)}\n调用轮次: ${c.turnsCount} 轮`;
      return `<div class="daily-cell lvl-${c.level} ${c.isToday ? 'today' : ''}" data-date="${c.date}" data-net="${c.netTokens}" data-gross="${c.grossTokens}" data-turns="${c.turnsCount}" title="${escapeHtml(titleTip)}">
        <span class="daily-cell-date">${escapeHtml(c.label)}</span>
        <span class="daily-cell-tok">${tokStr}</span>
      </div>`;
    })
    .join('');

  if (daily.today) {
    const todayTok = isNet ? (daily.today.netTokens ?? daily.today.totalTokens) : (daily.today.grossTokens ?? daily.today.totalTokens);
    $('g-today-tok').textContent = `${formatCompactTokens(todayTok)} (${daily.today.turnsCount} 轮)`;
  }
  if (daily.peakDay) {
    const peakTok = isNet ? (daily.peakDay.netTokens ?? daily.peakDay.totalTokens) : (daily.peakDay.grossTokens ?? daily.peakDay.totalTokens);
    $('g-peak-day').textContent = `${daily.peakDay.date} · ${formatCompactTokens(peakTok)} (${daily.peakDay.turnsCount} 轮)`;
  }

  document.querySelectorAll('#g-daily-heatmap .daily-cell').forEach((cell) => {
    cell.addEventListener('click', () => {
      const dt = cell.dataset.date;
      const netVal = Number(cell.dataset.net || 0);
      const grossVal = Number(cell.dataset.gross || 0);
      const tr = Number(cell.dataset.turns || 0);
      const selVal = isNet ? netVal : grossVal;
      $('g-today-tok').textContent = `${dt}：${formatCompactTokens(selVal)} (${tr} 轮)`;
    });
  });

  if (hourly.peakHour) {
    const peakHTok = isNet ? (hourly.peakHour.netTokens ?? hourly.peakHour.totalTokens) : (hourly.peakHour.grossTokens ?? hourly.peakHour.totalTokens);
    $('g-peak-hour').textContent = `高峰 ${hourly.peakHour.label} (${formatCompactTokens(peakHTok)})`;
  } else {
    $('g-peak-hour').textContent = '高峰时段 --';
  }

  const hourlyCells = Array.isArray(hourly.cells) ? hourly.cells : [];
  $('g-hourly-heatmap').innerHTML = hourlyCells
    .map((h) => {
      const hTok = isNet ? (h.netTokens ?? h.totalTokens) : (h.grossTokens ?? h.totalTokens);
      const barH = hTok > 0 ? Math.max(14, h.pctOfPeak) : 6;
      const showLbl = h.hour % 3 === 0 ? String(h.hour).padStart(2, '0') : '';
      const tip = `${h.label} - ${String(h.hour).padStart(2, '0')}:59\n实际净消耗: ${formatCompactTokens(h.netTokens)}\n全量吞吐: ${formatCompactTokens(h.grossTokens)}\n调用轮次: ${h.turnsCount} 轮`;
      return `<div class="hour-col" title="${escapeHtml(tip)}">
        <div class="hour-bar-wrap">
          <div class="hour-bar lvl-${h.level}" style="height: ${barH}%"></div>
        </div>
        <span class="hour-lbl">${showLbl}</span>
      </div>`;
    })
    .join('');

  // 3. Projects Breakdown
  const projects = Array.isArray(g.projects) ? g.projects : [];
  $('g-projects-badge').textContent = `共 ${projects.length} 个分组 (无项目合并为「对话」)`;
  const projContainer = $('g-projects-list');
  if (projects.length === 0) {
    projContainer.innerHTML = `<div class="empty-state muted">暂无项目数据</div>`;
  } else {
    projContainer.innerHTML = projects
      .map((p) => {
        const isExpanded = expandedProjects.has(p.key);
        const badgeCls = p.isOutside ? 'badge-outside' : 'badge-project';
        const badgeText = p.isOutside ? '对话合并' : '项目工作区';
        const barCls = p.isOutside ? 'fill-purple' : '';
        const sessDesc =
          p.subagentsCount > 0
            ? `${p.conversationsCount} 会话 + ${p.subagentsCount} 子Agent`
            : `${p.conversationsCount} 个会话`;

        const pTok = isNet ? (p.netTokens ?? p.totalTokens) : (p.grossTokens ?? p.totalTokens);
        const pShare = isNet ? (p.netSharePct ?? p.sharePct) : p.sharePct;
        const pSecondary = isNet ? `吞吐 ${formatCompactTokens(p.grossTokens)}` : `净 ${formatCompactTokens(p.netTokens)}`;

        const convRowsHtml = isExpanded
          ? `<div class="project-convs-drawer">
              ${p.conversations
                .map(
                  (c) => {
                    const cTok = isNet ? (c.netTokens ?? c.totalTokens) : (c.grossTokens ?? c.totalTokens);
                    const cSec = isNet ? `吞吐 ${formatCompactTokens(c.grossTokens)}` : `净 ${formatCompactTokens(c.netTokens)}`;
                    return `<div class="proj-conv-row" data-conv-id="${escapeHtml(c.id)}" title="点击切换到该会话实时详情">
                      <span class="proj-conv-title">${escapeHtml(c.title)}</span>
                      <span class="proj-conv-meta">${c.turnsCount} 轮 · <b>${formatCompactTokens(cTok)}</b> <span class="muted small">(${cSec})</span></span>
                    </div>`;
                  }
                )
                .join('')}
            </div>`
          : '';

        return `<div class="group-item clickable" data-proj-key="${escapeHtml(p.key)}">
          <div class="group-top">
            <div class="group-title-wrap">
              <span class="group-badge-type ${badgeCls}">${badgeText}</span>
              <span class="group-name">${escapeHtml(p.name)}</span>
            </div>
            <div class="group-right">
              <span class="group-tok">${formatCompactTokens(pTok)}</span>
              <span class="group-pct">${pShare}%</span>
            </div>
          </div>
          <div class="group-subtitle">${escapeHtml(p.subtitle)} · 点击${isExpanded ? '收起' : '展开'}会话明细</div>
          <div class="group-bar-track">
            <div class="group-bar-fill ${barCls}" style="width: ${Math.max(2, pShare)}%"></div>
          </div>
          <div class="group-meta-row">
            <span>${sessDesc} · ${p.turnsCount} 轮</span>
            <span>缓存命中 ${p.cacheHitRate}% · 均速 ${p.avgTokPerSec} tok/s</span>
            <span>(${pSecondary}) · 输出 ${formatCompactTokens(p.outputTokens)}</span>
          </div>
          ${convRowsHtml}
        </div>`;
      })
      .join('');

    projContainer.querySelectorAll('.group-item[data-proj-key]').forEach((item) => {
      item.addEventListener('click', (e) => {
        const convRow = e.target.closest('.proj-conv-row');
        if (convRow && convRow.dataset.convId) {
          e.stopPropagation();
          inspectConversation(convRow.dataset.convId);
          return;
        }
        const key = item.dataset.projKey;
        if (expandedProjects.has(key)) {
          expandedProjects.delete(key);
        } else {
          expandedProjects.add(key);
        }
        renderGlobalMetrics(lastGlobalMetrics);
      });
    });
  }

  // 4. Models Breakdown
  const models = Array.isArray(g.models) ? g.models : [];
  $('g-models-badge').textContent = `共 ${models.length} 款模型`;
  const modContainer = $('g-models-list');
  if (models.length === 0) {
    modContainer.innerHTML = `<div class="empty-state muted">暂无模型数据</div>`;
  } else {
    modContainer.innerHTML = models
      .map((m) => {
        const isAnthropic = m.provider === 'Anthropic';
        const badgeCls = isAnthropic ? 'badge-anthropic' : 'badge-google';
        const barCls = isAnthropic ? 'fill-amber' : '';
        const mTok = isNet ? (m.netTokens ?? m.totalTokens) : (m.grossTokens ?? m.totalTokens);
        const mShare = isNet ? (m.netSharePct ?? m.sharePct) : m.sharePct;
        const mSecondary = isNet ? `吞吐 ${formatCompactTokens(m.grossTokens)}` : `净 ${formatCompactTokens(m.netTokens)}`;

        return `<div class="group-item">
          <div class="group-top">
            <div class="group-title-wrap">
              <span class="group-badge-type ${badgeCls}">${escapeHtml(m.provider)}</span>
              <span class="group-name">${escapeHtml(m.name)}</span>
            </div>
            <div class="group-right">
              <span class="group-tok">${formatCompactTokens(mTok)}</span>
              <span class="group-pct">${mShare}%</span>
            </div>
          </div>
          <div class="group-bar-track">
            <div class="group-bar-fill ${barCls}" style="width: ${Math.max(2, mShare)}%"></div>
          </div>
          <div class="group-meta-row">
            <span>调用 ${m.turnsCount} 轮 (${m.conversationsCount} 会话)</span>
            <span>均速 <b>${m.avgTokPerSec} tok/s</b> · TTFT ${m.avgTtftSec}s</span>
          </div>
          <div class="group-meta-row">
            <span>缓存命中 ${m.cacheHitRate}% (读缓存 ${formatCompactTokens(m.cacheReadTokens)})</span>
            <span>输出 ${formatCompactTokens(m.outputTokens)} (${mSecondary})</span>
          </div>
        </div>`;
      })
      .join('');
  }

  // 5. Top Conversations Leaderboard
  $('g-update-time').textContent = `更新于 ${new Date().toLocaleTimeString()}`;
  const topConvs = Array.isArray(g.topConversations) ? g.topConversations : [];
  const topEl = $('g-top-convs-list');
  if (topConvs.length === 0) {
    topEl.innerHTML = `<div class="empty-state muted">暂无会话记录</div>`;
  } else {
    topEl.innerHTML = topConvs
      .map((c, idx) => {
        const cTok = isNet ? (c.netTokens ?? c.totalTokens) : (c.grossTokens ?? c.totalTokens);
        const cSec = isNet ? `吞吐 ${formatCompactTokens(c.grossTokens)}` : `净 ${formatCompactTokens(c.netTokens)}`;
        return `<div class="turn-item clickable-row" data-conv-id="${escapeHtml(c.id)}" title="点击查看该会话的实时上下文与轮次详情">
          <div class="turn-left">
            <span class="turn-badge">#${idx + 1}</span>
            <span class="turn-title-ellipsis">${escapeHtml(c.title)}</span>
          </div>
          <div class="turn-right">
            <span>[${escapeHtml(c.projectName)}]</span>
            <span>${c.turnsCount} 轮</span>
            <span class="turn-speed">${formatCompactTokens(cTok)} <small style="font-size:10px;font-weight:normal;color:var(--muted-foreground)">(${cSec})</small></span>
          </div>
        </div>`;
      })
      .join('');

    topEl.querySelectorAll('.turn-item[data-conv-id]').forEach((row) => {
      row.addEventListener('click', () => {
        inspectConversation(row.dataset.convId);
      });
    });
  }
}

async function refreshMetrics() {
  try {
    const target = selectedConvId === 'auto' ? 'auto' : selectedConvId;
    const data = await callApi(`/api/metrics?conversationId=${encodeURIComponent(target)}`);
    renderMetrics(data);
  } catch (err) {
    console.error('Failed to fetch session metrics:', err);
  }
}

async function refreshGlobalMetrics() {
  try {
    const data = await callApi('/api/global-metrics');
    renderGlobalMetrics(data);
  } catch (err) {
    console.error('Failed to fetch global metrics:', err);
  }
}

function init() {
  document.querySelectorAll('#view-tabs .view-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  document.querySelectorAll('#scope-switch .scope-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      globalMetricScope = btn.dataset.scope;
      document.querySelectorAll('#scope-switch .scope-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.scope === globalMetricScope);
      });
      if (lastGlobalMetrics) {
        renderGlobalMetrics(lastGlobalMetrics);
      }
    });
  });

  $('conv-select').addEventListener('change', (e) => {
    selectedConvId = e.target.value;
    refreshMetrics();
  });

  // Default to global tab so the user can immediately see the new Global Overview
  switchTab(activeTab);
  loadConversationList();
  refreshMetrics();
  refreshGlobalMetrics();

  setInterval(() => {
    if (activeTab === 'global') {
      refreshGlobalMetrics();
    } else {
      refreshMetrics();
    }
  }, 3000);
  setInterval(loadConversationList, 10000);
}

init();
