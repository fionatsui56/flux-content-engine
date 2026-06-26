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
app.get('/', (req, res) => res.json({ service: 'Flux Strategy Content Engine', version: '2.1', status: 'running' }));

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
  const { user_id, name, industry, tone, brand_story, target_audience, target_audience_tags,
          competitors, forbidden_words, selected_pillars, must_mention_items } = req.body;
  if (!user_id || !name) return res.status(400).json({ success: false, error: 'user_id and name required' });

  const result = await sbFetch('/clients', 'POST', {
    user_id, name, industry, tone: tone || 'professional',
    brand_story, target_audience, target_audience_tags: target_audience_tags || {},
    competitors, forbidden_words,
    selected_pillars: selected_pillars || [],
    pillar_rotation_index: 0,
    must_mention_items: must_mention_items || null,
    is_active: true
  });
  if (!result.ok) return res.status(result.status).json({ success: false, error: result.data });
  res.json({ success: true, data: result.data });
});

// PUT /api/clients/:id
app.put('/api/clients/:id', async (req, res) => {
  const { id } = req.params;
  const { user_id, name, industry, tone, brand_story, target_audience, target_audience_tags,
          competitors, forbidden_words, selected_pillars, must_mention_items } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

  const updateData = {
    name, industry, tone, brand_story, target_audience,
    target_audience_tags: target_audience_tags || {},
    competitors, forbidden_words
  };
  // Only update pillar fields if explicitly provided
  if (selected_pillars !== undefined) updateData.selected_pillars = selected_pillars;
  if (must_mention_items !== undefined) updateData.must_mention_items = must_mention_items;

  const result = await sbFetch(`/clients?id=eq.${id}&user_id=eq.${user_id}`, 'PATCH', updateData);
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

// ── NEW: Advance pillar rotation after generation ──
// POST /api/clients/:id/advance-pillar
app.post('/api/clients/:id/advance-pillar', async (req, res) => {
  const { id } = req.params;
  const { user_id, current_index, pillar_count } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

  const nextIndex = pillar_count > 0 ? (current_index + 1) % pillar_count : 0;

  // Update lastUsed for current pillar + advance index
  const clientResult = await sbFetch(`/clients?id=eq.${id}&user_id=eq.${user_id}&select=selected_pillars`, 'GET');
  if (clientResult.ok && clientResult.data && clientResult.data[0]) {
    const pillars = clientResult.data[0].selected_pillars || [];
    if (pillars[current_index]) {
      pillars[current_index].lastUsed = new Date().toISOString();
    }
    await sbFetch(`/clients?id=eq.${id}&user_id=eq.${user_id}`, 'PATCH', {
      pillar_rotation_index: nextIndex,
      selected_pillars: pillars
    });
  }

  res.json({ success: true, next_index: nextIndex });
});

// ════════════════════════════════════════════════════
// CONTENT CRUD
// ════════════════════════════════════════════════════

app.get('/api/content', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

  const result = await sbFetch(`/content?user_id=eq.${user_id}&order=created_at.desc&limit=50`, 'GET');
  if (!result.ok) return res.status(result.status).json({ success: false, error: result.data });
  res.json({ success: true, data: result.data });
});

app.post('/api/content', async (req, res) => {
  const { user_id, client_id, topic, platforms, content_language, variations } = req.body;
  if (!user_id || !topic) return res.status(400).json({ success: false, error: 'user_id and topic required' });

  const result = await sbFetch('/content', 'POST', {
    user_id, client_id, topic, platforms: platforms || [],
    content_language: content_language || 'tc', variations: variations || []
  });
  await sbFetch('/usage_logs', 'POST', { user_id, client_id, action: 'generate' });
  if (!result.ok) return res.status(result.status).json({ success: false, error: result.data });
  res.json({ success: true, data: result.data });
});

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
// AI ENGINE — GEMINI + CLAUDE CASCADE
// ════════════════════════════════════════════════════

async function callGemini(prompt, maxTokens) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('No Gemini API key');

  const models = [
    'v1beta/models/gemini-2.5-flash',
    'v1beta/models/gemini-2.5-flash-lite',
    'v1beta/models/gemini-2.0-flash',
  ];

  let lastError = null;
  for (const model of models) {
    try {
      console.log(`Trying Gemini model: ${model}`);
      const r = await fetch(`https://generativelanguage.googleapis.com/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.8 }
        })
      });
      const d = await r.json();
      if (d.error) {
        console.log(`Gemini ${model} failed: ${d.error.message}`);
        lastError = d.error.message;
        // Wait 1s before trying next model
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) { lastError = 'Empty response'; continue; }
      console.log(`Gemini OK: ${model}`);
      return { text, provider: 'gemini', model };
    } catch (e) {
      console.log(`Gemini ${model} error: ${e.message}`);
      lastError = e.message;
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }
  }
  throw new Error(`All Gemini models failed. Last error: ${lastError}`);
}

async function callAI(prompt, maxTokens, retries = 2) {
  maxTokens = maxTokens || 3000;

  // Try Claude first if available
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const data = await response.json();
      if (!data.error) return { text: data.content[0].text, provider: 'claude' };
      console.error('Claude error:', data.error.message);
    } catch (err) {
      console.error('Claude failed:', err.message);
    }
  }

  // Gemini with retry
  if (process.env.GEMINI_API_KEY) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`Gemini attempt ${attempt}/${retries}`);
        return await callGemini(prompt, maxTokens);
      } catch (err) {
        console.error(`Gemini attempt ${attempt} failed: ${err.message}`);
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
      }
    }
  }

  throw new Error('All AI providers failed. Please try again.');
}

// ════════════════════════════════════════════════════
// B2: ENHANCED PROMPT BUILDER (4 LAYERS)
// ════════════════════════════════════════════════════

function buildLayer1(platforms, lang) {
  const platformRules = {
    facebook: `FACEBOOK:
- Length: 100-200 words (300+ OK for long-form)
- Hook: MUST open with question, bold statement, or story
- Hashtags: 2-3 only
- Style: Conversational, story-driven, warm
- CTA: Question that drives comments`,

    instagram: `INSTAGRAM:
- Length: 50-100 words (hook MUST land in first 125 chars)
- Hashtags: 8-10 at end
- Style: Concise, visual-forward, emoji-rich
- Line breaks between every sentence
- CTA: Drive SAVES ("Save this")`,

    threads: `THREADS:
- Length: Under 80 words
- Hashtags: 0-3 max
- Style: Extremely casual, like texting a friend
- Fragments OK. Open-ended is better than concluded.
- NEVER corporate tone`,

    linkedin: `LINKEDIN:
- Length: 150-250 words
- Hook in first 210 chars (before "see more")
- Hashtags: 3-5 precise ones
- Style: Professional but personal, thought-leadership
- Must end with a genuine question`,

    xiaohongshu: `XIAOHONGSHU (RED):
- Length: 150-250 words
- Title: MUST use 【】brackets e.g.【這個方法有效！】
- Hashtags: 8-15, Chinese/English mix, at end
- Emoji: After every key point
- Style: 種草 — friend sharing a discovery
- MAINLAND SIMPLIFIED CHINESE ONLY (no HK vocab)
- FORBIDDEN: 最/第一/唯一/保證/限時特惠`,

    wechat: `WECHAT MOMENTS:
- Length: 80-150 words
- NO hashtags (not supported)
- Style: Warm, personal, first-person
- MAINLAND SIMPLIFIED CHINESE ONLY
- End with soft question: 「你呢？」
- FORBIDDEN: Promotional language, superlatives`
  };

  const langRules = {
    tc: `LANGUAGE — Traditional Chinese (HK):
- Professional: 書面語 (formal written)
- Casual/Energetic: Natural HK Cantonese
- NEVER Taiwan expressions: 棒、讚、超級`,
    sc: `LANGUAGE — Simplified Chinese (Mainland):
- Write as NATIVE mainland Chinese, not character conversion
- Sound like 小紅書/WeChat native
- AVOID: HK (冇、靠、得唔得) and Taiwan (棒、讚) expressions
- Use: 很棒 not 好正 | 没问题 not 冇問題`,
    en: `LANGUAGE — English (Hong Kong):
- British spelling: colour, organisation, realise
- AVOID American jargon: leverage, synergise, game-changer
- AVOID AI clichés: "thrilled to share", "In today's world"
- Direct, clear, approachable tone`
  };

  const antiAI = `
ANTI-AI WRITING (CRITICAL — supersedes all other rules):
- Sound like a REAL HUMAN, not a corporate announcement
- Use specific details and concrete moments (not vague descriptions)
- Vary sentence length naturally
- NO markdown formatting: no **, no ##
- FORBIDDEN: "In conclusion", "Game-changer", "Unlock potential", "Leverage", "Synergy", "I'm thrilled"
- Open with a story, question, specific moment, or bold opinion`;

  const selectedRules = platforms.filter(p => platformRules[p]).map(p => platformRules[p]).join('\n\n');
  return `=== LAYER 1: PLATFORM & LANGUAGE RULES ===\n${selectedRules}\n\n${langRules[lang] || langRules['tc']}\n${antiAI}`;
}

function buildLayer2(client) {
  const toneDescriptions = {
    professional: 'Professional & trustworthy — authoritative but approachable',
    casual: 'Casual & friendly — conversational, warm, relatable',
    luxury: 'Luxury & premium — elegant, aspirational, refined',
    energetic: 'Energetic & bold — high energy, action-oriented'
  };

  let layer = `=== LAYER 2: BRAND PROFILE ===\nBrand: ${client.clientName}`;
  if (client.industry) layer += `\nIndustry: ${client.industry}`;
  layer += `\nTone: ${toneDescriptions[client.tone] || client.tone}`;

  // Brand story: compressed to 150 chars max to prevent over-restriction
  if (client.brandStory) {
    const story = client.brandStory.length > 150
      ? client.brandStory.substring(0, 147) + '...'
      : client.brandStory;
    layer += `\nBrand Essence: ${story}`;
  }

  // Audience: compressed to 120 chars max
  if (client.targetAudience) {
    const audience = client.targetAudience.length > 120
      ? client.targetAudience.substring(0, 117) + '...'
      : client.targetAudience;
    layer += `\nAudience: ${audience}`;
  }

  if (client.forbiddenWords) layer += `\nFORBIDDEN WORDS (never use): ${client.forbiddenWords}`;
  if (client.mustMentionItems) layer += `\nMUST MENTION (always include): ${client.mustMentionItems}`;

  return layer;
}

// B2: NEW — Pillar injection layer
function buildPillarLayer(pillars, rotationIndex) {
  if (!pillars || pillars.length === 0) return '';

  const idx = rotationIndex % pillars.length;
  const pillar = pillars[idx];
  if (!pillar) return '';

  return `=== CONTENT ANGLE (TODAY'S FOCUS) ===
Pillar: ${pillar.name}
Direction: ${pillar.description || 'Create content aligned with this angle'}

RULE: Your content should reflect the "${pillar.name}" angle.
This is strategic guidance — use it to shape the angle/perspective, not to restrict the topic.
If you genuinely cannot align with this pillar, create the best content for the topic anyway.`;
}

function buildLayer3(platforms, topic, industry) {
  const triggers = [];

  const mainlandPlatforms = platforms.filter(p => p === 'xiaohongshu' || p === 'wechat');
  if (mainlandPlatforms.length > 0) {
    triggers.push(`CHINA AD LAW (${mainlandPlatforms.join(', ')}):
FORBIDDEN: 最優、最好、最佳、最強、第一、唯一、100%、絕對、革命性
FORBIDDEN exaggeration: 火爆全港、瘋搶、秒空
Content must feel EDUCATIONAL or personal, not sales-driven`);
  }

  const financialIndustries = ['finance', 'insurance', 'banking', 'investment'];
  if (industry && financialIndustries.some(f => industry.toLowerCase().includes(f))) {
    triggers.push(`FINANCIAL COMPLIANCE:
FORBIDDEN: 保本、保息、穩賺、無風險、保證收益
If mentioning returns: MUST add 「投資涉及風險，過去表現不代表未來」`);
  }

  const topicLower = topic.toLowerCase();
  const seasonalMap = {
    'christmas': '🎄 Christmas — gift-giving, year-end, family warmth',
    '聖誕': '🎄 聖誕節 — 禮物、年終、家庭溫暖',
    'new year': '🎊 New Year — fresh start, resolutions',
    '新年': '🧧 農曆新年 — 團圓、繁榮、新開始',
    'valentine': "💕 Valentine's — love, appreciation",
    '情人節': '💕 情人節 — 愛、感恩',
    'mother': "💐 Mother's Day — appreciation, family",
    '母親節': '💐 母親節 — 感恩、家庭',
    '中秋': '🥮 中秋 — 團圓、月餅',
    '端午': '🐉 端午 — 粽子、傳統',
    'summer': '☀️ Summer — energy, holidays, refreshment',
  };
  for (const [keyword, hook] of Object.entries(seasonalMap)) {
    if (topicLower.includes(keyword)) {
      triggers.push(`SEASONAL CONTEXT: ${hook}`);
      break;
    }
  }

  if (triggers.length === 0) return '';
  return `=== LAYER 3: COMPLIANCE & CONTEXT ===\n${triggers.join('\n\n')}`;
}

// ════════════════════════════════════════════════════
// TOPICS ENDPOINT — B2 Enhanced
// ════════════════════════════════════════════════════
app.post('/api/topics', async (req, res) => {
  try {
    const { clientName, industry, tone, brandStory, targetAudience,
            platform, language, contentDirection,
            selectedPillars, pillarRotationIndex } = req.body;

    const layer1 = buildLayer1([platform], language);

    // Use compressed brand context for topics (prevent over-restriction)
    const layer2 = buildLayer2({
      clientName, industry, tone,
      brandStory: brandStory ? brandStory.substring(0, 100) : '',
      targetAudience: targetAudience ? targetAudience.substring(0, 80) : ''
    });

    // Pillar as inspiration, not restriction
    const pillarHint = selectedPillars && selectedPillars.length > 0
      ? `\nCONTENT ANGLE INSPIRATION: Mix topics across these angles — ${selectedPillars.map(p => p.name).join(', ')}`
      : '';

    const langMap = { tc: 'Traditional Chinese', sc: 'Simplified Chinese', en: 'English' };
    const langName = langMap[language] || langMap.tc;

    const prompt = `You are an expert social media strategist for Hong Kong and Greater Bay Area brands.

${layer1}

${layer2}
${pillarHint}

TASK: Generate EXACTLY 8 diverse topic suggestions.
${contentDirection ? `Content Direction Focus: ${contentDirection}` : ''}

CRITICAL: Output MUST start with [Topic 1] immediately. NO intro text. NO preamble.

[Topic 1]
Angle: Sales/Promotion
Title: [concise title in ${langName}]
Description: [1-2 sentences why this works for this brand]

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
Angle: Behind-the-Scenes
Title: [concise title]
Description: [1-2 sentences]

All titles and descriptions in ${langName}. Be specific and creative — NOT generic.`;

    const result = await callAI(prompt, 2000);

    // Log usage
    if (req.body.user_id && req.body.client_id) {
      await sbFetch('/usage_logs', 'POST', {
        user_id: req.body.user_id,
        client_id: req.body.client_id,
        action: 'topic_suggest'
      });
    }

    res.json({ success: true, text: result.text, provider: result.provider });
  } catch (err) {
    console.error('Topics error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════
// GENERATE ENDPOINT — B2 Enhanced with Pillar
// ════════════════════════════════════════════════════
app.post('/api/generate', async (req, res) => {
  try {
    const { topic, clientName, industry, tone, brandStory, targetAudience,
            forbiddenWords, mustMentionItems, platforms, language,
            selectedPillars, pillarRotationIndex } = req.body;

    const layer1 = buildLayer1(platforms, language);
    const layer2 = buildLayer2({
      clientName, industry, tone, brandStory, targetAudience,
      forbiddenWords, mustMentionItems
    });

    // B2: Pillar injection
    const pillarLayer = buildPillarLayer(selectedPillars || [], pillarRotationIndex || 0);

    const layer3 = buildLayer3(platforms, topic, industry);

    const langMap = {
      tc: 'Traditional Chinese (繁體中文)',
      sc: 'Simplified Chinese (簡體中文)',
      en: 'English'
    };

    const variationFormat = platforms.map((p, i) =>
      `[Variation ${i + 1}] (${p.toUpperCase()})\n[Write ${p} content here]`
    ).join('\n\n');

    const prompt = `You are an expert social media content writer for Hong Kong and Greater Bay Area brands.

${layer1}

${layer2}

${pillarLayer ? pillarLayer + '\n\n' : ''}${layer3 ? layer3 + '\n\n' : ''}=== GENERATION TASK ===
Topic: "${topic}"
Platforms: ${platforms.join(', ')}
Language: ${langMap[language] || langMap.tc}

Generate ONE variation per platform (${platforms.length} total).
Each variation MUST follow that platform's exact rules and sound like a real human wrote it.

OUTPUT FORMAT (use exactly):
${variationFormat}`;

    const result = await callAI(prompt, 4000);
    res.json({ success: true, text: result.text, provider: result.provider });
  } catch (err) {
    console.error('Generate error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Flux v2.1 running on port ${PORT} | Supabase: ${SUPABASE_SERVICE_KEY ? 'YES' : 'NO'} | Gemini: ${process.env.GEMINI_API_KEY ? 'YES' : 'NO'}`);
});
