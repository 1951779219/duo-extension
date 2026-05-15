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
const SETTINGS_VERSION = 2;

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

const MODE_AGENTS = Object.freeze({
    single: ['single'],
    fast: ['continuity', 'character', 'plot'],
    balanced: ['continuity', 'character', 'plot', 'research'],
    deep: ['continuity', 'character', 'plot', 'research', 'editor'],
});

const runtime = {
    running: false,
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

function getRecentChat(limit) {
    const context = getContext();
    const chat = Array.isArray(context.chat) ? context.chat : [];
    return chat.slice(-Math.max(1, Number(limit) || 1))
        .map((message) => {
            const name = normalizeWhitespace(message?.name || (message?.is_user ? context.name1 : context.name2) || '');
            const text = normalizeWhitespace(String(message?.mes || '').replace(/<[^>]+>/g, ' '));
            return `${name || 'Unknown'}: ${text}`;
        })
        .filter(line => line.trim().length > 1)
        .join('\n');
}

function getLatestUserMessage() {
    const context = getContext();
    const chat = Array.isArray(context.chat) ? context.chat : [];
    for (let i = chat.length - 1; i >= 0; i -= 1) {
        if (chat[i]?.is_user) {
            return normalizeWhitespace(String(chat[i]?.mes || '').replace(/<[^>]+>/g, ' '));
        }
    }
    return '';
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

function getSearchQueryForRun(source) {
    const settings = getSettings();
    const manualQuery = normalizeWhitespace($('#duo_search_query').val());
    if (manualQuery) return manualQuery;
    const latestUser = getLatestUserMessage();
    const searchQuery = extractSearchQuery(latestUser);
    if (source === 'manual' && settings.autoSearchPolicy !== 'never') return searchQuery;
    if (settings.autoSearchPolicy === 'always') return searchQuery;
    if (settings.autoSearchPolicy === 'when_requested' && shouldAutoSearch(latestUser)) return searchQuery;
    return '';
}

async function collectSearchContext(source) {
    const settings = getSettings();
    if (!settings.includeSearchInOrchestration) {
        return { query: '', results: [], visitedPages: [], brief: '' };
    }
    const query = getSearchQueryForRun(source);
    if (!query) {
        return { query: '', results: [], visitedPages: [], brief: '' };
    }

    setStatus(`Searching: ${query}`);
    const results = await searchWeb(query);
    renderResults(results);

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
    const agent = AGENTS[agentId] || AGENTS.single;
    const prompt = buildAgentPrompt(agent, contextBlock.recentChat, contextBlock.latestUser, contextBlock.searchBrief);
    const request = {
        prompt,
        systemPrompt: agent.system,
        trimNames: false,
    };
    if (options.responseLength) {
        request.responseLength = Math.max(128, Number(options.responseLength) || 420);
    }
    const text = await generateRaw(request);
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

    return generateRaw({
        prompt,
        systemPrompt: '你是剧情总编，负责把并行 agent 的意见压缩成短、清晰、可执行的 prompt 注入文本。',
        responseLength: Math.max(256, Number(settings.synthResponseLength) || 720),
        trimNames: false,
    });
}

function injectCapsule(capsule) {
    const settings = getSettings();
    const text = normalizeWhitespace(capsule);
    if (!text) {
        setExtensionPrompt(INJECT_KEY, '', extension_prompt_types.NONE, 0);
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

async function runMultiAgent(source = 'manual') {
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
        const latestUser = getLatestUserMessage();
        const recentChat = getRecentChat(settings.maxRecentMessages);
        const searchContext = await collectSearchContext(source);
        const contextBlock = {
            latestUser,
            recentChat,
            searchBrief: searchContext.brief,
        };

        const agentIds = MODE_AGENTS[settings.orchestrationMode] || MODE_AGENTS.fast;
        const concurrency = Math.max(1, Math.min(5, Number(settings.maxConcurrentAgents) || 3));
        setStatus(`Running ${agentIds.length} agent(s)...`);
        const parallelAgents = agentIds.length > 1 && concurrency > 1;
        const agentResponseLength = parallelAgents ? null : settings.responseLength;
        const agentOutputs = await mapLimit(agentIds, concurrency, agentId => runAgent(agentId, contextBlock, {
            responseLength: agentResponseLength,
        }));

        let capsule = '';
        if (agentOutputs.length === 1) {
            capsule = normalizeWhitespace(agentOutputs[0].text);
        } else {
            setStatus('Synthesizing capsule...');
            capsule = normalizeWhitespace(await synthesizeCapsule(agentOutputs, contextBlock));
        }
        renderOutput(capsule);

        if (source === 'auto' || settings.injectAfterManualRun) {
            injectCapsule(capsule);
        }

        setStatus(source === 'auto' ? 'Auto capsule injected.' : 'Capsule ready.');
        return capsule;
    } catch (error) {
        console.error('[Duo] multi-agent run failed:', error);
        notify('error', `Duo failed: ${error.message || error}`);
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
        setStatus(`Searching: ${query}`);
        const results = await searchWeb(query, { force });
        renderResults(results);
        setStatus(`Found ${results.length} result(s).`);
    } catch (error) {
        console.error('[Duo] search failed:', error);
        notify('error', `Search failed: ${error.message || error}`);
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
                                <option value="single">Single</option>
                                <option value="fast">Fast</option>
                                <option value="balanced">Balanced</option>
                                <option value="deep">Deep</option>
                            </select>
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
    const settings = getSettings();
    if (!settings.enabled || !settings.autoBeforeGeneration) return;
    if (dryRun || type === 'quiet' || params?.quiet_prompt) return;
    await runMultiAgent('auto');
}

jQuery(() => {
    getSettings();
    if (!$(`#${UI_ID}`).length) {
        $('#extensions_settings').append(buildSettingsHtml());
        bindUi();
    }
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, onGenerationAfterCommands);
    eventSource.on(event_types.CHAT_CHANGED, () => setStatus(''));
    console.info('[Duo] loaded.');
});
