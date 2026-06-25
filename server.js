const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── SUPABASE CONFIG ──
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rmvfihgclnzbxzuxnmzb.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbFetch(path, method, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch(e) { return { ok: res.ok, status: res.status, data: text }; }
}

// ── KEEP ALIVE ──
app.get('/ping', (req, res) => res.json({ status: 'alive', time: new Date().toISOString() }));
app.get('/', (req, res) => res.json({ service: 'Flux Strategy Content Engine', status: 'running' }));

// ════════════════════════════════════════════════════
// CLIENTS CRUD
// ════════════════════════════════════════════════════

// GET /api/clients?user_id=xxx
app.get('/api/clients', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

  const result = await sbFetch(`/clients?user_id=eq.${user_id}&is_active=eq.true&order=created_at.asc`, 'GET');
  if (!result.ok) return res.status(result.status).json({ success: false, error: result.data });
  res.json({ success: true, data: result.data });
});

// POST /api/clients
app.post('/api/clients', async (req, res) => {
  const { user_id, name, industry, tone, brand_story, target_audience, target_audience_tags, competitors, forbidden_words } = req.body;
  if (!user_id || !name) return res.status(400).json({ success: false, error: 'user_id and name required' });

  const result = await sbFetch('/clients', 'POST', {
    user_id, name, industry, tone: tone || 'professional',
    brand_story, target_audience, target_audience_tags: target_audience_tags || {},
    competitors, forbidden_words, is_active: true
  });
  if (!result.ok) return res.status(result.status).json({ success: false, error: result.data });
  res.json({ success: true, data: result.data });
});

// PUT /api/clients/:id
app.put('/api/clients/:id', async (req, res) => {
  const { id } = req.params;
  const { user_id, name, industry, tone, brand_story, target_audience, target_audience_tags, competitors, forbidden_words } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

  const result = await sbFetch(`/clients?id=eq.${id}&user_id=eq.${user_id}`, 'PATCH', {
    name, industry, tone, brand_story, target_audience,
    target_audience_tags: target_audience_tags || {}, competitors, forbidden_words
  });
  if (!result.ok) return res.status(result.status).json({ success: false, error: result.data });
  res.json({ success: true });
});

// DELETE /api/clients/:id (soft delete)
app.delete('/api/clients/:id', async (req, res) => {
  const { id } = req.params;
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

  const result = await sbFetch(`/clients?id=eq.${id}&user_id=eq.${user_id}`, 'PATCH', { is_active: false });
  if (!result.ok) return res.status(result.status).json({ success: false, error: result.data });
  res.json({ success: true });
});

// ════════════════════════════════════════════════════
// CONTENT CRUD
// ════════════════════════════════════════════════════

// GET /api/content?user_id=xxx
app.get('/api/content', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

  const result = await sbFetch(`/content?user_id=eq.${user_id}&order=created_at.desc&limit=50`, 'GET');
  if (!result.ok) return res.status(result.status).json({ success: false, error: result.data });
  res.json({ success: true, data: result.data });
});

// POST /api/content
app.post('/api/content', async (req, res) => {
  const { user_id, client_id, topic, platforms, content_language, variations } = req.body;
  if (!user_id || !topic) return res.status(400).json({ success: false, error: 'user_id and topic required' });

  const result = await sbFetch('/content', 'POST', {
    user_id, client_id, topic, platforms: platforms || [],
    content_language: content_language || 'tc', variations: variations || []
  });

  // Log usage
  await sbFetch('/usage_logs', 'POST', { user_id, client_id, action: 'generate' });

  if (!result.ok) return res.status(result.status).json({ success: false, error: result.data });
  res.json({ success: true, data: result.data });
});

// GET /api/content/count?user_id=xxx
app.get('/api/content/count', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

  const res2 = await fetch(`${SUPABASE_URL}/rest/v1/content?user_id=eq.${user_id}&select=id`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Prefer': 'count=exact'
    }
  });
  const count = res2.headers.get('content-range')?.split('/')[1] || '0';
  res.json({ success: true, count: parseInt(count) });
});

// ════════════════════════════════════════════════════
// GEMINI AI
// ════════════════════════════════════════════════════

async function callGemini(prompt, maxTokens) {
  const key = process.env.GEMINI_API_KEY;
  const models = [
    'v1beta/models/gemini-2.5-flash',
    'v1beta/models/gemini-3.5-flash',
    'v1beta/models/gemini-2.5-flash-lite',
  ];
  for (const model of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/${model}:generateContent?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.8 }
        })
      });
      const d = await r.json();
      if (d.error) { console.log('Gemini', model, 'failed:', d.error.message); continue; }
      const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) continue;
      console.log('Gemini OK:', model);
      return { text, provider: 'gemini' };
    } catch (e) { console.log('Gemini', model, 'error:', e.message); continue; }
  }
  throw new Error('All Gemini models failed.');
}

async function callAI(prompt, maxTokens) {
  maxTokens = maxTokens || 3000;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
      });
      const data = await response.json();
      if (!data.error) return { text: data.content[0].text, provider: 'claude' };
      console.error('Claude error:', data.error.message);
    } catch (err) { console.error('Claude failed:', err.message); }
  }
  if (process.env.GEMINI_API_KEY) return await callGemini(prompt, maxTokens);
  throw new Error('No API key configured.');
}

// ════════════════════════════════════════════════════
// E5: THREE-LAYER PROMPT BUILDER
// ════════════════════════════════════════════════════

function buildLayer1(platforms, lang) {
  const platformRules = {
    facebook: `FACEBOOK RULES:
- Length: 100-200 words (300+ for long-form)
- Style: Conversational storytelling, warm and relatable
- Hook: MUST start with question, bold statement, or story opener
- Hashtags: 2-3 only
- CTA: Specific comment-driving question`,

    instagram: `INSTAGRAM RULES:
- Length: 50-100 words (caption cuts at 125 chars — hook MUST land before cutoff)
- Style: Concise, visual-forward, emoji-rich
- Hashtags: 8-10 at end
- Line breaks between every sentence
- CTA: Drive SAVES ("Save this for later")`,

    threads: `THREADS RULES:
- Length: Under 80 words
- Style: Extremely casual, like talking to a friend
- Hashtags: 0-3 max
- Fragments are OK. Open-ended is better.
- NEVER corporate tone`,

    linkedin: `LINKEDIN RULES:
- Length: 150-250 words
- Hook in first 210 characters (before "see more")
- Style: Personal voice, professional but human
- Hashtags: 3-5 precise ones
- Structure: Hook → Expand → Key insight → Closing question`,

    xiaohongshu: `XIAOHONGSHU (RED) RULES:
- Length: 150-250 words
- Title MUST use 【】brackets e.g.【這個方法真的有效！】
- Style: 種草 mindset — friend sharing a discovery
- Hashtags: 8-15, Chinese/English mix
- Emoji after every key point
- MAINLAND CHINESE ONLY — NO HK expressions
- FORBIDDEN: 最/第一/唯一/保證/限時特惠`,

    wechat: `WECHAT MOMENTS RULES:
- Length: 80-150 words
- Style: Warm and personal, like sharing with close friends
- NO hashtags
- First-person voice, genuine feel
- MAINLAND CHINESE ONLY
- CTA: Soft closing question e.g.「你呢？」
- FORBIDDEN: Promotional language, superlatives`
  };

  const langRules = {
    tc: `LANGUAGE: Traditional Chinese (Hong Kong)
- Professional/Educational: Formal written Chinese (書面語)
- Casual/Energetic: Natural HK conversational style
- Luxury: Elegant formal: 「臻選」「尊享」
- NEVER use Taiwan expressions: 棒、讚`,
    sc: `LANGUAGE: Simplified Chinese (Mainland)
- Sound native to XiaoHongShu and WeChat
- AVOID: HK expressions (冇、靠), Taiwan expressions (棒、讚)
- Use: 很棒 not 好正 | 没问题 not 冇問題`,
    en: `LANGUAGE: English (Hong Kong English)
- British spelling: colour, organisation, realise
- AVOID American jargon: leverage, synergise, game-changer
- AVOID AI clichés: "I'm thrilled to share", "In today's world"
- Direct, clear, approachable`
  };

  const antiAI = `
ANTI-AI WRITING RULES (CRITICAL):
- Write like a real human, NOT a corporate announcement
- Vary sentence length
- Include specific details, not vague descriptions
- NO markdown: no **, no ##
- FORBIDDEN phrases: "In conclusion", "Game-changer", "Unlock your potential", "Leverage", "Synergy"
- Start with a story, question, specific moment, or bold opinion`;

  const selectedPlatformRules = platforms.filter(p => platformRules[p]).map(p => platformRules[p]).join('\n\n');
  return `=== LAYER 1: PLATFORM & LANGUAGE RULES ===\n${selectedPlatformRules}\n\n${langRules[lang] || langRules['tc']}\n${antiAI}`;
}

function buildLayer2(client) {
  const toneDescriptions = {
    professional: 'Professional & trustworthy — authoritative but approachable',
    casual: 'Casual & friendly — conversational, warm, relatable',
    luxury: 'Luxury & premium — elegant, aspirational, refined',
    energetic: 'Energetic & bold — high energy, action-oriented'
  };
  let layer = `=== LAYER 2: BRAND RULES ===\nClient: ${client.clientName}`;
  if (client.industry) layer += `\nIndustry: ${client.industry}`;
  layer += `\nBrand Tone: ${toneDescriptions[client.tone] || client.tone}`;
  if (client.brandStory) layer += `\nBrand Story: ${client.brandStory.substring(0, 200)}`;
  if (client.targetAudience) layer += `\nTarget Audience: ${client.targetAudience.substring(0, 150)}`;
  if (client.competitors) layer += `\nCompetitors: ${client.competitors}`;
  if (client.forbiddenWords) layer += `\nFORBIDDEN WORDS: ${client.forbiddenWords}`;
  return layer;
}

function buildLayer3(platforms, topic, industry) {
  const triggers = [];
  const mainlandPlatforms = platforms.filter(p => p === 'xiaohongshu' || p === 'wechat');
  if (mainlandPlatforms.length > 0) {
    triggers.push(`CHINA ADVERTISING LAW (${mainlandPlatforms.join(', ')}):
FORBIDDEN: 最優、最好、最佳、最強、第一、唯一、100%、絕對、革命性
FORBIDDEN exaggeration: 火爆全港、瘋搶、秒空
Content must feel EDUCATIONAL or personal, not sales-driven`);
  }
  const financialIndustries = ['finance', 'insurance', 'banking', 'investment'];
  if (industry && financialIndustries.some(f => industry.toLowerCase().includes(f))) {
    triggers.push(`FINANCIAL COMPLIANCE:
FORBIDDEN: 保本、保息、穩賺、無風險、保證收益
If mentioning returns, MUST add: 「投資涉及風險，過去表現不代表未來」`);
  }
  const topicLower = topic.toLowerCase();
  const seasonalMap = {
    'christmas': '🎄 Christmas — gift-giving, year-end gratitude, family warmth',
    '聖誕': '🎄 聖誕節 — 禮物、年終感恩、家庭溫暖',
    'new year': '🎊 New Year — fresh start, resolutions, reflection',
    '新年': '🧧 農曆新年 — 團圓、繁榮、新開始',
    "valentine": "💕 Valentine's Day — love, appreciation, connection",
    '情人節': '💕 情人節 — 愛、感恩、連結',
    "mother": "💐 Mother's Day — appreciation, family bond",
    '母親節': '💐 母親節 — 感恩、家庭情感',
    '中秋': '🥮 中秋節 — 團圓、月餅、家庭傳統',
    '端午': '🐉 端午節 — 粽子、傳統、家庭聚會',
    'summer': '☀️ Summer — energy, holidays, refreshment',
  };
  for (const [keyword, hook] of Object.entries(seasonalMap)) {
    if (topicLower.includes(keyword)) {
      triggers.push(`SEASONAL CONTEXT: ${hook}`);
      break;
    }
  }
  if (triggers.length === 0) return '';
  return `=== LAYER 3: CONTEXT TRIGGERS ===\n${triggers.join('\n\n')}`;
}

// ════════════════════════════════════════════════════
// TOPICS ENDPOINT
// ════════════════════════════════════════════════════
app.post('/api/topics', async (req, res) => {
  try {
    const { clientName, industry, tone, brandStory, targetAudience, platform, language, contentDirection } = req.body;
    const layer1 = buildLayer1([platform], language);
    const layer2 = buildLayer2({ clientName, industry, tone, brandStory, targetAudience });

    const langMap = { tc: 'Traditional Chinese', sc: 'Simplified Chinese', en: 'English' };
    const langName = langMap[language] || langMap.tc;

    const prompt = `You are an expert social media strategist for Hong Kong and Greater Bay Area brands.

${layer1}

${layer2}

OUTPUT EXACTLY 8 TOPICS. NO intro text. Start directly with [Topic 1].
${contentDirection ? 'Content Direction: ' + contentDirection : ''}

[Topic 1]
Angle: Sales/Promotion
Title: [concise title in ${langName}]
Description: [1-2 sentences]

[Topic 2]
Angle: Education/Tips
Title: [concise title]
Description: [1-2 sentences]

[Topic 3]
Angle: Entertainment
Title: [concise title]
Description: [1-2 sentences]

[Topic 4]
Angle: Engagement
Title: [concise title]
Description: [1-2 sentences]

[Topic 5]
Angle: Seasonal/Trending
Title: [concise title]
Description: [1-2 sentences]

[Topic 6]
Angle: Daily Life
Title: [concise title]
Description: [1-2 sentences]

[Topic 7]
Angle: Habits/Routines
Title: [concise title]
Description: [1-2 sentences]

[Topic 8]
Angle: Sales/Promotion
Title: [concise title]
Description: [1-2 sentences]

Write all Titles and Descriptions in ${langName}.`;

    const result = await callAI(prompt, 2000);
    res.json({ success: true, text: result.text, provider: result.provider });
  } catch (err) {
    console.error('Topics error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════
// GENERATE ENDPOINT
// ════════════════════════════════════════════════════
app.post('/api/generate', async (req, res) => {
  try {
    const { topic, clientName, industry, tone, brandStory, targetAudience, forbiddenWords, platforms, language } = req.body;
    const layer1 = buildLayer1(platforms, language);
    const layer2 = buildLayer2({ clientName, industry, tone, brandStory, targetAudience, forbiddenWords });
    const layer3 = buildLayer3(platforms, topic, industry);

    const langMap = { tc: 'Traditional Chinese (繁體中文)', sc: 'Simplified Chinese (簡體中文)', en: 'English' };

    const variationFormat = platforms.map((p, i) =>
      `[Variation ${i + 1}] (${p.toUpperCase()})\n[Write ${p} content here]`
    ).join('\n\n');

    const prompt = `You are an expert social media content writer for Hong Kong and Greater Bay Area brands.

${layer1}

${layer2}

${layer3 ? layer3 + '\n\n' : ''}=== CONTENT GENERATION TASK ===
Topic: "${topic}"
Platforms: ${platforms.join(', ')}
Output Language: ${langMap[language] || langMap.tc}

Generate ONE content variation per platform (${platforms.length} total).
Each variation must follow that platform's rules exactly and sound human.

OUTPUT FORMAT:
${variationFormat}`;

    const result = await callAI(prompt, 4000);
    res.json({ success: true, text: result.text, provider: result.provider });
  } catch (err) {
    console.error('Generate error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Flux running on port ${PORT} | Supabase: ${SUPABASE_SERVICE_KEY ? 'YES' : 'NO'} | Gemini: ${process.env.GEMINI_API_KEY ? 'YES' : 'NO'}`);
});
