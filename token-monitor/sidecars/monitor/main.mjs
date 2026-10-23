import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Response, SidecarApp } from 'sidecar_sdk';

// Language Server in Antigravity hub runs on HTTPS with a self-signed localhost certificate
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DATA_DIR = process.env.ANTIGRAVITY_APP_DATA_DIR || join(homedir(), '.gemini', 'antigravity');
const LS_ADDR = process.env.ANTIGRAVITY_LS_ADDRESS;
const CSRF_TOKEN = process.env.ANTIGRAVITY_CSRF_TOKEN;

const app = new SidecarApp();

const readLocal = (name) => readFileSync(join(HERE, name), 'utf8');

function jsonWithCors(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    contentType: 'application/json; charset=utf-8',
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}

function loadProjectsConfigMap() {
  const map = new Map();
  try {
    const projectsDir = join(homedir(), '.gemini', 'config', 'projects');
    if (!existsSync(projectsDir)) return map;
    for (const file of readdirSync(projectsDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(readFileSync(join(projectsDir, file), 'utf8'));
        if (parsed && parsed.id) {
          map.set(parsed.id, parsed);
        }
      } catch {}
    }
  } catch {}
  return map;
}

async function callLanguageServer(serviceMethod, bodyObj) {
  if (!LS_ADDR || !CSRF_TOKEN) return null;
  const headers = {
    'Content-Type': 'application/json',
    'x-codeium-csrf-token': CSRF_TOKEN,
  };
  const body = JSON.stringify(bodyObj || {});

  // Try HTTPS first (standard for Antigravity language_server.exe)
  try {
    const res = await fetch(`https://${LS_ADDR}/exa.language_server_pb.LanguageServerService/${serviceMethod}`, {
      method: 'POST',
      headers,
      body,
    });
    if (res.ok) return await res.json();
  } catch {}

  // Fallback to HTTP
  try {
    const res = await fetch(`http://${LS_ADDR}/exa.language_server_pb.LanguageServerService/${serviceMethod}`, {
      method: 'POST',
      headers,
      body,
    });
    if (res.ok) return await res.json();
  } catch {}

  return null;
}

function parseProtoDurationSec(val) {
  if (!val || typeof val !== 'string') return 0;
  const num = parseFloat(val.replace(/s$/i, ''));
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function normalizeModelInfo(rawResponseModel, rawUsageModel, rawPlannerModel) {
  const combined = `${rawResponseModel || ''} ${rawPlannerModel || ''} ${rawUsageModel || ''}`.toLowerCase();
  if (combined.includes('claude-opus-4-6-thinking') || rawUsageModel === 'MODEL_PLACEHOLDER_M26') {
    return { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)', provider: 'Anthropic' };
  }
  if (combined.includes('claude-sonnet-4-6') || rawUsageModel === 'MODEL_PLACEHOLDER_M35') {
    return { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'Anthropic' };
  }
  if (
    combined.includes('gemini-3.8-flash-high') ||
    combined.includes('gemini-3.8-flash-exp-a') ||
    rawUsageModel === 'MODEL_PLACEHOLDER_M318'
  ) {
    return { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)', provider: 'Google' };
  }
  if (
    combined.includes('gemini-3.8-flash-medium') ||
    combined.includes('gemini-3.8-flash-n') ||
    combined.includes('gemini-3.8-flash-exp-b') ||
    rawUsageModel === 'MODEL_PLACEHOLDER_M319'
  ) {
    return { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)', provider: 'Google' };
  }
  if (combined.includes('gemini-3.8-flash')) {
    return { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'Google' };
  }
  if (combined.includes('gemini-3.8-pro')) {
    return { id: 'gemini-3.8-pro', name: 'Gemini 3.8 Pro', provider: 'Google' };
  }
  if (combined.includes('gemini-2.5-pro')) {
    return { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'Google' };
  }
  if (combined.includes('gemini-2.5-flash')) {
    return { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'Google' };
  }
  const fallback = rawResponseModel || rawPlannerModel || rawUsageModel || 'Unknown Model';
  return { id: fallback, name: fallback, provider: 'Other' };
}

function formatModelDisplayName(rawModel, rawUsageModel, rawPlannerModel) {
  return normalizeModelInfo(rawModel, rawUsageModel, rawPlannerModel).name;
}

function extractProjectInfo(meta, projectConfigMap) {
  const pid = meta?.projectId;
  const workspaces = Array.isArray(meta?.workspaces) ? meta.workspaces : [];
  const uris = Array.isArray(meta?.workspaceUris) ? meta.workspaceUris : [];
  const rawUri = workspaces[0]?.workspaceFolderAbsoluteUri || uris[0] || '';

  // 1. Direct PID lookup from project JSON configurations
  if (pid && projectConfigMap?.has(pid)) {
    const p = projectConfigMap.get(pid);
    if (p.id !== 'outside-of-project' && !p.name.startsWith('token-monitor') && !p.name.startsWith('custom-persona')) {
      const folderUri = p.projectResources?.resources?.[0]?.folderUri || rawUri || '';
      return {
        key: `project:${p.name}`,
        name: p.name,
        isOutside: false,
        subtitle: folderUri ? decodeURIComponent(folderUri).replace(/^file:\/\/\/?/i, '') : p.name,
        projectId: p.id,
      };
    }
  }

  // 2. Folder URI lookup
  if (rawUri) {
    const decoded = decodeURIComponent(rawUri).replace(/\\/g, '/').replace(/\/+$/, '');
    if (projectConfigMap) {
      for (const p of projectConfigMap.values()) {
        const pUri = p.projectResources?.resources?.[0]?.folderUri;
        if (pUri && decodeURIComponent(pUri).toLowerCase() === rawUri.toLowerCase()) {
          return {
            key: `project:${p.name}`,
            name: p.name,
            isOutside: false,
            subtitle: decoded.replace(/^file:\/\/\/?/i, ''),
            projectId: p.id,
          };
        }
      }
    }
    const wtMatch = decoded.match(/\/worktrees\/([^/]+)\//i);
    let name = wtMatch?.[1] || '';
    if (!name) {
      const parts = decoded.split('/').filter(Boolean);
      name = parts[parts.length - 1];
    }
    if (name && name !== 'antigravity' && name !== 'scratch') {
      const repoName = workspaces[0]?.repository?.computedName || '';
      const branch = workspaces[0]?.branchName || '';
      const subtitle = repoName
        ? branch
          ? `${repoName} (${branch})`
          : repoName
        : decoded.replace(/^file:\/\/\/?/i, '');
      return {
        key: `project:${name}`,
        name,
        isOutside: false,
        subtitle,
        projectId: pid || null,
      };
    }
  }

  // 3. Fallback to outside of project
  return {
    key: 'outside-of-project',
    name: '对话',
    isOutside: true,
    subtitle: '无项目归属对话合并',
    projectId: 'outside-of-project',
  };
}

function decodePbtxtString(escaped) {
  const bytes = [];
  for (let i = 0; i < escaped.length; i++) {
    if (escaped[i] === '\\' && i + 1 < escaped.length) {
      const next = escaped[i + 1];
      if (next >= '0' && next <= '7') {
        let oct = '';
        let j = i + 1;
        while (j < escaped.length && j < i + 4 && escaped[j] >= '0' && escaped[j] <= '7') {
          oct += escaped[j++];
        }
        bytes.push(parseInt(oct, 8));
        i = j - 1;
        continue;
      }
      if (next === 'n') { bytes.push(10); i++; continue; }
      if (next === 'r') { bytes.push(13); i++; continue; }
      if (next === 't') { bytes.push(9); i++; continue; }
      if (next === '"' || next === '\\' || next === "'") {
        bytes.push(escaped.charCodeAt(i + 1));
        i++;
        continue;
      }
    }
    const buf = Buffer.from(escaped[i], 'utf8');
    for (const b of buf) bytes.push(b);
  }
  return Buffer.from(bytes).toString('utf8');
}

function parseAnnotationPbtxt(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf8');
    let title = '';
    const titleMatch = raw.match(/title:\s*"((?:[^"\\]|\\.)*)"/);
    if (titleMatch) {
      title = decodePbtxtString(titleMatch[1]);
    }
    const secMatch = raw.match(/last_user_view_time:\s*\{\s*seconds:\s*(\d+)/);
    const lastViewMs = secMatch ? Number(secMatch[1]) * 1000 : 0;
    return { title, lastViewMs };
  } catch {
    return { title: '', lastViewMs: 0 };
  }
}

function listConversations() {
  const annotationsDir = join(APP_DATA_DIR, 'annotations');
  const brainDir = join(APP_DATA_DIR, 'brain');
  const map = new Map();

  if (existsSync(annotationsDir)) {
    for (const file of readdirSync(annotationsDir)) {
      if (!file.endsWith('.pbtxt')) continue;
      const id = file.slice(0, -6);
      const fullPath = join(annotationsDir, file);
      const { title, lastViewMs } = parseAnnotationPbtxt(fullPath);
      let mtimeMs = lastViewMs;
      try {
        const st = statSync(fullPath);
        if (st.mtimeMs > mtimeMs) mtimeMs = st.mtimeMs;
      } catch {
        // Ignore stat race
      }
      map.set(id, {
        id,
        title: title || `会话 ${id.slice(0, 8)}`,
        updatedAtMs: mtimeMs,
      });
    }
  }

  if (existsSync(brainDir)) {
    for (const entry of readdirSync(brainDir)) {
      if (entry === 'tempmediaStorage') continue;
      const transcriptPath = join(brainDir, entry, '.system_generated', 'logs', 'transcript.jsonl');
      if (!existsSync(transcriptPath)) continue;
      try {
        const st = statSync(transcriptPath);
        const existing = map.get(entry);
        if (existing) {
          if (st.mtimeMs > existing.updatedAtMs) {
            existing.updatedAtMs = st.mtimeMs;
          }
        } else {
          map.set(entry, {
            id: entry,
            title: `会话 ${entry.slice(0, 8)}`,
            updatedAtMs: st.mtimeMs,
          });
        }
      } catch {
        // Ignore stat error
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

async function fetchCascadeTrajectory(conversationId) {
  if (!conversationId) return null;
  const [trajData, gmData] = await Promise.all([
    callLanguageServer('GetCascadeTrajectory', { cascadeId: conversationId }),
    callLanguageServer('GetCascadeTrajectoryGeneratorMetadata', { cascadeId: conversationId, generatorMetadataOffset: 0 }),
  ]);

  if (!trajData) return null;
  if (Array.isArray(gmData?.generatorMetadata) && gmData.generatorMetadata.length > 0 && trajData?.trajectory) {
    trajData.trajectory.generatorMetadata = gmData.generatorMetadata;
  }
  return trajData;
}

function buildMetricsFromTrajectory(conversationId, trajResp, convTitle) {
  const trajectory = trajResp?.trajectory || {};
  const gmList = Array.isArray(trajectory.generatorMetadata) ? trajectory.generatorMetadata : [];
  const steps = Array.isArray(trajectory.steps) ? trajectory.steps : [];
  const runStatus = trajResp?.status || 'UNKNOWN';

  let plannerConfig = null;
  for (let i = gmList.length - 1; i >= 0; i--) {
    if (gmList[i]?.plannerConfig) {
      plannerConfig = gmList[i].plannerConfig;
      break;
    }
  }

  const turns = [];
  let sumInputTokens = 0;
  let sumCacheReadTokens = 0;
  let sumOutputTokens = 0;
  let sumThinkingTokens = 0;
  let sumResponseTokens = 0;
  let weightedSpeedNumer = 0;
  let weightedSpeedDenom = 0;

  for (let i = 0; i < gmList.length; i++) {
    const gm = gmList[i];
    const chatModel = gm?.chatModel;
    if (!chatModel || !chatModel.usage) continue;

    const u = chatModel.usage;
    const inputTokens = Number(u.inputTokens || 0);
    const cacheReadTokens = Number(u.cacheReadTokens || 0);
    const totalInputTokens = inputTokens + cacheReadTokens;
    const outputTokens = Number(u.outputTokens || 0);
    const thinkingTokens = Number(u.thinkingOutputTokens || 0);
    const responseTokens = Number(u.responseOutputTokens || Math.max(0, outputTokens - thinkingTokens));

    const ttftSec = parseProtoDurationSec(chatModel.timeToFirstToken);
    const streamSec = parseProtoDurationSec(chatModel.streamingDuration);
    const totalSec = ttftSec + streamSec;

    // Thinking tokens are generated during TTFT before streaming begins, so
    // total output tokens divided by (TTFT + streamingDuration) reflects true generation throughput.
    const tokPerSec = totalSec > 0.05 ? outputTokens / totalSec : 0;
    const streamTokPerSec =
      streamSec >= 0.25 && responseTokens > 0
        ? responseTokens / streamSec
        : tokPerSec;

    const cacheHitRate = totalInputTokens > 0 ? (cacheReadTokens / totalInputTokens) * 100 : 0;
    const ctxMeta = chatModel.chatStartMetadata?.contextWindowMetadata || {};
    const stepIdx = Array.isArray(gm.stepIndices) && gm.stepIndices.length > 0 ? gm.stepIndices[0] : i;
    const stepObj = steps[stepIdx] || {};
    const createdAt = stepObj?.metadata?.createdAt || null;

    sumInputTokens += inputTokens;
    sumCacheReadTokens += cacheReadTokens;
    sumOutputTokens += outputTokens;
    sumThinkingTokens += thinkingTokens;
    sumResponseTokens += responseTokens;
    if (totalSec > 0.05 && outputTokens > 0) {
      weightedSpeedNumer += outputTokens;
      weightedSpeedDenom += totalSec;
    }

    turns.push({
      turnNumber: turns.length + 1,
      stepIndex: stepIdx,
      model: chatModel.responseModel || plannerConfig?.modelName || u.model || '',
      inputTokens,
      cacheReadTokens,
      totalInputTokens,
      outputTokens,
      thinkingTokens,
      responseTokens,
      ttftSec: Number(ttftSec.toFixed(2)),
      streamSec: Number(streamSec.toFixed(2)),
      totalSec: Number(totalSec.toFixed(2)),
      tokPerSec: Number(tokPerSec.toFixed(1)),
      streamTokPerSec: Number(streamTokPerSec.toFixed(1)),
      cacheHitRate: Number(cacheHitRate.toFixed(1)),
      estimatedContextTokens: Number(ctxMeta.estimatedTokensUsed || totalInputTokens + outputTokens),
      plannerMaxContextTokens: Number(ctxMeta.maxContextTokens || 256000),
      createdAt,
    });
  }

  const latestTurn = turns.length > 0 ? turns[turns.length - 1] : null;
  const firstTurn = turns.length > 0 ? turns[0] : null;

  let firstUserChars = 240;
  if (steps.length > 0) {
    const s0 = JSON.stringify(steps[0] || {});
    firstUserChars = Math.max(120, Math.min(6000, s0.length));
  }
  const firstUserEstTokens = Math.round(firstUserChars / 3.8);

  const firstTurnTotalInput = firstTurn ? firstTurn.totalInputTokens : 0;
  const baseOverheadTokens =
    firstTurnTotalInput > 0
      ? Math.max(0, firstTurnTotalInput - Math.min(firstUserEstTokens, Math.floor(firstTurnTotalInput * 0.25)))
      : 0;

  const declaredToolCount = plannerConfig?.declarativeMixinConfig?.tools?.length || 15;
  const estimatedToolRatio = Math.min(0.68, Math.max(0.38, (declaredToolCount * 470) / Math.max(1, baseOverheadTokens || 15500)));
  const toolDefTokens = Math.round(baseOverheadTokens * estimatedToolRatio);
  const systemPromptTokens = Math.max(0, baseOverheadTokens - toolDefTokens);

  const currentContextTokens = latestTurn
    ? latestTurn.totalInputTokens + latestTurn.outputTokens
    : 0;
  const conversationTokens = Math.max(0, currentContextTokens - baseOverheadTokens);

  let dialogueChars = 0;
  let toolOutputChars = 0;
  for (const st of steps) {
    const stType = String(st?.type || '');
    if (stType.includes('USER_INPUT') || stType.includes('PLANNER_RESPONSE')) {
      dialogueChars += JSON.stringify(st?.plannerResponse || st?.userInput || {}).length;
    } else {
      toolOutputChars += JSON.stringify(st || {}).length;
    }
  }
  const totalStepChars = Math.max(1, dialogueChars + toolOutputChars);
  const toolMessageTokens = Math.round(conversationTokens * (toolOutputChars / totalStepChars));
  const chatMessageTokens = Math.max(0, conversationTokens - toolMessageTokens);

  const avgTokPerSec = weightedSpeedDenom > 0 ? Number((weightedSpeedNumer / weightedSpeedDenom).toFixed(1)) : 0;
  const totalAllInput = sumInputTokens + sumCacheReadTokens;
  const sessionCacheHitRate = totalAllInput > 0 ? Number(((sumCacheReadTokens / totalAllInput) * 100).toFixed(1)) : 0;

  const rawModelName = latestTurn?.model || plannerConfig?.modelName || 'gemini-3.8-flash';
  const plannerMaxTokens = latestTurn?.plannerMaxContextTokens || 256000;
  const modelNativeMaxTokens = 1000000;

  return {
    source: 'language_server',
    conversationId,
    title: convTitle || `会话 ${conversationId.slice(0, 8)}`,
    status: runStatus,
    isRunning: runStatus === 'CASCADE_RUN_STATUS_RUNNING',
    modelName: formatModelDisplayName(rawModelName),
    rawModelName,
    totalSteps: Number(trajResp?.numTotalSteps || steps.length),
    totalTurns: turns.length,
    current: {
      tokPerSec: latestTurn ? latestTurn.tokPerSec : 0,
      streamTokPerSec: latestTurn ? latestTurn.streamTokPerSec : 0,
      avgTokPerSec,
      ttftSec: latestTurn ? latestTurn.ttftSec : 0,
      streamSec: latestTurn ? latestTurn.streamSec : 0,
      totalSec: latestTurn ? latestTurn.totalSec : 0,
      cacheHitRate: latestTurn ? latestTurn.cacheHitRate : 0,
      sessionCacheHitRate,
      inputTokens: latestTurn ? latestTurn.inputTokens : 0,
      cacheReadTokens: latestTurn ? latestTurn.cacheReadTokens : 0,
      outputTokens: latestTurn ? latestTurn.outputTokens : 0,
      thinkingTokens: latestTurn ? latestTurn.thinkingTokens : 0,
      responseTokens: latestTurn ? latestTurn.responseTokens : 0,
    },
    context: {
      usedTokens: currentContextTokens,
      estimatedTokensUsed: latestTurn ? latestTurn.estimatedContextTokens : 0,
      maxTokens1M: modelNativeMaxTokens,
      maxTokensPlanner: plannerMaxTokens,
      breakdown: {
        systemPromptTokens,
        toolDefTokens,
        conversationTokens,
        chatMessageTokens,
        toolMessageTokens,
      },
    },
    sessionTotals: {
      uncachedInputTokens: sumInputTokens,
      cacheReadTokens: sumCacheReadTokens,
      totalInputTokens: totalAllInput,
      outputTokens: sumOutputTokens,
      thinkingTokens: sumThinkingTokens,
      responseTokens: sumResponseTokens,
    },
    turns: turns.slice(-30).reverse(),
    updatedAt: new Date().toISOString(),
  };
}

function buildMetricsFromTranscriptFile(conversationId, convTitle) {
  const transcriptPath = join(
    APP_DATA_DIR,
    'brain',
    conversationId,
    '.system_generated',
    'logs',
    'transcript.jsonl'
  );
  if (!existsSync(transcriptPath)) {
    return null;
  }

  const lines = readFileSync(transcriptPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  const turns = [];
  let sumInput = 0;
  let sumCache = 0;
  let sumOutput = 0;

  for (const line of lines) {
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    if (item.type !== 'PLANNER_RESPONSE') continue;

    const inputTokens = Number(item.input_tokens || 0);
    const cacheReadTokens = Number(item.cache_read_tokens || 0);
    const totalInputTokens = inputTokens + cacheReadTokens;
    const outputTokens = Number(item.output_tokens || 0);
    const cacheHitRate = totalInputTokens > 0 ? (cacheReadTokens / totalInputTokens) * 100 : 0;

    sumInput += inputTokens;
    sumCache += cacheReadTokens;
    sumOutput += outputTokens;

    turns.push({
      turnNumber: turns.length + 1,
      stepIndex: item.step_index,
      model: 'Gemini',
      inputTokens,
      cacheReadTokens,
      totalInputTokens,
      outputTokens,
      thinkingTokens: 0,
      responseTokens: outputTokens,
      ttftSec: 0,
      streamSec: 0,
      totalSec: 0,
      tokPerSec: 0,
      streamTokPerSec: 0,
      cacheHitRate: Number(cacheHitRate.toFixed(1)),
      estimatedContextTokens: totalInputTokens + outputTokens,
      plannerMaxContextTokens: 256000,
      createdAt: item.created_at || null,
    });
  }

  const latestTurn = turns.length > 0 ? turns[turns.length - 1] : null;
  const firstTurn = turns.length > 0 ? turns[0] : null;
  const firstTurnInput = firstTurn ? firstTurn.totalInputTokens : 0;
  const baseOverhead = Math.max(0, firstTurnInput - 150);
  const toolDefTokens = Math.round(baseOverhead * 0.52);
  const systemPromptTokens = Math.max(0, baseOverhead - toolDefTokens);
  const currentContextTokens = latestTurn ? latestTurn.totalInputTokens + latestTurn.outputTokens : 0;
  const conversationTokens = Math.max(0, currentContextTokens - baseOverhead);
  const totalAllInput = sumInput + sumCache;

  return {
    source: 'transcript_fallback',
    conversationId,
    title: convTitle || `会话 ${conversationId.slice(0, 8)}`,
    status: 'IDLE',
    isRunning: false,
    modelName: 'Gemini',
    rawModelName: 'gemini',
    totalSteps: lines.length,
    totalTurns: turns.length,
    current: {
      tokPerSec: 0,
      streamTokPerSec: 0,
      avgTokPerSec: 0,
      ttftSec: 0,
      streamSec: 0,
      totalSec: 0,
      cacheHitRate: latestTurn ? latestTurn.cacheHitRate : 0,
      sessionCacheHitRate: totalAllInput > 0 ? Number(((sumCache / totalAllInput) * 100).toFixed(1)) : 0,
      inputTokens: latestTurn ? latestTurn.inputTokens : 0,
      cacheReadTokens: latestTurn ? latestTurn.cacheReadTokens : 0,
      outputTokens: latestTurn ? latestTurn.outputTokens : 0,
      thinkingTokens: 0,
      responseTokens: latestTurn ? latestTurn.outputTokens : 0,
    },
    context: {
      usedTokens: currentContextTokens,
      estimatedTokensUsed: currentContextTokens,
      maxTokens1M: 1000000,
      maxTokensPlanner: 256000,
      breakdown: {
        systemPromptTokens,
        toolDefTokens,
        conversationTokens,
        chatMessageTokens: conversationTokens,
        toolMessageTokens: 0,
      },
    },
    sessionTotals: {
      uncachedInputTokens: sumInput,
      cacheReadTokens: sumCache,
      totalInputTokens: totalAllInput,
      outputTokens: sumOutput,
      thinkingTokens: 0,
      responseTokens: sumOutput,
    },
    turns: turns.slice(-30).reverse(),
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Inline Chat Input Box Status Bar Injector (via Electron DevToolsActivePort)
// ---------------------------------------------------------------------------

// Self-contained frontend script injected into the main Antigravity window so
// the DSH-style telemetry bar renders directly underneath the chat input box.
const INLINE_CHAT_BAR_SCRIPT = `
(function() {
  const MY_VER = 6;
  if (window.__AGY_DSH_INLINE_VERSION__ === MY_VER && window.__AGY_DSH_INLINE_TIMER__) return;

  if (window.__AGY_DSH_INLINE_TIMER__) {
    clearInterval(window.__AGY_DSH_INLINE_TIMER__);
    window.__AGY_DSH_INLINE_TIMER__ = null;
  }
  if (window.__AGY_DSH_INLINE_OBS__) {
    try { window.__AGY_DSH_INLINE_OBS__.disconnect(); } catch {}
    window.__AGY_DSH_INLINE_OBS__ = null;
  }
  try { localStorage.setItem('agy_dsh_cap_mode', '256000'); } catch {}

  function getQuerySelector() {
    if (document.__agyOrigQsa) {
      document.querySelectorAll = document.__agyOrigQsa;
      delete document.__agyOrigQsa;
    }
    return document.querySelectorAll.bind(document);
  }

  function ensureStyle() {
    const STYLE_ID = 'agy-dsh-inline-style-v6';
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      const parent = document.head || document.documentElement;
      if (!parent) return false;
      style = document.createElement('style');
      style.id = STYLE_ID;
      parent.appendChild(style);
    }
    style.textContent = \`
      .agy-dsh-inline-v6 {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        width: 100%;
        padding: 5px 6px 1px 6px;
        user-select: none;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        z-index: 40;
      }
      .agy-dsh-bar {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 14px;
        font-size: 12px;
        line-height: 1.4;
        color: var(--muted-foreground, #64748b);
        font-variant-numeric: tabular-nums;
      }
      .agy-dsh-item {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        white-space: nowrap;
      }
      .agy-dsh-icon {
        width: 14px;
        height: 14px;
        opacity: 0.78;
        flex-shrink: 0;
      }
      .agy-dsh-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 2px 9px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--foreground, #0f172a) 7%, transparent);
        color: var(--foreground, #1e293b);
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s ease;
      }
      .agy-dsh-pill:hover,
      .agy-dsh-pill.pinned {
        background: color-mix(in srgb, var(--foreground, #0f172a) 13%, transparent);
      }
      .agy-dsh-ring {
        width: 13px;
        height: 13px;
        transform: rotate(-90deg);
        flex-shrink: 0;
      }
      .agy-dsh-ring-bg {
        stroke: color-mix(in srgb, var(--foreground, #0f172a) 18%, transparent);
      }
      .agy-dsh-ring-fg {
        stroke: var(--primary, #3b82f6);
        stroke-linecap: round;
        transition: stroke-dashoffset 0.3s ease;
      }
      .agy-dsh-popover {
        position: absolute;
        right: 0;
        bottom: calc(100% + 8px);
        width: 288px;
        padding: 14px 16px;
        border-radius: 12px;
        background: var(--card, #ffffff);
        color: var(--foreground, #0f172a);
        border: 1px solid var(--card-border, var(--border, #e2e8f0));
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.14);
        display: flex;
        flex-direction: column;
        gap: 11px;
        opacity: 0;
        pointer-events: none;
        transform: translateY(4px);
        transition: opacity 0.16s ease, transform 0.16s ease;
        z-index: 9999;
      }
      .agy-dsh-bar:hover .agy-dsh-popover,
      .agy-dsh-bar.pinned .agy-dsh-popover {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
      }
      .agy-dsh-pop-header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        font-size: 13px;
      }
      .agy-dsh-pop-title {
        color: var(--muted-foreground, #64748b);
      }
      .agy-dsh-pop-title strong {
        color: var(--foreground, #0f172a);
        font-weight: 600;
        margin-left: 2px;
      }
      .agy-dsh-pop-frac {
        font-weight: 600;
        color: var(--foreground, #0f172a);
      }
      .agy-dsh-track {
        width: 100%;
        height: 6px;
        background: color-mix(in srgb, var(--foreground, #0f172a) 7%, transparent);
        border-radius: 999px;
        overflow: hidden;
        display: flex;
        gap: 1.5px;
      }
      .agy-dsh-seg {
        height: 100%;
        transition: width 0.3s ease;
      }
      .agy-seg-sys { background: #94a3b8; border-radius: 999px 0 0 999px; }
      .agy-seg-tool { background: #a855f7; }
      .agy-seg-chat { background: #3b82f6; border-radius: 0 999px 999px 0; }
      .agy-dsh-rows {
        display: flex;
        flex-direction: column;
        gap: 7px;
        font-size: 12.5px;
      }
      .agy-dsh-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .agy-dsh-row-left {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--muted-foreground, #475569);
      }
      .agy-dsh-dot {
        width: 8px;
        height: 8px;
        border-radius: 2px;
        display: inline-block;
      }
      .agy-dot-sys { background: #94a3b8; }
      .agy-dot-tool { background: #a855f7; }
      .agy-dot-chat { background: #3b82f6; }
      .agy-dsh-row-val {
        font-weight: 500;
        color: var(--foreground, #0f172a);
      }
      .agy-dsh-pop-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-top: 7px;
        border-top: 1px dashed var(--border, #e2e8f0);
        font-size: 11px;
        color: var(--muted-foreground, #64748b);
      }
    \`;
    return true;
  }

  const metricsCache = new Map();

  function fmtTok(num) {
    const n = Number(num || 0);
    if (n <= 0) return '0';
    if (n >= 1000000) {
      const m = n / 1000000;
      return (m % 1 === 0 ? m.toFixed(0) : m.toFixed(2)) + 'M';
    }
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(Math.round(n));
  }

  function parseSec(str) {
    if (!str || typeof str !== 'string') return 0;
    const v = parseFloat(str.replace(/s$/i, ''));
    return Number.isFinite(v) && v >= 0 ? v : 0;
  }

  function getActiveCascadeIds() {
    const m = location.pathname.match(/^\\/c\\/([^/]+)/);
    if (m) {
      return decodeURIComponent(m[1]).split('+').filter(Boolean);
    }
    const searchParams = new URLSearchParams(location.search);
    const qId = searchParams.get('c') || searchParams.get('cascadeId');
    if (qId) return [qId];
    return [];
  }

  async function fetchCascadeMetrics(cascadeId) {
    if (!cascadeId || cascadeId === '_new') return null;
    const csrf = window.__APP_CONFIG__?.csrfToken;
    if (!csrf) return null;

    const res = await fetch('/exa.language_server_pb.LanguageServerService/GetCascadeTrajectoryGeneratorMetadata', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-codeium-csrf-token': csrf,
      },
      body: JSON.stringify({ cascadeId, generatorMetadataOffset: 0 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const gmList = Array.isArray(data?.generatorMetadata) ? data.generatorMetadata : [];
    if (gmList.length === 0) return null;

    const valid = gmList.filter(g => g?.chatModel?.usage);
    if (valid.length === 0) return null;

    const first = valid[0].chatModel;
    const latest = valid[valid.length - 1].chatModel;

    const firstIn = Number(first.usage.inputTokens || 0) + Number(first.usage.cacheReadTokens || 0);
    const baseOverhead = Math.max(0, firstIn - 180);
    const toolDefTokens = Math.round(baseOverhead * 0.49);
    const systemPromptTokens = Math.max(0, baseOverhead - toolDefTokens);

    const inTok = Number(latest.usage.inputTokens || 0);
    const cacheTok = Number(latest.usage.cacheReadTokens || 0);
    const outTok = Number(latest.usage.outputTokens || 0);
    const thinkTok = Number(latest.usage.thinkingOutputTokens || 0);
    const respTok = Number(latest.usage.responseOutputTokens || Math.max(0, outTok - thinkTok));
    const totalIn = inTok + cacheTok;
    const usedTokens = totalIn + outTok;
    const conversationTokens = Math.max(0, usedTokens - baseOverhead);

    const cacheHitRate = totalIn > 0 ? (cacheTok / totalIn) * 100 : 0;
    const ttftSec = parseSec(latest.timeToFirstToken);
    const streamSec = parseSec(latest.streamingDuration);
    const totalSec = ttftSec + streamSec;
    const tokPerSec = totalSec > 0.05 ? outTok / totalSec : 0;
    const plannerMax = Number(latest.chatStartMetadata?.contextWindowMetadata?.maxContextTokens || 256000);

    return {
      tokPerSec,
      cacheHitRate,
      usedTokens,
      plannerMax,
      systemPromptTokens,
      toolDefTokens,
      conversationTokens,
      ttftSec,
      streamSec,
      thinkTok,
      respTok,
      turnsCount: valid.length,
    };
  }

  function createWidgetDom() {
    const host = document.createElement('div');
    host.className = 'agy-dsh-inline-v6 cursor-edit';
    host.setAttribute('data-code', 'true');
    host.innerHTML = \`
      <div class="agy-dsh-bar">
        <div class="agy-dsh-item" title="最新一轮 Token 生成速度">
          <svg class="agy-dsh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 14l4-4"/>
            <path d="M3.34 19a10 10 0 1 1 17.32 0"/>
          </svg>
          <span data-role="speed">-- tok/s</span>
        </div>

        <div class="agy-dsh-item" title="最新一轮请求的前缀缓存命中率 (cacheReadTokens / totalInputTokens)">
          <svg class="agy-dsh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <ellipse cx="12" cy="5" rx="9" ry="3"/>
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
          </svg>
          <span>缓存命中 <span data-role="cache">--%</span></span>
        </div>

        <div class="agy-dsh-pill" data-role="pill" title="悬停查看上下文详情，点击可固定浮层">
          <svg class="agy-dsh-ring" viewBox="0 0 20 20">
            <circle class="agy-dsh-ring-bg" cx="10" cy="10" r="7" fill="none" stroke-width="2.2"/>
            <circle class="agy-dsh-ring-fg" data-role="ring" cx="10" cy="10" r="7" fill="none" stroke-width="2.2" stroke-dasharray="43.98" stroke-dashoffset="43.98"/>
          </svg>
          <span data-role="pct">0%</span>
        </div>

        <div class="agy-dsh-popover" data-role="popover">
          <div class="agy-dsh-pop-header">
            <span class="agy-dsh-pop-title">上下文已用 <strong data-role="pop-pct">0%</strong></span>
            <span class="agy-dsh-pop-frac" data-role="pop-frac">~0 / 256K</span>
          </div>

          <div class="agy-dsh-track">
            <div class="agy-dsh-seg agy-seg-sys" data-role="seg-sys" style="width: 0%"></div>
            <div class="agy-dsh-seg agy-seg-tool" data-role="seg-tool" style="width: 0%"></div>
            <div class="agy-dsh-seg agy-seg-chat" data-role="seg-chat" style="width: 0%"></div>
          </div>

          <div class="agy-dsh-rows">
            <div class="agy-dsh-row">
              <div class="agy-dsh-row-left">
                <span class="agy-dsh-dot agy-dot-sys"></span>
                <span>系统提示词</span>
              </div>
              <span class="agy-dsh-row-val" data-role="val-sys">~0</span>
            </div>

            <div class="agy-dsh-row">
              <div class="agy-dsh-row-left">
                <span class="agy-dsh-dot agy-dot-tool"></span>
                <span>工具定义</span>
              </div>
              <span class="agy-dsh-row-val" data-role="val-tool">~0</span>
            </div>

            <div class="agy-dsh-row">
              <div class="agy-dsh-row-left">
                <span class="agy-dsh-dot agy-dot-chat"></span>
                <span>对话消息</span>
              </div>
              <span class="agy-dsh-row-val" data-role="val-chat">~0</span>
            </div>
          </div>

          <div class="agy-dsh-pop-foot">
            <span data-role="foot-latency">TTFT --s · 流式 --s</span>
            <span data-role="foot-turns">共 0 轮</span>
          </div>
        </div>
      </div>
    \`;

    const bar = host.querySelector('.agy-dsh-bar');
    const pill = host.querySelector('[data-role="pill"]');

    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      const pinned = bar.classList.toggle('pinned');
      pill.classList.toggle('pinned', pinned);
    });

    document.addEventListener('click', (e) => {
      if (!host.contains(e.target)) {
        bar.classList.remove('pinned');
        pill.classList.remove('pinned');
      }
    });

    return host;
  }

  function updateWidgetDom(host, m) {
    const q = (role) => host.querySelector(\`[data-role="\${role}"]\`);
    if (!m) {
      q('speed').textContent = '-- tok/s';
      q('cache').textContent = '--%';
      q('pct').textContent = '0%';
      q('pop-pct').textContent = '0%';
      q('pop-frac').textContent = '~0 / 256K';
      q('ring').style.strokeDashoffset = '43.98';
      q('seg-sys').style.width = '0%';
      q('seg-tool').style.width = '0%';
      q('seg-chat').style.width = '0%';
      q('val-sys').textContent = '~0';
      q('val-tool').textContent = '~0';
      q('val-chat').textContent = '~0';
      q('foot-latency').textContent = '等待对话生成...';
      q('foot-turns').textContent = '0 轮';
      return;
    }

    const cap = m.plannerMax || 256000;
    const capLabel = cap >= 1000000 ? (cap / 1000000).toFixed(0) + 'M' : Math.round(cap / 1000) + 'K';
    const rawPct = cap > 0 ? (m.usedTokens / cap) * 100 : 0;
    const pctStr = (rawPct > 0 && rawPct < 1 ? rawPct.toFixed(1) : Math.round(rawPct)) + '%';

    q('speed').textContent = m.tokPerSec > 0 ? Math.round(m.tokPerSec) + ' tok/s' : '-- tok/s';
    q('cache').textContent = Math.round(m.cacheHitRate) + '%';
    q('pct').textContent = pctStr;
    q('pop-pct').textContent = pctStr;
    q('pop-frac').textContent = \`~\${fmtTok(m.usedTokens)} / \${capLabel}\`;

    const circumference = 43.98;
    const clampedPct = Math.min(100, Math.max(0, rawPct));
    q('ring').style.strokeDashoffset = (circumference - (clampedPct / 100) * circumference).toFixed(2);

    const visualTotalPct = m.usedTokens > 0 ? Math.min(100, Math.max(rawPct, 4)) : 0;
    const sumParts = Math.max(1, m.systemPromptTokens + m.toolDefTokens + m.conversationTokens);
    q('seg-sys').style.width = ((m.systemPromptTokens / sumParts) * visualTotalPct).toFixed(2) + '%';
    q('seg-tool').style.width = ((m.toolDefTokens / sumParts) * visualTotalPct).toFixed(2) + '%';
    q('seg-chat').style.width = ((m.conversationTokens / sumParts) * visualTotalPct).toFixed(2) + '%';

    q('val-sys').textContent = '~' + fmtTok(m.systemPromptTokens);
    q('val-tool').textContent = '~' + fmtTok(m.toolDefTokens);
    q('val-chat').textContent = '~' + fmtTok(m.conversationTokens);
    q('foot-latency').textContent = \`TTFT \${m.ttftSec.toFixed(1)}s · 流式 \${m.streamSec.toFixed(1)}s\`;
    q('foot-turns').textContent = \`共 \${m.turnsCount} 轮\`;
  }

  async function refreshAllBoxes() {
    if (window.__AGY_DSH_INLINE_VERSION__ !== MY_VER) return;
    ensureStyle();

    const qsa = getQuerySelector();
    qsa('.agy-dsh-inline-host, .agy-dsh-inline-v5').forEach((el) => el.remove());

    const boxes = Array.from(qsa('[data-testid="agent-input-box"]'));
    if (boxes.length === 0) return;

    const ids = getActiveCascadeIds();
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      let host = box.querySelector(':scope > .agy-dsh-inline-v6');
      if (!host) {
        host = createWidgetDom();
        box.appendChild(host);
      }
      const cascadeId = ids[i] || ids[0] || '';
      if (!cascadeId || cascadeId === '_new') {
        updateWidgetDom(host, null);
        continue;
      }
      if (metricsCache.has(cascadeId)) {
        updateWidgetDom(host, metricsCache.get(cascadeId));
      }
      fetchCascadeMetrics(cascadeId)
        .then((m) => {
          if (window.__AGY_DSH_INLINE_VERSION__ !== MY_VER) return;
          if (m) {
            metricsCache.set(cascadeId, m);
            updateWidgetDom(host, m);
          }
        })
        .catch(() => {});
    }
  }

  function startMonitoring() {
    ensureStyle();
    refreshAllBoxes();

    if (!window.__AGY_DSH_INLINE_TIMER__) {
      window.__AGY_DSH_INLINE_TIMER__ = setInterval(refreshAllBoxes, 2000);
    }

    if (!window.__AGY_DSH_INLINE_OBS__) {
      const target = document.body || document.documentElement;
      if (target) {
        const obs = new MutationObserver(() => {
          if (window.__AGY_DSH_INLINE_VERSION__ !== MY_VER) return;
          const qsa = getQuerySelector();
          const boxes = qsa('[data-testid="agent-input-box"]');
          for (let i = 0; i < boxes.length; i++) {
            if (!boxes[i].querySelector(':scope > .agy-dsh-inline-v6')) {
              refreshAllBoxes();
              break;
            }
          }
        });
        obs.observe(target, { childList: true, subtree: true });
        window.__AGY_DSH_INLINE_OBS__ = obs;
      }
    }
    window.__AGY_DSH_INLINE_VERSION__ = MY_VER;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startMonitoring);
  } else {
    startMonitoring();
  }
})();
`;

function findDevToolsActivePortFile() {
  const candidates = [];
  if (process.env.APPDATA) {
    candidates.push(join(process.env.APPDATA, 'Antigravity', 'DevToolsActivePort'));
    candidates.push(join(process.env.APPDATA, 'antigravity', 'DevToolsActivePort'));
  }
  const home = homedir();
  candidates.push(join(home, 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort'));
  candidates.push(join(home, '.config', 'Antigravity', 'DevToolsActivePort'));
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

const injectedTargets = new Set();

function injectInlineBarViaCdp() {
  const portFile = findDevToolsActivePortFile();
  if (!portFile || typeof WebSocket === 'undefined') return;

  let port;
  let wsPath;
  try {
    const lines = readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
    port = lines[0]?.trim();
    wsPath = lines[1]?.trim();
  } catch {
    return;
  }
  if (!port || !wsPath) return;

  let ws;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  } catch {
    return;
  }

  let msgId = 1;
  const pendingAttach = new Map();
  const timeout = setTimeout(() => {
    try { ws.close(); } catch {}
  }, 4000);

  ws.onopen = () => {
    ws.send(JSON.stringify({ id: msgId++, method: 'Target.getTargets' }));
  };

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }

    if (msg.id === 1 && msg.result?.targetInfos) {
      const pages = msg.result.targetInfos.filter(
        (t) => t.type === 'page' && (t.url.startsWith('https://127.0.0.1') || t.url.startsWith('http://127.0.0.1'))
      );
      if (pages.length === 0) {
        clearTimeout(timeout);
        ws.close();
        return;
      }
      for (const p of pages) {
        const id = msgId++;
        pendingAttach.set(id, p.targetId);
        ws.send(
          JSON.stringify({
            id,
            method: 'Target.attachToTarget',
            params: { targetId: p.targetId, flatten: true },
          })
        );
      }
    } else if (pendingAttach.has(msg.id) && msg.result?.sessionId) {
      const targetId = pendingAttach.get(msg.id);
      const sessionId = msg.result.sessionId;
      if (!injectedTargets.has(targetId)) {
        injectedTargets.add(targetId);
        ws.send(JSON.stringify({ id: msgId++, sessionId, method: 'Page.enable' }));
        ws.send(
          JSON.stringify({
            id: msgId++,
            sessionId,
            method: 'Page.addScriptToEvaluateOnNewDocument',
            params: { source: INLINE_CHAT_BAR_SCRIPT },
          })
        );
      }
      ws.send(
        JSON.stringify({
          id: msgId++,
          sessionId,
          method: 'Runtime.evaluate',
          params: { expression: INLINE_CHAT_BAR_SCRIPT },
        })
      );
      setTimeout(() => {
        clearTimeout(timeout);
        try { ws.close(); } catch {}
      }, 300);
    }
  };

  ws.onerror = () => {
    clearTimeout(timeout);
    try { ws.close(); } catch {}
  };
}

// ---------------------------------------------------------------------------
// Global Multi-Conversation / Project / Model / Heatmap Aggregation
// ---------------------------------------------------------------------------

const globalConvCache = new Map();

function formatLocalDayKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function fetchAllTrajectorySummaries() {
  const data = await callLanguageServer('GetAllCascadeTrajectories', {});
  return data?.trajectorySummaries || {};
}

async function parseSingleConversationForGlobal(convEntry, lsSummary, projectConfigMap) {
  if (lsSummary?.trajectoryType === 'CORTEX_TRAJECTORY_TYPE_SIDE_QUESTION') {
    return null;
  }
  const id = convEntry.id;
  const isRunning = lsSummary?.status === 'CASCADE_RUN_STATUS_RUNNING';
  const lsModMs = lsSummary?.lastModifiedTime ? new Date(lsSummary.lastModifiedTime).getTime() : 0;
  const effectiveUpdatedAtMs = Math.max(convEntry.updatedAtMs || 0, lsModMs || 0);

  const cached = globalConvCache.get(id);
  if (cached && !isRunning && cached.updatedAtMs >= effectiveUpdatedAtMs && cached.data.turns.length > 0) {
    return cached.data;
  }

  let trajResp = null;
  try {
    trajResp = await fetchCascadeTrajectory(id);
  } catch {
    trajResp = null;
  }

  const trajectory = trajResp?.trajectory || {};
  const meta = trajectory.metadata || lsSummary?.trajectoryMetadata || {};
  const gmList = Array.isArray(trajectory.generatorMetadata) ? trajectory.generatorMetadata : [];
  const steps = Array.isArray(trajectory.steps) ? trajectory.steps : [];

  const projectInfo = extractProjectInfo(meta, projectConfigMap);
  const parentConversationId = meta?.parentConversationId || null;
  const fallbackCreatedAt = meta?.createdAt || lsSummary?.createdTime || null;

  let lastPlannerModel = '';
  const turns = [];

  if (gmList.length > 0) {
    for (let i = 0; i < gmList.length; i++) {
      const gm = gmList[i];
      if (gm?.plannerConfig?.modelName) {
        lastPlannerModel = gm.plannerConfig.modelName;
      }
      const chatModel = gm?.chatModel;
      if (!chatModel || !chatModel.usage) continue;

      const u = chatModel.usage;
      const inputTokens = Number(u.inputTokens || 0);
      const cacheReadTokens = Number(u.cacheReadTokens || 0);
      const totalInputTokens = inputTokens + cacheReadTokens;
      const outputTokens = Number(u.outputTokens || 0);
      const thinkingTokens = Number(u.thinkingOutputTokens || 0);
      const responseTokens = Number(
        u.responseOutputTokens || Math.max(0, outputTokens - thinkingTokens)
      );
      const netTokens = inputTokens + outputTokens;
      const grossTokens = totalInputTokens + outputTokens;

      const ttftSec = parseProtoDurationSec(chatModel.timeToFirstToken);
      const streamSec = parseProtoDurationSec(chatModel.streamingDuration);
      const totalSec = ttftSec + streamSec;

      const modelInfo = normalizeModelInfo(
        chatModel.responseModel,
        u.model,
        gm?.plannerConfig?.modelName || lastPlannerModel
      );

      let ts = null;
      if (Array.isArray(gm.stepIndices)) {
        for (const sIdx of gm.stepIndices) {
          if (steps[sIdx]?.metadata?.createdAt) {
            ts = steps[sIdx].metadata.createdAt;
            break;
          }
        }
      }
      if (!ts) ts = fallbackCreatedAt;

      turns.push({
        modelId: modelInfo.id,
        modelName: modelInfo.name,
        provider: modelInfo.provider,
        inputTokens,
        cacheReadTokens,
        totalInputTokens,
        outputTokens,
        thinkingTokens,
        responseTokens,
        netTokens,
        grossTokens,
        totalTokens: grossTokens,
        ttftSec,
        streamSec,
        totalSec,
        timestamp: ts,
      });
    }
  } else {
    const fb = buildMetricsFromTranscriptFile(id, convEntry.title);
    if (fb && Array.isArray(fb.turns)) {
      for (const t of fb.turns) {
        const netTokens = t.inputTokens + t.outputTokens;
        const grossTokens = t.totalInputTokens + t.outputTokens;
        turns.push({
          modelId: 'gemini-3.8-flash',
          modelName: 'Gemini 3.8 Flash',
          provider: 'Google',
          inputTokens: t.inputTokens,
          cacheReadTokens: t.cacheReadTokens,
          totalInputTokens: t.totalInputTokens,
          outputTokens: t.outputTokens,
          thinkingTokens: t.thinkingTokens,
          responseTokens: t.responseTokens,
          netTokens,
          grossTokens,
          totalTokens: grossTokens,
          ttftSec: 0,
          streamSec: 0,
          totalSec: 0,
          timestamp: t.createdAt || fallbackCreatedAt,
        });
      }
    }
  }

  const rawTitle =
    lsSummary?.annotations?.title ||
    lsSummary?.summary ||
    convEntry.rawTitle ||
    '';

  const parsed = {
    id,
    rawTitle,
    title: rawTitle || convEntry.title || `会话 ${id.slice(0, 8)}`,
    parentConversationId,
    isSubagent: Boolean(parentConversationId),
    projectInfo,
    updatedAtMs: effectiveUpdatedAtMs,
    createdAt: fallbackCreatedAt,
    turns,
  };

  if (!isRunning && turns.length > 0) {
    globalConvCache.set(id, { updatedAtMs: effectiveUpdatedAtMs, data: parsed });
  }
  return parsed;
}

async function buildGlobalMetrics() {
  const projectConfigMap = loadProjectsConfigMap();
  const convList = listConversations();
  const lsSummaries = await fetchAllTrajectorySummaries();

  const convMap = new Map();
  for (const c of convList) {
    convMap.set(c.id, c);
  }
  for (const [id, sum] of Object.entries(lsSummaries)) {
    if (sum?.trajectoryType === 'CORTEX_TRAJECTORY_TYPE_SIDE_QUESTION') {
      continue;
    }
    if (!convMap.has(id)) {
      const modMs = sum?.lastModifiedTime ? new Date(sum.lastModifiedTime).getTime() : Date.now();
      const rawTitle = sum?.annotations?.title || sum?.summary || '';
      convMap.set(id, {
        id,
        rawTitle,
        title: rawTitle || `会话 ${id.slice(0, 8)}`,
        updatedAtMs: modMs,
      });
    }
  }

  const allEntries = Array.from(convMap.values());
  const parsedConvs = await Promise.all(
    allEntries.map((entry) =>
      parseSingleConversationForGlobal(entry, lsSummaries[entry.id], projectConfigMap)
    )
  );

  // Filter out side-question nulls and empty trajectories with 0 turns
  const activeConvs = parsedConvs.filter((c) => c && c.turns && c.turns.length > 0);
  const byId = new Map(activeConvs.map((c) => [c.id, c]));

  // Resolve human-friendly titles for subagent trajectories
  for (const c of activeConvs) {
    if (c.isSubagent && (!c.rawTitle || c.title.startsWith('会话 '))) {
      const parent = byId.get(c.parentConversationId);
      const parentName = parent?.rawTitle || parent?.title || c.parentConversationId.slice(0, 8);
      c.title = `[子Agent] ${parentName}`;
    }
  }

  let globalNetTokens = 0;
  let globalGrossTokens = 0;
  let globalUncachedInput = 0;
  let globalCacheRead = 0;
  let globalOutput = 0;
  let globalThinking = 0;
  let globalResponse = 0;
  let globalTurns = 0;
  let globalSpeedNumer = 0;
  let globalSpeedDenom = 0;
  let globalTtftSum = 0;
  let globalTtftCount = 0;

  const projectMap = new Map();
  const modelMap = new Map();
  const dayMap = new Map();
  const hourBuckets = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, '0')}:00`,
    netTokens: 0,
    grossTokens: 0,
    totalTokens: 0,
    outputTokens: 0,
    turnsCount: 0,
  }));

  const convSummaries = [];

  for (const c of activeConvs) {
    let convNet = 0;
    let convGross = 0;
    let convUncached = 0;
    let convCache = 0;
    let convOutput = 0;
    let convThinking = 0;
    let convResponse = 0;
    let convSpeedNumer = 0;
    let convSpeedDenom = 0;
    const convModelCounts = new Map();

    const pKey = c.projectInfo.key;
    if (!projectMap.has(pKey)) {
      projectMap.set(pKey, {
        key: c.projectInfo.key,
        name: c.projectInfo.name,
        isOutside: c.projectInfo.isOutside,
        subtitle: c.projectInfo.subtitle,
        conversationsCount: 0,
        subagentsCount: 0,
        turnsCount: 0,
        netTokens: 0,
        grossTokens: 0,
        totalTokens: 0,
        uncachedInputTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        responseTokens: 0,
        speedNumer: 0,
        speedDenom: 0,
        conversations: [],
      });
    }
    const proj = projectMap.get(pKey);
    if (c.isSubagent) {
      proj.subagentsCount += 1;
    } else {
      proj.conversationsCount += 1;
    }

    const seenModelsInConv = new Set();

    for (const t of c.turns) {
      const net = t.netTokens || (t.inputTokens + t.outputTokens);
      const gross = t.grossTokens || (t.totalInputTokens + t.outputTokens);

      globalTurns += 1;
      globalNetTokens += net;
      globalGrossTokens += gross;
      globalUncachedInput += t.inputTokens;
      globalCacheRead += t.cacheReadTokens;
      globalOutput += t.outputTokens;
      globalThinking += t.thinkingTokens;
      globalResponse += t.responseTokens;

      convNet += net;
      convGross += gross;
      convUncached += t.inputTokens;
      convCache += t.cacheReadTokens;
      convOutput += t.outputTokens;
      convThinking += t.thinkingTokens;
      convResponse += t.responseTokens;

      if (t.totalSec > 0.05 && t.outputTokens > 0) {
        globalSpeedNumer += t.outputTokens;
        globalSpeedDenom += t.totalSec;
        convSpeedNumer += t.outputTokens;
        convSpeedDenom += t.totalSec;
        proj.speedNumer += t.outputTokens;
        proj.speedDenom += t.totalSec;
      }
      if (t.ttftSec > 0.01) {
        globalTtftSum += t.ttftSec;
        globalTtftCount += 1;
      }

      proj.turnsCount += 1;
      proj.netTokens += net;
      proj.grossTokens += gross;
      proj.totalTokens += gross;
      proj.uncachedInputTokens += t.inputTokens;
      proj.cacheReadTokens += t.cacheReadTokens;
      proj.outputTokens += t.outputTokens;
      proj.thinkingTokens += t.thinkingTokens;
      proj.responseTokens += t.responseTokens;

      // Model aggregation
      if (!modelMap.has(t.modelId)) {
        modelMap.set(t.modelId, {
          id: t.modelId,
          name: t.modelName,
          provider: t.provider,
          turnsCount: 0,
          conversationsCount: 0,
          netTokens: 0,
          grossTokens: 0,
          totalTokens: 0,
          uncachedInputTokens: 0,
          cacheReadTokens: 0,
          outputTokens: 0,
          thinkingTokens: 0,
          responseTokens: 0,
          speedNumer: 0,
          speedDenom: 0,
          ttftSum: 0,
          ttftCount: 0,
        });
      }
      const mod = modelMap.get(t.modelId);
      mod.turnsCount += 1;
      mod.netTokens += net;
      mod.grossTokens += gross;
      mod.totalTokens += gross;
      mod.uncachedInputTokens += t.inputTokens;
      mod.cacheReadTokens += t.cacheReadTokens;
      mod.outputTokens += t.outputTokens;
      mod.thinkingTokens += t.thinkingTokens;
      mod.responseTokens += t.responseTokens;
      if (t.totalSec > 0.05 && t.outputTokens > 0) {
        mod.speedNumer += t.outputTokens;
        mod.speedDenom += t.totalSec;
      }
      if (t.ttftSec > 0.01) {
        mod.ttftSum += t.ttftSec;
        mod.ttftCount += 1;
      }
      seenModelsInConv.add(t.modelId);
      convModelCounts.set(t.modelName, (convModelCounts.get(t.modelName) || 0) + 1);

      // Date & Hour Heatmap aggregation
      if (t.timestamp) {
        const dt = new Date(t.timestamp);
        if (!Number.isNaN(dt.getTime())) {
          const dayKey = formatLocalDayKey(dt);
          if (!dayMap.has(dayKey)) {
            dayMap.set(dayKey, {
              date: dayKey,
              netTokens: 0,
              grossTokens: 0,
              totalTokens: 0,
              outputTokens: 0,
              turnsCount: 0,
            });
          }
          const dEntry = dayMap.get(dayKey);
          dEntry.netTokens += net;
          dEntry.grossTokens += gross;
          dEntry.totalTokens += gross;
          dEntry.outputTokens += t.outputTokens;
          dEntry.turnsCount += 1;

          const hr = dt.getHours();
          if (hourBuckets[hr]) {
            hourBuckets[hr].netTokens += net;
            hourBuckets[hr].grossTokens += gross;
            hourBuckets[hr].totalTokens += gross;
            hourBuckets[hr].outputTokens += t.outputTokens;
            hourBuckets[hr].turnsCount += 1;
          }
        }
      }
    }

    for (const mId of seenModelsInConv) {
      const mod = modelMap.get(mId);
      if (mod) mod.conversationsCount += 1;
    }

    let primaryModel = 'Gemini 3.8 Flash';
    let bestCount = -1;
    for (const [mName, cnt] of convModelCounts.entries()) {
      if (cnt > bestCount) {
        bestCount = cnt;
        primaryModel = mName;
      }
    }

    const convTotalIn = convUncached + convCache;
    const convSummary = {
      id: c.id,
      title: c.title,
      isSubagent: c.isSubagent,
      projectName: c.projectInfo.name,
      isOutsideProject: c.projectInfo.isOutside,
      primaryModel,
      turnsCount: c.turns.length,
      netTokens: convNet,
      grossTokens: convGross,
      totalTokens: convGross,
      uncachedInputTokens: convUncached,
      cacheReadTokens: convCache,
      outputTokens: convOutput,
      thinkingTokens: convThinking,
      responseTokens: convResponse,
      cacheHitRate: convTotalIn > 0 ? Number(((convCache / convTotalIn) * 100).toFixed(1)) : 0,
      avgTokPerSec: convSpeedDenom > 0 ? Number((convSpeedNumer / convSpeedDenom).toFixed(1)) : 0,
      updatedAtMs: c.updatedAtMs,
    };

    proj.conversations.push(convSummary);
    convSummaries.push(convSummary);
  }

  const globalTotalInput = globalUncachedInput + globalCacheRead;
  const globalCacheHitRate =
    globalTotalInput > 0 ? Number(((globalCacheRead / globalTotalInput) * 100).toFixed(1)) : 0;
  const globalAvgSpeed =
    globalSpeedDenom > 0 ? Number((globalSpeedNumer / globalSpeedDenom).toFixed(1)) : 0;
  const globalAvgTtft =
    globalTtftCount > 0 ? Number((globalTtftSum / globalTtftCount).toFixed(2)) : 0;

  // Finalize Projects list
  const projects = Array.from(projectMap.values())
    .map((p) => {
      const pTotalIn = p.uncachedInputTokens + p.cacheReadTokens;
      p.conversations.sort((a, b) => b.netTokens - a.netTokens);
      return {
        key: p.key,
        name: p.name,
        isOutside: p.isOutside,
        subtitle: p.subtitle,
        conversationsCount: p.conversationsCount,
        subagentsCount: p.subagentsCount,
        totalSessionsCount: p.conversationsCount + p.subagentsCount,
        turnsCount: p.turnsCount,
        netTokens: p.netTokens,
        grossTokens: p.grossTokens,
        totalTokens: p.grossTokens,
        uncachedInputTokens: p.uncachedInputTokens,
        cacheReadTokens: p.cacheReadTokens,
        outputTokens: p.outputTokens,
        thinkingTokens: p.thinkingTokens,
        responseTokens: p.responseTokens,
        sharePct: globalGrossTokens > 0 ? Number(((p.grossTokens / globalGrossTokens) * 100).toFixed(1)) : 0,
        netSharePct: globalNetTokens > 0 ? Number(((p.netTokens / globalNetTokens) * 100).toFixed(1)) : 0,
        cacheHitRate: pTotalIn > 0 ? Number(((p.cacheReadTokens / pTotalIn) * 100).toFixed(1)) : 0,
        avgTokPerSec: p.speedDenom > 0 ? Number((p.speedNumer / p.speedDenom).toFixed(1)) : 0,
        conversations: p.conversations,
      };
    })
    .sort((a, b) => b.netTokens - a.netTokens);

  // Finalize Models list
  const models = Array.from(modelMap.values())
    .map((m) => {
      const mTotalIn = m.uncachedInputTokens + m.cacheReadTokens;
      return {
        id: m.id,
        name: m.name,
        provider: m.provider,
        turnsCount: m.turnsCount,
        conversationsCount: m.conversationsCount,
        netTokens: m.netTokens,
        grossTokens: m.grossTokens,
        totalTokens: m.grossTokens,
        uncachedInputTokens: m.uncachedInputTokens,
        cacheReadTokens: m.cacheReadTokens,
        outputTokens: m.outputTokens,
        thinkingTokens: m.thinkingTokens,
        responseTokens: m.responseTokens,
        sharePct: globalGrossTokens > 0 ? Number(((m.grossTokens / globalGrossTokens) * 100).toFixed(1)) : 0,
        netSharePct: globalNetTokens > 0 ? Number(((m.netTokens / globalNetTokens) * 100).toFixed(1)) : 0,
        cacheHitRate: mTotalIn > 0 ? Number(((m.cacheReadTokens / mTotalIn) * 100).toFixed(1)) : 0,
        avgTokPerSec: m.speedDenom > 0 ? Number((m.speedNumer / m.speedDenom).toFixed(1)) : 0,
        avgTtftSec: m.ttftCount > 0 ? Number((m.ttftSum / m.ttftCount).toFixed(2)) : 0,
        thinkingRatioPct:
          m.outputTokens > 0 ? Number(((m.thinkingTokens / m.outputTokens) * 100).toFixed(1)) : 0,
      };
    })
    .sort((a, b) => b.netTokens - a.netTokens);

  // Finalize Daily Activity Heatmap (last 28 days ending today)
  const now = new Date();
  const todayKey = formatLocalDayKey(now);
  let maxDayNetTokens = 0;
  let maxDayGrossTokens = 0;
  for (const d of dayMap.values()) {
    if (d.netTokens > maxDayNetTokens) maxDayNetTokens = d.netTokens;
    if (d.grossTokens > maxDayGrossTokens) maxDayGrossTokens = d.grossTokens;
  }

  const dailyCells = [];
  for (let offset = 27; offset >= 0; offset--) {
    const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const key = formatLocalDayKey(dt);
    const stat = dayMap.get(key) || { date: key, netTokens: 0, grossTokens: 0, totalTokens: 0, outputTokens: 0, turnsCount: 0 };
    const ratio = maxDayNetTokens > 0 ? stat.netTokens / maxDayNetTokens : 0;
    const level =
      stat.netTokens <= 0 ? 0 : ratio <= 0.25 ? 1 : ratio <= 0.5 ? 2 : ratio <= 0.75 ? 3 : 4;
    dailyCells.push({
      date: key,
      label: `${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`,
      weekday: dt.getDay(),
      isToday: key === todayKey,
      netTokens: stat.netTokens,
      grossTokens: stat.grossTokens,
      totalTokens: stat.grossTokens,
      outputTokens: stat.outputTokens,
      turnsCount: stat.turnsCount,
      level,
    });
  }

  const activeDaysList = Array.from(dayMap.values()).sort((a, b) => b.date.localeCompare(a.date));
  let peakDay = null;
  for (const d of activeDaysList) {
    if (!peakDay || d.netTokens > peakDay.netTokens) {
      peakDay = d;
    }
  }
  const todayStat = dayMap.get(todayKey) || { date: todayKey, netTokens: 0, grossTokens: 0, totalTokens: 0, outputTokens: 0, turnsCount: 0 };

  // Finalize 24-Hour Activity Heatmap
  let maxHourNetTokens = 0;
  let peakHour = null;
  for (const h of hourBuckets) {
    if (h.netTokens > maxHourNetTokens) maxHourNetTokens = h.netTokens;
    if (!peakHour || h.netTokens > peakHour.netTokens) peakHour = h;
  }
  const hourlyCells = hourBuckets.map((h) => {
    const ratio = maxHourNetTokens > 0 ? h.netTokens / maxHourNetTokens : 0;
    const level =
      h.netTokens <= 0 ? 0 : ratio <= 0.25 ? 1 : ratio <= 0.5 ? 2 : ratio <= 0.75 ? 3 : 4;
    return {
      ...h,
      pctOfPeak: Math.round(ratio * 100),
      level,
    };
  });

  const topLevelCount = activeConvs.filter((c) => !c.isSubagent).length;
  const subagentsCount = activeConvs.filter((c) => c.isSubagent).length;

  convSummaries.sort((a, b) => b.netTokens - a.netTokens);

  return {
    totals: {
      netTokens: globalNetTokens,
      grossTokens: globalGrossTokens,
      totalTokens: globalNetTokens, // default to netTokens for user clarity!
      totalInputTokens: globalTotalInput,
      uncachedInputTokens: globalUncachedInput,
      cacheReadTokens: globalCacheRead,
      outputTokens: globalOutput,
      thinkingTokens: globalThinking,
      responseTokens: globalResponse,
      cacheHitRate: globalCacheHitRate,
      avgTokPerSec: globalAvgSpeed,
      avgTtftSec: globalAvgTtft,
      totalGenerationSec: Math.round(globalSpeedDenom),
      conversationsCount: topLevelCount,
      subagentsCount,
      totalTrajectoriesCount: activeConvs.length,
      totalTurns: globalTurns,
      activeDaysCount: activeDaysList.length,
    },
    projects,
    models,
    heatmap: {
      daily: {
        cells: dailyCells,
        activeDays: activeDaysList,
        peakDay,
        today: todayStat,
        activeDaysCount: activeDaysList.length,
      },
      hourly: {
        cells: hourlyCells,
        peakHour: peakHour && peakHour.netTokens > 0 ? peakHour : null,
      },
    },
    topConversations: convSummaries.slice(0, 15),
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Routes & Startup
// ---------------------------------------------------------------------------

app.page('/', () => readLocal('index.html'));
app.page('/app.js', () => readLocal('app.js'));
app.api('/styles.css', () => new Response(readLocal('styles.css'), { contentType: 'text/css; charset=utf-8' }), 'GET');

app.api('/api/conversations', async () => {
  const conversations = listConversations().slice(0, 25);
  return jsonWithCors({ conversations });
}, 'GET');

app.api('/api/global-metrics', async () => {
  try {
    const data = await buildGlobalMetrics();
    return jsonWithCors(data);
  } catch (err) {
    console.error('buildGlobalMetrics failed:', err);
    return jsonWithCors({ error: `加载全局统计失败: ${err.message}` }, 500);
  }
}, 'GET');

app.api('/api/metrics', async (data) => {
  const conversations = listConversations();
  let targetId = data?.conversationId;
  if (!targetId || targetId === 'auto' || targetId === 'null' || targetId === 'undefined') {
    targetId = conversations[0]?.id || process.env.ANTIGRAVITY_CONVERSATION_ID || '';
  }

  if (!targetId) {
    return jsonWithCors({ error: '未找到活跃会话' }, 404);
  }

  const convMeta = conversations.find((c) => c.id === targetId);
  const title = convMeta?.title || `会话 ${targetId.slice(0, 8)}`;

  try {
    const trajResp = await fetchCascadeTrajectory(targetId);
    if (trajResp && trajResp.trajectory) {
      return jsonWithCors(buildMetricsFromTrajectory(targetId, trajResp, title));
    }
  } catch (err) {
    console.error('LS GetCascadeTrajectory failed, falling back to transcript:', err.message);
  }

  const fallback = buildMetricsFromTranscriptFile(targetId, title);
  if (fallback) {
    return jsonWithCors(fallback);
  }

  return jsonWithCors({ error: `无法加载会话 ${targetId} 的监控数据` }, 404);
}, 'GET');

function archivePluginSidecarProjects() {
  try {
    const projectsDir = join(homedir(), '.gemini', 'config', 'projects');
    if (!existsSync(projectsDir)) return;
    const hiddenNames = new Set(['custom-persona/persona-editor', 'token-monitor/monitor']);
    for (const file of readdirSync(projectsDir)) {
      if (!file.endsWith('.json')) continue;
      const fullPath = join(projectsDir, file);
      try {
        const parsed = JSON.parse(readFileSync(fullPath, 'utf8'));
        if (parsed && hiddenNames.has(parsed.name) && parsed.archived !== true) {
          parsed.archived = true;
          writeFileSync(fullPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
        }
      } catch {}
    }
  } catch {}
}

app.run().then(() => {
  archivePluginSidecarProjects();
  injectInlineBarViaCdp();
  setInterval(() => {
    archivePluginSidecarProjects();
    injectInlineBarViaCdp();
  }, 3000);
});
