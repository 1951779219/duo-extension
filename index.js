import {
    eventSource,
    event_types,
    extension_prompt_roles,
    extension_prompt_types,
    generateRaw,
    getRequestHeaders,
    saveSettingsDebounced,
    setExtensionPrompt,
} from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';

const MODULE_NAME = 'duo';
const INJECT_KEY = 'duo_capsule';
const UI_ID = 'duo_settings';
const STATUS_ID = 'duo_status';
const OUTPUT_ID = 'duo_output';
const RESULTS_ID = 'duo_results';
const SETTINGS_VERSION = 4;
const ALLOWED_GENERATION_TYPES = new Set(['normal', 'continue', 'regenerate', 'swipe', 'impersonate']);

const DEFAULT_SETTINGS = Object.freeze({
    settingsVersion: SETTINGS_VERSION,
    enabled: true,
    autoBeforeGeneration: true,
    injectAfterManualRun: true,
    searchProvider: 'duckduckgo_html',
    searxngBaseUrl: 'https://searx.be',
    maxResults: 8,
    visitTopResults: 0,
    visitMaxChars: 4000,
    cacheTtlMinutes: 60,
    orchestrationMode: 'fast',
    maxConcurrentAgents: 3,
    responseLength: 420,
    synthResponseLength: 720,
    agentApi: 'current',
    agentApiPresetName: '',
    maxRecentMessages: 14,
    includeSearchInOrchestration: true,
    autoSearchPolicy: 'when_requested',
    injectionDepth: 0,
    injectionRole: extension_prompt_roles.SYSTEM,
});

const SEARCH_TRIGGERS = [
    '搜索',
    '联网',
    '查一下',
    '查一查',
    '查找',
    '检索',
    '搜一下',
    '上网查',
    '网上查',
    '最新',
    '今天',
    '现在',
    '新闻',
    '资料',
    '资料库',
    '现实',
    '事实',
    '真实',
    '出处',
    '来源',
    'web',
    'search',
    'google',
    'latest',
    'today',
    'news',
];

const SEARCH_PREFIX_PATTERN = /^\s*(?:请|帮我|麻烦(?:你)?|可以(?:帮我)?)?\s*(?:联网搜索|联网查|上网查|网上查|搜索|搜一下|搜搜|查一下|查一查|查找|检索|google|web\s*search|search)\s*(?:一下)?[：:，,\s]*(.+)$/i;
const SLASH_SEARCH_PATTERN = /^\s*\/(?:web|search)\s+(.+)$/i;

const AGENTS = Object.freeze({
    single: {
        label: '总编',
        system: '你是一个速度优先的 SillyTavern 剧情总编。基于聊天上下文，直接给出下一轮回复前应该注入的简短剧情指导。避免长篇分析。',
        task: '整合连续性、角色动机、场景推进和潜台词，输出可直接交给主模型遵循的剧情 capsule。',
    },
    continuity: {
        label: '连续性',
        system: '你是剧情连续性审校。你只关注已经发生的事实、承诺、未解决线索和不能打破的设定。',
        task: '列出下一轮最重要的连续性约束、必须承接的线索、不能突然改变的人物状态。',
    },
    character: {
        label: '角色',
        system: '你是角色动机和对白顾问。你只关注人物当下欲望、情绪、关系张力和说话方式。',
        task: '给出下一轮每个关键角色的动机、情绪方向、可用的对白/动作倾向，保持简洁。',
    },
    plot: {
        label: '剧情',
        system: '你是剧情推进规划师。你擅长把当前聊天推进成一个有钩子、有选择、有余味的下一拍。',
        task: '提出下一轮的剧情推进 beat、冲突升级或信息揭示，并说明应避免的无效推进。',
    },
    research: {
        label: '资料',
        system: '你是资料落地顾问。你只把搜索资料中可靠、对当前剧情有用的信息转为创作约束。',
        task: '从搜索结果里提取可以用于当前剧情的事实、术语、地点、风格细节；没有资料时明确说无外部资料。',
    },
    editor: {
        label: '节奏',
        system: '你是场景节奏编辑。你关注回复长度、信息密度、悬念位置和玩家可回应空间。',
        task: '给出下一轮回复的节奏建议：哪里收束、哪里留白、哪里制造选择。',
    },
});

const EXTRA_AGENTS = Object.freeze({
    intent: {
        label: '意图',
        system: '你是玩家意图分析员。你只判断用户这句话真正想让剧情往哪里走、希望 AI 做什么，以及哪些内容不该误读。',
        task: '提取本轮用户输入里的显性请求、隐性偏好、语气方向和必须避免的误解。保持短句。',
    },
    lore: {
        label: '设定',
        system: '你是世界观和设定顾问。你只关注地点、规则、组织、物品、能力和背景逻辑是否自洽。',
        task: '列出当前剧情必须尊重的设定规则、可继续利用的世界观细节，以及可能冲突的地方。',
    },
    realism: {
        label: '真实感',
        system: '你是真实感顾问。你把场景里的行动、反应、常识和现实细节校准得更可信，但不压扁戏剧性。',
        task: '给出让下一轮回复更自然可信的行动细节、感官细节、时间/空间约束和常识提醒。',
    },
    critic: {
        label: '质检',
        system: '你是剧情质检审校。你寻找下一轮最容易出问题的地方：跑题、重复、过度代写、忘记玩家可行动空间。',
        task: '列出下一轮回复需要避开的 3-5 个风险，并给出对应的简短修正方向。',
    },
    style: {
        label: '文风',
        system: '你是文风顾问。你负责让下一轮回复的语气、节奏、意象和对白质感贴合当前聊天。',
        task: '概括下一轮适合使用的文风、语气、意象和句式倾向，不要写完整正文。',
    },
});

const AGENT_API_OPTIONS = Object.freeze({
    current: '当前主 API',
    openai: 'OpenAI / 兼容',
    textgenerationwebui: 'TextGen WebUI',
    kobold: 'Kobold',
    koboldhorde: 'Kobold Horde',
    novel: 'NovelAI',
});

const MODE_AGENTS = Object.freeze({
    single: ['single'],
    fast: ['continuity', 'character', 'plot'],
    director: ['intent', 'continuity', 'character', 'plot', 'editor'],
    creative: ['character', 'plot', 'style', 'editor'],
    research: ['research', 'continuity', 'plot', 'critic'],
    quality: ['intent', 'continuity', 'lore', 'realism', 'critic'],
    audit: ['continuity', 'lore', 'realism', 'critic'],
    balanced: ['intent', 'continuity', 'character', 'plot', 'research'],
    deep: ['intent', 'continuity', 'character', 'plot', 'research', 'lore', 'realism', 'style', 'critic', 'editor'],
});

function getAgentDefinition(agentId) {
    return AGENTS[agentId] || EXTRA_AGENTS[agentId] || AGENTS.single;
}

function getAgentLabel(agentId) {
    return getAgentDefinition(agentId).label || agentId;
}

function getSelectedAgentApi(settings = getSettings()) {
    const api = String(settings.agentApi || DEFAULT_SETTINGS.agentApi).trim();
    if (api === 'current' && getSelectedAgentApiPresetName(settings)) {
        return 'openai';
    }
    return api && api !== 'current' ? api : null;
}

function getSelectedAgentApiPresetName(settings = getSettings()) {
    return String(settings.agentApiPresetName || '').trim();
}

function getAgentApiLabel(settings = getSettings()) {
    const api = String(settings.agentApi || DEFAULT_SETTINGS.agentApi).trim();
    return AGENT_API_OPTIONS[api] || api || AGENT_API_OPTIONS.current;
}

function getAgentRouteLabel(settings = getSettings()) {
    const presetName = getSelectedAgentApiPresetName(settings);
    if (presetName) {
        return `${getAgentApiLabel(settings)} / 连接配置：${presetName}`;
    }
    return getAgentApiLabel(settings);
}

function getConnectionProfileNames() {
    try {
        const profiles = getContext()?.connectionProfiles?.list?.();
        if (!Array.isArray(profiles)) {
            return [];
        }
        return [...new Set(profiles.map(profile => String(profile?.name || '').trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b));
    } catch (error) {
        console.debug('[Duo] Connection profile list unavailable:', error);
        return [];
    }
}

function renderConnectionProfileDatalist(selectedName = '') {
    const selected = String(selectedName || '').trim();
    const names = getConnectionProfileNames();
    const options = names.map(name => `<option value="${escapeHtml(name)}"></option>`);
    if (selected && !names.includes(selected)) {
        options.push(`<option value="${escapeHtml(selected)}"></option>`);
    }
    return options.join('');
}

async function generateDuoRaw(request, settings = getSettings()) {
    const apiPresetName = getSelectedAgentApiPresetName(settings);
    const context = getContext();
    if (apiPresetName && typeof context?.generateTask === 'function') {
        const taskMessages = [
            request.systemPrompt ? { role: 'system', content: String(request.systemPrompt) } : null,
            { role: 'user', content: String(request.prompt || '') },
        ].filter(Boolean);
        const result = await context.generateTask({
            taskMessages,
            includeCharacterCard: false,
            worldInfoSource: 'none',
            apiPresetName,
        });
        const text = normalizeWhitespace(result?.assistantText || '');
        if (!text) {
            throw new Error('No message generated');
        }
        return text;
    }
    return generateRaw(request);
}

const runtime = {
    running: false,
    hasPayloadHook: false,
    activeRunToast: null,
    runSteps: [],
    latestCapsule: '',
    latestResults: [],
    searchCache: new Map(),
    visitCache: new Map(),
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function getSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = {};
    }
    const settings = extension_settings[MODULE_NAME];
    const existingVersion = Number(settings.settingsVersion || 0);
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (settings[key] === undefined) {
            settings[key] = clone(value);
        }
    }
    migrateSettings(settings, existingVersion);
    return settings;
}

function saveSettings() {
    saveSettingsDebounced();
}

function migrateSettings(settings, version = Number(settings.settingsVersion || 0)) {
    if (version >= SETTINGS_VERSION) return;

    settings.enabled = true;
    settings.autoBeforeGeneration = true;
    settings.injectAfterManualRun = true;
    settings.searchProvider = settings.searchProvider || DEFAULT_SETTINGS.searchProvider;
    settings.maxResults = Math.max(1, Math.min(20, Number(settings.maxResults) || DEFAULT_SETTINGS.maxResults));
    settings.visitTopResults = Math.max(0, Math.min(3, Number(settings.visitTopResults) || DEFAULT_SETTINGS.visitTopResults));
    settings.visitMaxChars = Math.max(1000, Number(settings.visitMaxChars) || DEFAULT_SETTINGS.visitMaxChars);
    settings.cacheTtlMinutes = Math.max(5, Number(settings.cacheTtlMinutes) || DEFAULT_SETTINGS.cacheTtlMinutes);
    settings.orchestrationMode = settings.orchestrationMode || DEFAULT_SETTINGS.orchestrationMode;
    settings.maxConcurrentAgents = Math.max(1, Math.min(5, Number(settings.maxConcurrentAgents) || DEFAULT_SETTINGS.maxConcurrentAgents));
    settings.includeSearchInOrchestration = true;
    settings.autoSearchPolicy = settings.autoSearchPolicy || DEFAULT_SETTINGS.autoSearchPolicy;
    settings.agentApi = settings.agentApi || DEFAULT_SETTINGS.agentApi;
    settings.agentApiPresetName = settings.agentApiPresetName || DEFAULT_SETTINGS.agentApiPresetName;
    settings.settingsVersion = SETTINGS_VERSION;
    saveSettings();
}

function applyRecommendedDefaults() {
    const settings = getSettings();
    const searxngBaseUrl = settings.searxngBaseUrl || DEFAULT_SETTINGS.searxngBaseUrl;
    Object.assign(settings, clone(DEFAULT_SETTINGS), { searxngBaseUrl });
    syncSettingsUi();
    clearInjection();
    saveSettings();
    setStatus('已应用推荐默认：自动运行、按需搜索、Fast 并行。');
    notify('success', 'Duo 已切换到推荐默认配置。');
}

function notify(level, message) {
    if (globalThis.toastr?.[level]) {
        globalThis.toastr[level](message);
    } else {
        console[level === 'error' ? 'error' : 'log'](`[Duo] ${message}`);
    }
}

function setStatus(message) {
    $(`#${STATUS_ID}`).text(message || '');
}

function renderRunPanelHtml(title) {
    const rows = runtime.runSteps.map(step => `
        <div class="duo-extension-run-step duo-extension-run-step-${escapeHtml(step.state || 'todo')}">
            <b>${escapeHtml(step.label)}</b>
            ${step.detail ? `<span>${escapeHtml(step.detail)}</span>` : ''}
        </div>
    `).join('');
    return `
        <div class="duo-extension-run-panel">
            <div class="duo-extension-run-title">${escapeHtml(title || 'Duo 正在运行...')}</div>
            ${rows || '<div class="duo-extension-run-step">准备中...</div>'}
        </div>
    `;
}

function updateRunPanel(title, statusText = '') {
    setStatus(statusText || title || '');
    if (typeof toastr === 'undefined') {
        return;
    }
    const html = renderRunPanelHtml(title);
    if (!runtime.activeRunToast) {
        runtime.activeRunToast = toastr.info(html, '', {
            timeOut: 0,
            extendedTimeOut: 0,
            tapToDismiss: false,
            closeButton: true,
            progressBar: false,
            escapeHtml: false,
        });
        return;
    }
    runtime.activeRunToast?.find?.('.toast-message')?.html(html);
}

function beginRunPanel(title) {
    runtime.runSteps = [];
    updateRunPanel(title || 'Duo 正在运行...', title || 'Duo 正在运行...');
}

function setRunStep(id, label, state = 'running', detail = '') {
    const existing = runtime.runSteps.find(step => step.id === id);
    if (existing) {
        existing.label = label;
        existing.state = state;
        existing.detail = detail;
    } else {
        runtime.runSteps.push({ id, label, state, detail });
    }
    updateRunPanel('Duo 正在处理本轮输入...', `${label}${detail ? `：${detail}` : ''}`);
}

function finishRunPanel(message, ok = true) {
    updateRunPanel(ok ? 'Duo 已完成' : 'Duo 运行失败', message);
    if (typeof toastr !== 'undefined' && runtime.activeRunToast) {
        const toast = runtime.activeRunToast;
        window.setTimeout(() => {
            if (runtime.activeRunToast === toast) {
                toastr.clear(runtime.activeRunToast);
                runtime.activeRunToast = null;
            }
        }, ok ? 3500 : 7000);
    }
}

function clearRunPanel() {
    if (typeof toastr !== 'undefined' && runtime.activeRunToast) {
        toastr.clear(runtime.activeRunToast);
    }
    runtime.activeRunToast = null;
    runtime.runSteps = [];
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function normalizeWhitespace(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function stripHtmlToText(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    doc.querySelectorAll('script, style, noscript, svg, header, footer, nav, form').forEach(x => x.remove());
    return normalizeWhitespace(doc.body?.textContent || '');
}

function truncate(value, maxChars) {
    const text = String(value || '');
    const limit = Math.max(0, Number(maxChars) || 0);
    if (!limit || text.length <= limit) return text;
    return `${text.slice(0, limit).trim()}...`;
}

function normalizeMessageText(message) {
    return normalizeWhitespace(String(message?.mes || message?.content || '').replace(/<[^>]+>/g, ' '));
}

function getPayloadMessages(payload) {
    if (Array.isArray(payload?.coreChat) && payload.coreChat.length) {
        return payload.coreChat;
    }
    return null;
}

function getRecentChat(limit, payload = null) {
    const context = getContext();
    const chat = getPayloadMessages(payload) || (Array.isArray(context.chat) ? context.chat : []);
    return chat.slice(-Math.max(1, Number(limit) || 1))
        .map((message) => {
            const name = normalizeWhitespace(message?.name || (message?.is_user ? context.name1 : context.name2) || '');
            const text = normalizeMessageText(message);
            return `${name || 'Unknown'}: ${text}`;
        })
        .filter(line => line.trim().length > 1)
        .join('\n');
}

function getLatestUserMessage(payload = null) {
    const context = getContext();
    const chat = getPayloadMessages(payload) || (Array.isArray(context.chat) ? context.chat : []);
    for (let i = chat.length - 1; i >= 0; i -= 1) {
        if (chat[i]?.is_user) {
            return normalizeMessageText(chat[i]);
        }
    }
    return normalizeWhitespace($('#send_textarea').val() || '');
}

function shouldAutoSearch(text) {
    const lower = String(text || '').toLowerCase();
    return SEARCH_TRIGGERS.some(trigger => lower.includes(trigger.toLowerCase()));
}

function extractSearchQuery(text) {
    const source = normalizeWhitespace(text);
    if (!source) return '';

    const slashMatch = source.match(SLASH_SEARCH_PATTERN);
    if (slashMatch?.[1]) return normalizeSearchQuery(slashMatch[1], source);

    const prefixMatch = source.match(SEARCH_PREFIX_PATTERN);
    if (prefixMatch?.[1]) return normalizeSearchQuery(prefixMatch[1], source);

    return source;
}

function normalizeSearchQuery(candidate, fallback) {
    const cleaned = normalizeWhitespace(candidate)
        .replace(/^(一下|一下子|有关|关于|一下关于)\s*/i, '')
        .replace(/[？?。！!]+$/g, '')
        .trim();
    return cleaned.length >= 2 ? cleaned : fallback;
}

function makeCacheKey(parts) {
    return JSON.stringify(parts);
}

function readCache(cache, key) {
    const settings = getSettings();
    const ttlMs = Math.max(0, Number(settings.cacheTtlMinutes) || 0) * 60 * 1000;
    if (!ttlMs) return null;
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.time > ttlMs) {
        cache.delete(key);
        return null;
    }
    return clone(entry.value);
}

function writeCache(cache, key, value) {
    cache.set(key, { time: Date.now(), value: clone(value) });
}

async function postJson(url, body) {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            ...getRequestHeaders(),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body || {}),
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`${url} failed: ${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 160)}` : ''}`);
    }
    const contentType = String(response.headers.get('content-type') || '');
    return contentType.includes('application/json') ? response.json() : response.text();
}

async function fetchVisitedHtml(url) {
    return postJson('/api/search/visit', { url, html: true });
}

function resolveResultUrl(rawHref, baseUrl = 'https://duckduckgo.com') {
    let href = String(rawHref || '').trim();
    if (!href) return '';
    if (href.startsWith('//')) href = `https:${href}`;
    try {
        const parsed = new URL(href, baseUrl);
        if (parsed.hostname.endsWith('duckduckgo.com') && parsed.pathname === '/l/') {
            const target = parsed.searchParams.get('uddg');
            if (target) return decodeURIComponent(target);
        }
        return parsed.toString();
    } catch {
        return href;
    }
}

function normalizeResult(item) {
    const title = normalizeWhitespace(item?.title || item?.name || '');
    const url = normalizeWhitespace(item?.url || item?.link || item?.href || '');
    const snippet = normalizeWhitespace(item?.snippet || item?.content || item?.body || item?.description || '');
    if (!title || !url) return null;
    return { title, url, snippet };
}

function uniqueResults(items, maxResults) {
    const seen = new Set();
    const out = [];
    for (const item of Array.isArray(items) ? items : []) {
        const normalized = normalizeResult(item);
        if (!normalized) continue;
        const key = normalized.url.replace(/#.*$/, '');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(normalized);
        if (out.length >= maxResults) break;
    }
    return out;
}

function parseDuckDuckGoHtml(html, maxResults) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const containers = [...doc.querySelectorAll('.result, .web-result, article[data-testid="result"]')];
    const parsed = [];
    for (const container of containers) {
        const titleLink = container.querySelector('a.result__a, h2 a, [data-testid="result-title-a"]');
        if (!titleLink) continue;
        const title = normalizeWhitespace(titleLink.textContent);
        const rawUrl = container.querySelector('a.result__url, .result__extras__url a')?.getAttribute('href')
            || titleLink.getAttribute('href')
            || '';
        const url = resolveResultUrl(rawUrl);
        const snippet = normalizeWhitespace(container.querySelector('.result__snippet, [data-result="snippet"]')?.textContent || '');
        parsed.push({ title, url, snippet });
    }
    return uniqueResults(parsed, maxResults);
}

function parseSearxngHtml(html, baseUrl, maxResults) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const containers = [...doc.querySelectorAll('article.result, .result')];
    const parsed = [];
    for (const container of containers) {
        const titleLink = container.querySelector('h3 a, a.result_header, a.url_header, a[data-testid="result-title-a"]');
        if (!titleLink) continue;
        const title = normalizeWhitespace(titleLink.textContent);
        const rawUrl = titleLink.getAttribute('href') || '';
        const url = resolveResultUrl(rawUrl, baseUrl);
        const snippet = normalizeWhitespace(container.querySelector('p.content, .result-content, .result__snippet')?.textContent || '');
        parsed.push({ title, url, snippet });
    }
    return uniqueResults(parsed, maxResults);
}

function normalizeProviderJson(provider, data, maxResults) {
    let items = [];
    if (provider === 'serper') {
        items = Array.isArray(data?.organic) ? data.organic.map(x => ({ title: x.title, url: x.link, snippet: x.snippet })) : [];
    } else if (provider === 'tavily') {
        items = Array.isArray(data?.results) ? data.results.map(x => ({ title: x.title, url: x.url, snippet: x.content })) : [];
    } else if (provider === 'serpapi') {
        items = Array.isArray(data?.organic_results) ? data.organic_results.map(x => ({ title: x.title, url: x.link, snippet: x.snippet })) : [];
    } else if (provider === 'zai') {
        const raw = data?.search_result || data?.search_results || data?.results || data?.data?.results || [];
        items = Array.isArray(raw) ? raw.map(x => ({ title: x.title || x.name, url: x.url || x.link, snippet: x.snippet || x.content })) : [];
    }
    return uniqueResults(items, maxResults);
}

async function searchWeb(query, { force = false } = {}) {
    const settings = getSettings();
    const normalizedQuery = normalizeWhitespace(query);
    if (!normalizedQuery) return [];

    const cacheKey = makeCacheKey([
        settings.searchProvider,
        normalizedQuery,
        settings.searxngBaseUrl,
        settings.maxResults,
    ]);
    if (!force) {
        const cached = readCache(runtime.searchCache, cacheKey);
        if (cached) return cached;
    }

    const maxResults = Math.max(1, Math.min(20, Number(settings.maxResults) || 6));
    let results = [];

    if (settings.searchProvider === 'duckduckgo_html') {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(normalizedQuery)}`;
        const html = await fetchVisitedHtml(url);
        results = parseDuckDuckGoHtml(html, maxResults);
    } else if (settings.searchProvider === 'searxng') {
        const baseUrl = String(settings.searxngBaseUrl || '').replace(/\/+$/, '');
        if (!baseUrl) throw new Error('SearXNG base URL is empty.');
        const html = await postJson('/api/search/searxng', { baseUrl, query: normalizedQuery });
        results = parseSearxngHtml(html, baseUrl, maxResults);
    } else {
        const endpoint = `/api/search/${settings.searchProvider}`;
        const data = await postJson(endpoint, { query: normalizedQuery });
        results = normalizeProviderJson(settings.searchProvider, data, maxResults);
    }

    writeCache(runtime.searchCache, cacheKey, results);
    return results;
}

async function visitUrl(url, maxChars) {
    const normalizedUrl = normalizeWhitespace(url);
    if (!normalizedUrl) return '';
    const cacheKey = makeCacheKey([normalizedUrl, maxChars]);
    const cached = readCache(runtime.visitCache, cacheKey);
    if (cached) return cached;
    const html = await fetchVisitedHtml(normalizedUrl);
    const text = truncate(stripHtmlToText(html), maxChars);
    writeCache(runtime.visitCache, cacheKey, text);
    return text;
}

function renderResults(results) {
    runtime.latestResults = Array.isArray(results) ? results : [];
    const html = runtime.latestResults.length
        ? runtime.latestResults.map((result, index) => `
            <div class="duo-extension-result">
                <div class="duo-extension-result-title">${index + 1}. ${escapeHtml(result.title)}</div>
                <div class="duo-extension-result-url">${escapeHtml(result.url)}</div>
                ${result.snippet ? `<div>${escapeHtml(result.snippet)}</div>` : ''}
            </div>
        `).join('')
        : '<div class="duo-extension-muted">No results.</div>';
    $(`#${RESULTS_ID}`).html(html);
}

function renderOutput(text) {
    const value = String(text || '');
    runtime.latestCapsule = value;
    $(`#${OUTPUT_ID}`).text(value || 'No capsule yet.');
}

function buildSearchBrief(results, visitedPages) {
    const lines = [];
    if (Array.isArray(results) && results.length) {
        lines.push('## Search results');
        for (const [index, result] of results.entries()) {
            lines.push(`[${index + 1}] ${result.title}`);
            lines.push(`URL: ${result.url}`);
            if (result.snippet) lines.push(`Snippet: ${result.snippet}`);
            lines.push('');
        }
    }
    if (Array.isArray(visitedPages) && visitedPages.length) {
        lines.push('## Visited pages');
        for (const page of visitedPages) {
            lines.push(`URL: ${page.url}`);
            lines.push(page.text);
            lines.push('');
        }
    }
    return lines.join('\n').trim();
}

async function mapLimit(items, limit, worker) {
    const source = Array.isArray(items) ? items : [];
    const concurrency = Math.max(1, Math.min(source.length || 1, Number(limit) || 1));
    const results = new Array(source.length);
    let cursor = 0;

    async function next() {
        while (cursor < source.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await worker(source[index], index);
        }
    }

    await Promise.all(Array.from({ length: concurrency }, () => next()));
    return results;
}

function getSearchQueryForRun(source, latestUser = '') {
    const settings = getSettings();
    const manualQuery = normalizeWhitespace($('#duo_search_query').val());
    if (manualQuery) return manualQuery;
    const searchQuery = extractSearchQuery(latestUser);
    if (source === 'manual' && settings.autoSearchPolicy !== 'never') return searchQuery;
    if (settings.autoSearchPolicy === 'always') return searchQuery;
    if (settings.autoSearchPolicy === 'when_requested' && shouldAutoSearch(latestUser)) return searchQuery;
    return '';
}

async function collectSearchContext(source, latestUser = '') {
    const settings = getSettings();
    if (!settings.includeSearchInOrchestration) {
        setRunStep('search', '联网搜索', 'skipped', '已关闭');
        return { query: '', results: [], visitedPages: [], brief: '' };
    }
    const query = getSearchQueryForRun(source, latestUser);
    if (!query) {
        setRunStep('search', '联网搜索', 'skipped', '本轮未触发搜索');
        return { query: '', results: [], visitedPages: [], brief: '' };
    }

    setStatus(`Searching: ${query}`);
    setRunStep('search', '联网搜索', 'running', query);
    let results = [];
    try {
        results = await searchWeb(query);
    } catch (error) {
        console.warn('[Duo] search failed, continuing without web context:', error);
        setRunStep('search', '联网搜索', 'failed', '搜索失败，已跳过联网上下文');
        renderResults([]);
        return { query, results: [], visitedPages: [], brief: '' };
    }
    renderResults(results);
    setRunStep('search', '联网搜索', 'done', `找到 ${results.length} 条结果`);

    const visitCount = Math.max(0, Math.min(3, Number(settings.visitTopResults) || 0));
    const visitedPages = visitCount
        ? await mapLimit(results.slice(0, visitCount), Math.min(visitCount, 2), async result => ({
            url: result.url,
            text: await visitUrl(result.url, settings.visitMaxChars),
        }))
        : [];

    return {
        query,
        results,
        visitedPages,
        brief: buildSearchBrief(results, visitedPages),
    };
}

function buildAgentPrompt(agent, recentChat, latestUser, searchBrief) {
    return [
        '你正在帮助 SillyTavern 生成下一轮剧情指导。',
        '',
        '## Recent chat',
        recentChat || '(empty)',
        '',
        '## Latest user message',
        latestUser || '(empty)',
        '',
        searchBrief ? `## Web context\n${searchBrief}\n` : '## Web context\n(no external context)\n',
        '## Your task',
        agent.task,
        '',
        '输出要求：',
        '- 用中文。',
        '- 只输出给合成器使用的要点。',
        '- 尽量短，避免复述完整聊天。',
    ].join('\n');
}

async function runAgent(agentId, contextBlock, options = {}) {
    const settings = getSettings();
    const agent = getAgentDefinition(agentId);
    const prompt = buildAgentPrompt(agent, contextBlock.recentChat, contextBlock.latestUser, contextBlock.searchBrief);
    const request = {
        prompt,
        systemPrompt: agent.system,
        trimNames: false,
    };
    const api = getSelectedAgentApi(settings);
    if (api) {
        request.api = api;
    }
    const apiPresetName = getSelectedAgentApiPresetName(settings);
    if (apiPresetName) {
        request.apiPresetName = apiPresetName;
    }
    if (options.responseLength) {
        request.responseLength = Math.max(128, Number(options.responseLength) || 420);
    }
    const text = await generateDuoRaw(request, settings);
    return {
        id: agentId,
        label: agent.label,
        text: normalizeWhitespace(text),
    };
}

async function synthesizeCapsule(agentOutputs, contextBlock) {
    const settings = getSettings();
    const agentText = agentOutputs
        .map(output => `## ${output.label}\n${output.text || '(empty)'}`)
        .join('\n\n');
    const prompt = [
        '你是 SillyTavern 剧情合成器。请把多个 agent 的意见压缩成下一轮主模型可遵循的剧情 capsule。',
        '',
        '## Recent chat',
        contextBlock.recentChat || '(empty)',
        '',
        '## Latest user message',
        contextBlock.latestUser || '(empty)',
        '',
        contextBlock.searchBrief ? `## Web context\n${contextBlock.searchBrief}\n` : '',
        '## Agent outputs',
        agentText || '(empty)',
        '',
        '输出格式：',
        '1. 下一轮剧情目标：',
        '2. 角色/关系约束：',
        '3. 可用细节或伏笔：',
        '4. 避免事项：',
        '',
        '保持短而具体。不要替主模型写完整回复。',
    ].join('\n');

    const request = {
        prompt,
        systemPrompt: '你是剧情总编，负责把并行 agent 的意见压缩成短、清晰、可执行的 prompt 注入文本。',
        responseLength: Math.max(256, Number(settings.synthResponseLength) || 720),
        trimNames: false,
    };
    const api = getSelectedAgentApi(settings);
    if (api) {
        request.api = api;
    }
    const apiPresetName = getSelectedAgentApiPresetName(settings);
    if (apiPresetName) {
        request.apiPresetName = apiPresetName;
    }
    return generateDuoRaw(request, settings);
}

function injectCapsuleToPayload(payload, capsule) {
    if (!payload || typeof payload !== 'object') return false;
    const settings = getSettings();
    const text = normalizeWhitespace(capsule);
    if (!text) return false;
    const packet = `[Duo剧情协作]\n${text}`;
    const depth = Math.max(0, Math.min(100, Number(settings.injectionDepth) || 0));
    const role = Number.isFinite(Number(settings.injectionRole)) ? Number(settings.injectionRole) : extension_prompt_roles.SYSTEM;

    if (!Array.isArray(payload.worldInfoDepth)) {
        payload.worldInfoDepth = [];
    }
    let target = payload.worldInfoDepth.find(entry => (
        Math.max(0, Number(entry?.depth) || 0) === depth
        && Number(entry?.role) === role
    ));
    if (!target) {
        target = { depth, role, entries: [] };
        payload.worldInfoDepth.push(target);
    }
    if (!Array.isArray(target.entries)) {
        target.entries = [];
    }
    if (!target.entries.includes(packet)) {
        target.entries.push(packet);
    }
    return true;
}

function injectCapsule(capsule, payload = null) {
    const settings = getSettings();
    const text = normalizeWhitespace(capsule);
    if (!text) {
        setExtensionPrompt(INJECT_KEY, '', extension_prompt_types.NONE, 0);
        return;
    }
    if (injectCapsuleToPayload(payload, text)) {
        return;
    }
    const role = Number(settings.injectionRole);
    const depth = Math.max(0, Math.min(100, Number(settings.injectionDepth) || 0));
    setExtensionPrompt(
        INJECT_KEY,
        `[Duo剧情协作]\n${text}`,
        extension_prompt_types.IN_CHAT,
        depth,
        false,
        Number.isFinite(role) ? role : extension_prompt_roles.SYSTEM,
    );
}

function clearInjection() {
    setExtensionPrompt(INJECT_KEY, '', extension_prompt_types.NONE, 0);
}

async function runMultiAgent(source = 'manual', payload = null) {
    const settings = getSettings();
    if (!settings.enabled) {
        setStatus('Disabled.');
        return '';
    }
    if (runtime.running) {
        setStatus('Already running.');
        return runtime.latestCapsule;
    }

    runtime.running = true;
    try {
        beginRunPanel(source === 'auto' ? 'Duo 自动运行中...' : 'Duo 手动运行中...');
        const latestUser = getLatestUserMessage(payload);
        const recentChat = getRecentChat(settings.maxRecentMessages, payload);
        if (!latestUser && source === 'auto') {
            setRunStep('input', '读取当前输入', 'failed', '没有拿到本轮用户消息');
            finishRunPanel('Duo 未拿到本轮输入，已跳过。', false);
            return '';
        }
        setRunStep('input', '读取当前输入', 'done', truncate(latestUser, 80));
        const searchContext = await collectSearchContext(source, latestUser);
        const contextBlock = {
            latestUser,
            recentChat,
            searchBrief: searchContext.brief,
        };

        const agentIds = MODE_AGENTS[settings.orchestrationMode] || MODE_AGENTS.fast;
        const concurrency = Math.max(1, Math.min(5, Number(settings.maxConcurrentAgents) || 3));
        const agentLabels = agentIds.map(getAgentLabel).join(' / ');
        setStatus(`Running ${agentIds.length} agent(s)...`);
        setRunStep('agents', '多智能体运行', 'running', `${agentLabels}；路由：${getAgentRouteLabel(settings)}；并发 ${concurrency}`);
        const parallelAgents = agentIds.length > 1 && concurrency > 1;
        const agentResponseLength = parallelAgents ? null : settings.responseLength;
        const agentOutputs = await mapLimit(agentIds, concurrency, agentId => runAgent(agentId, contextBlock, {
            responseLength: agentResponseLength,
        }));
        setRunStep('agents', '多智能体运行', 'done', agentOutputs.map(output => output.label).join(' / '));

        let capsule = '';
        if (agentOutputs.length === 1) {
            capsule = normalizeWhitespace(agentOutputs[0].text);
        } else {
            setStatus('Synthesizing capsule...');
            setRunStep('synth', '合成剧情指导', 'running', '');
            capsule = normalizeWhitespace(await synthesizeCapsule(agentOutputs, contextBlock));
            setRunStep('synth', '合成剧情指导', 'done', `${capsule.length} 字符`);
        }
        renderOutput(capsule);

        if (source === 'auto' || settings.injectAfterManualRun) {
            injectCapsule(capsule, payload);
            setRunStep('inject', '注入本轮提示词', 'done', payload ? '已写入生成 payload' : '已写入扩展注入');
        }

        setStatus(source === 'auto' ? 'Auto capsule injected.' : 'Capsule ready.');
        finishRunPanel(source === 'auto' ? 'Duo 已自动注入本轮提示词。' : 'Duo 已生成并注入剧情指导。', true);
        return capsule;
    } catch (error) {
        console.error('[Duo] multi-agent run failed:', error);
        notify('error', `Duo failed: ${error.message || error}`);
        setRunStep('error', '运行失败', 'failed', String(error?.message || error));
        finishRunPanel(`Duo 运行失败：${error.message || error}`, false);
        setStatus('Failed.');
        return '';
    } finally {
        runtime.running = false;
    }
}

async function onManualSearch(force = true) {
    const query = normalizeWhitespace($('#duo_search_query').val()) || getLatestUserMessage();
    if (!query) {
        notify('warning', 'Search query is empty.');
        return;
    }
    try {
        beginRunPanel('Duo 正在搜索...');
        setStatus(`Searching: ${query}`);
        setRunStep('search', '联网搜索', 'running', query);
        const results = await searchWeb(query, { force });
        renderResults(results);
        setRunStep('search', '联网搜索', 'done', `找到 ${results.length} 条结果`);
        setStatus(`Found ${results.length} result(s).`);
        finishRunPanel(`搜索完成：${results.length} 条结果。`, true);
    } catch (error) {
        console.error('[Duo] search failed:', error);
        notify('error', `Search failed: ${error.message || error}`);
        setRunStep('search', '联网搜索', 'failed', String(error?.message || error));
        finishRunPanel(`搜索失败：${error.message || error}`, false);
        setStatus('Search failed.');
    }
}

function buildSettingsHtml() {
    return `
        <div id="${UI_ID}" class="duo-extension" data-extension-name="duo-extension">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Duo</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="duo-extension-row">
                        <label class="checkbox_label">
                            <input id="duo_enabled" type="checkbox">
                            <span>启用</span>
                        </label>
                        <label class="checkbox_label">
                            <input id="duo_auto_before_generation" type="checkbox">
                            <span>生成前自动运行</span>
                        </label>
                        <label class="checkbox_label">
                            <input id="duo_inject_after_manual_run" type="checkbox">
                            <span>手动运行后注入</span>
                        </label>
                    </div>

                    <div class="duo-extension-divider"></div>

                    <div class="duo-extension-grid">
                        <div class="duo-extension-field">
                            <label for="duo_search_provider">搜索源</label>
                            <select id="duo_search_provider">
                                <option value="duckduckgo_html">DuckDuckGo HTML</option>
                                <option value="searxng">SearXNG</option>
                                <option value="serper">Serper</option>
                                <option value="tavily">Tavily</option>
                                <option value="serpapi">SerpAPI</option>
                                <option value="zai">Z.AI</option>
                            </select>
                        </div>
                        <div class="duo-extension-field">
                            <label for="duo_searxng_base">SearXNG URL</label>
                            <input id="duo_searxng_base" type="text" spellcheck="false">
                        </div>
                        <div class="duo-extension-field">
                            <label for="duo_max_results">结果数</label>
                            <input id="duo_max_results" type="number" min="1" max="20" step="1">
                        </div>
                        <div class="duo-extension-field">
                            <label for="duo_visit_top_results">阅读全文数</label>
                            <input id="duo_visit_top_results" type="number" min="0" max="3" step="1">
                        </div>
                    </div>

                    <div class="duo-extension-row">
                        <input id="duo_search_query" type="text" placeholder="Search query">
                        <button id="duo_search_btn" class="menu_button" title="Search">
                            <i class="fa-solid fa-magnifying-glass"></i>
                            <span>搜索</span>
                        </button>
                    </div>
                    <div id="${RESULTS_ID}" class="duo-extension-results duo-extension-muted">No results.</div>

                    <div class="duo-extension-divider"></div>

                    <div class="duo-extension-grid">
                        <div class="duo-extension-field">
                            <label for="duo_orchestration_mode">Agent 模式</label>
                            <select id="duo_orchestration_mode">
                                <option value="single">Single - 单节点</option>
                                <option value="fast">Fast - 快速三节点</option>
                                <option value="director">Director - 导演组</option>
                                <option value="creative">Creative - 创作组</option>
                                <option value="research">Research - 搜索资料组</option>
                                <option value="quality">Quality - 质量组</option>
                                <option value="audit">Audit - 审校组</option>
                                <option value="balanced">Balanced - 平衡组</option>
                                <option value="deep">Deep - 全量组</option>
                            </select>
                        </div>
                        <div class="duo-extension-field">
                            <label for="duo_agent_api">Agent API</label>
                            <select id="duo_agent_api">
                                <option value="current">当前主 API</option>
                                <option value="openai">OpenAI / 兼容</option>
                                <option value="textgenerationwebui">TextGen WebUI</option>
                                <option value="kobold">Kobold</option>
                                <option value="koboldhorde">Kobold Horde</option>
                                <option value="novel">NovelAI</option>
                            </select>
                        </div>
                        <div class="duo-extension-field">
                            <label for="duo_agent_api_preset_name">连接配置</label>
                            <input id="duo_agent_api_preset_name" type="text" list="duo_agent_api_preset_names" placeholder="Luker profile name，空=当前">
                            <datalist id="duo_agent_api_preset_names">${renderConnectionProfileDatalist(getSettings().agentApiPresetName)}</datalist>
                        </div>
                        <div class="duo-extension-field">
                            <label for="duo_max_concurrent_agents">并发数</label>
                            <input id="duo_max_concurrent_agents" type="number" min="1" max="5" step="1">
                        </div>
                        <div class="duo-extension-field">
                            <label for="duo_response_length">Agent 长度</label>
                            <input id="duo_response_length" type="number" min="128" max="1200" step="32">
                        </div>
                        <div class="duo-extension-field">
                            <label for="duo_synth_response_length">合成长度</label>
                            <input id="duo_synth_response_length" type="number" min="256" max="1600" step="32">
                        </div>
                        <div class="duo-extension-field">
                            <label for="duo_auto_search_policy">自动搜索</label>
                            <select id="duo_auto_search_policy">
                                <option value="when_requested">When requested</option>
                                <option value="always">Always</option>
                                <option value="never">Never</option>
                            </select>
                        </div>
                        <div class="duo-extension-field">
                            <label for="duo_injection_depth">注入深度</label>
                            <input id="duo_injection_depth" type="number" min="0" max="100" step="1">
                        </div>
                    </div>

                    <div class="duo-extension-row">
                        <label class="checkbox_label">
                            <input id="duo_include_search_in_orchestration" type="checkbox">
                            <span>Agent 使用搜索结果</span>
                        </label>
                    </div>

                    <div class="duo-extension-actions">
                        <button id="duo_defaults_btn" class="menu_button" title="Apply recommended defaults">
                            <i class="fa-solid fa-wand-magic-sparkles"></i>
                            <span>推荐默认</span>
                        </button>
                        <button id="duo_run_btn" class="menu_button" title="Run agents">
                            <i class="fa-solid fa-people-arrows"></i>
                            <span>运行 Agent</span>
                        </button>
                        <button id="duo_inject_btn" class="menu_button" title="Inject">
                            <i class="fa-solid fa-file-import"></i>
                            <span>注入</span>
                        </button>
                        <button id="duo_clear_btn" class="menu_button" title="Clear">
                            <i class="fa-solid fa-eraser"></i>
                            <span>清除</span>
                        </button>
                    </div>
                    <div id="${STATUS_ID}" class="duo-extension-status"></div>
                    <pre id="${OUTPUT_ID}" class="duo-extension-output duo-extension-muted">No capsule yet.</pre>
                </div>
            </div>
        </div>
    `;
}

function bindCheckbox(id, key) {
    const settings = getSettings();
    const element = $(`#${id}`);
    element.prop('checked', Boolean(settings[key]));
    element.on('change', function () {
        settings[key] = Boolean($(this).prop('checked'));
        saveSettings();
    });
}

function bindInput(id, key, parser = String) {
    const settings = getSettings();
    const element = $(`#${id}`);
    element.val(settings[key]);
    element.on('input change', function () {
        settings[key] = parser($(this).val());
        saveSettings();
    });
}

function syncSettingsUi() {
    const settings = getSettings();
    $('#duo_enabled').prop('checked', Boolean(settings.enabled));
    $('#duo_auto_before_generation').prop('checked', Boolean(settings.autoBeforeGeneration));
    $('#duo_inject_after_manual_run').prop('checked', Boolean(settings.injectAfterManualRun));
    $('#duo_include_search_in_orchestration').prop('checked', Boolean(settings.includeSearchInOrchestration));
    $('#duo_search_provider').val(settings.searchProvider);
    $('#duo_searxng_base').val(settings.searxngBaseUrl);
    $('#duo_max_results').val(settings.maxResults);
    $('#duo_visit_top_results').val(settings.visitTopResults);
    $('#duo_orchestration_mode').val(settings.orchestrationMode);
    $('#duo_agent_api').val(settings.agentApi);
    $('#duo_agent_api_preset_name').val(settings.agentApiPresetName);
    $('#duo_agent_api_preset_names').html(renderConnectionProfileDatalist(settings.agentApiPresetName));
    $('#duo_max_concurrent_agents').val(settings.maxConcurrentAgents);
    $('#duo_response_length').val(settings.responseLength);
    $('#duo_synth_response_length').val(settings.synthResponseLength);
    $('#duo_auto_search_policy').val(settings.autoSearchPolicy);
    $('#duo_injection_depth').val(settings.injectionDepth);
}

function bindUi() {
    bindCheckbox('duo_enabled', 'enabled');
    bindCheckbox('duo_auto_before_generation', 'autoBeforeGeneration');
    bindCheckbox('duo_inject_after_manual_run', 'injectAfterManualRun');
    bindCheckbox('duo_include_search_in_orchestration', 'includeSearchInOrchestration');

    bindInput('duo_search_provider', 'searchProvider');
    bindInput('duo_searxng_base', 'searxngBaseUrl');
    bindInput('duo_max_results', 'maxResults', value => Math.max(1, Math.min(20, Number(value) || 6)));
    bindInput('duo_visit_top_results', 'visitTopResults', value => Math.max(0, Math.min(3, Number(value) || 0)));
    bindInput('duo_orchestration_mode', 'orchestrationMode');
    bindInput('duo_agent_api', 'agentApi');
    bindInput('duo_agent_api_preset_name', 'agentApiPresetName', normalizeWhitespace);
    bindInput('duo_max_concurrent_agents', 'maxConcurrentAgents', value => Math.max(1, Math.min(5, Number(value) || 3)));
    bindInput('duo_response_length', 'responseLength', value => Math.max(128, Number(value) || 420));
    bindInput('duo_synth_response_length', 'synthResponseLength', value => Math.max(256, Number(value) || 720));
    bindInput('duo_auto_search_policy', 'autoSearchPolicy');
    bindInput('duo_injection_depth', 'injectionDepth', value => Math.max(0, Math.min(100, Number(value) || 0)));

    $('#duo_defaults_btn').on('click', () => applyRecommendedDefaults());
    $('#duo_search_btn').on('click', () => onManualSearch(true));
    $('#duo_run_btn').on('click', () => runMultiAgent('manual'));
    $('#duo_inject_btn').on('click', () => {
        injectCapsule(runtime.latestCapsule);
        setStatus(runtime.latestCapsule ? 'Capsule injected.' : 'No capsule to inject.');
    });
    $('#duo_clear_btn').on('click', () => {
        clearInjection();
        setStatus('Injection cleared.');
    });
    syncSettingsUi();
}

async function onGenerationAfterCommands(type, params, dryRun) {
    if (runtime.hasPayloadHook) return;
    const settings = getSettings();
    if (!settings.enabled || !settings.autoBeforeGeneration) return;
    if (dryRun || type === 'quiet' || params?.quiet_prompt) return;
    await runMultiAgent('auto');
}

function shouldRunForPayload(payload) {
    const settings = getSettings();
    if (!settings.enabled || !settings.autoBeforeGeneration) return false;
    if (!payload || typeof payload !== 'object' || payload.dryRun) return false;
    const type = String(payload.type || 'normal').trim().toLowerCase();
    if (!ALLOWED_GENERATION_TYPES.has(type)) return false;
    if (payload.signal?.aborted) return false;
    return Array.isArray(payload.coreChat) && payload.coreChat.length > 0;
}

async function onGenerationWorldInfoFinalized(payload) {
    if (!shouldRunForPayload(payload)) return;
    await runMultiAgent('auto', payload);
}

jQuery(() => {
    const context = getContext();
    getSettings();
    if (!$(`#${UI_ID}`).length) {
        $('#extensions_settings').append(buildSettingsHtml());
        bindUi();
    }
    const finalizedEvent = context?.eventTypes?.GENERATION_WORLD_INFO_FINALIZED;
    if (finalizedEvent && context?.eventSource) {
        runtime.hasPayloadHook = true;
        context.eventSource.on(finalizedEvent, onGenerationWorldInfoFinalized);
    } else {
        eventSource.on(event_types.GENERATION_AFTER_COMMANDS, onGenerationAfterCommands);
    }
    eventSource.on(event_types.CHAT_CHANGED, () => {
        clearRunPanel();
        clearInjection();
        setStatus('');
    });
    console.info('[Duo] loaded.');
});
