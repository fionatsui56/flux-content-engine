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

// ════════════════════════════════════════════
// CLIENTS CRUD
// ════════════════════════════════════════════

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

// ════════════════════════════════════════════
// CONTENT CRUD
// ════════════════════════════════════════════

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

// PATCH /api/content/:id — update variations (ratings)
app.patch('/api/content/:id', async (req, res) => {
  const { id } = req.params;
  const { user_id, variations } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

  const result = await sbFetch(`/content?id=eq.${id}&user_id=eq.${user_id}`, 'PATCH', { variations });
  if (!result.ok) return res.status(result.status).json({ success: false, error: result.data });
  res.json({ success: true });
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

// ════════════════════════════════════════════
// AI ENGINE — GEMINI + CLAUDE CASCADE
// ════════════════════════════════════════════

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

  try {
    return await callGemini(prompt, maxTokens);
  } catch (geminiErr) {
    console.log(`Gemini failed: ${geminiErr.message}. Trying Claude...`);
    
    if (retries <= 0) throw geminiErr;
    
    try {
      const claudeKey = process.env.ANTHROPIC_API_KEY;
      if (!claudeKey) throw new Error('No Anthropic API key');
      
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: maxTokens || 3000,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      
      if (!r.ok) throw new Error(`Claude API error: ${r.status}`);
      const d = await r.json();
      const text = d.content?.[0]?.text;
      if (!text) throw new Error('Empty Claude response');
      console.log('Claude OK');
      return { text, provider: 'claude', model: 'claude-sonnet-4-20250514' };
    } catch (claudeErr) {
      console.log(`Claude failed: ${claudeErr.message}`);
      throw claudeErr;
    }
  }
}

// ════════════════════════════════════════════
// PROMPT BUILDER — 3-LAYER ARCHITECTURE
// ════════════════════════════════════════════

// LAYER 1: Platform + Language rules
function buildLayer1(platforms, language) {
  const langMap = { 
    tc: 'Traditional Chinese (繁體中文)', 
    sc: 'Simplified Chinese (簡體中文)', 
    en: 'English' 
  };
  const langName = langMap[language] || 'Traditional Chinese';

  let rules = `=== LAYER 1: PLATFORM & LANGUAGE RULES ===

LANGUAGE: ${langName} ONLY
⚠️ CRITICAL: Every single word must be in ${langName}
✗ FORBIDDEN: English words (except brand/product names)
✗ FORBIDDEN: Code-switching (mixing languages)
✗ FORBIDDEN: Inappropriate vocabulary for this variant`;

  if (language === 'tc') {
    rules += `\n\nTRADITIONAL CHINESE (Hong Kong):
✓ Use Hong Kong grammar & vocabulary
✓ Natural Hong Kong phrasing (conversational or formal depending on tone)
✗ FORBIDDEN: Simplified Chinese characters
✗ FORBIDDEN: Mainland slang`;
  }
  
  if (language === 'sc') {
    rules += `\n\nSIMPLIFIED CHINESE (Mainland):
✓ Use Mainland grammar & vocabulary
✓ Native Mainland phrasing
✗ FORBIDDEN: Traditional Chinese characters
✗ FORBIDDEN: Hong Kong colloquialisms`;
  }

  // Platform-specific rules
  const platformRules = [];
  if (platforms.includes('facebook')) {
    platformRules.push(`FACEBOOK:
- Conversational, community-focused tone
- Call-to-action encouraged (Link, Comment, Share)
- Emojis welcome (1-3 per post)
- Length: 150-300 words`);
  }
  if (platforms.includes('instagram')) {
    platformRules.push(`INSTAGRAM:
- Visual storytelling (write for image context)
- Hashtags: 5-10 relevant tags
- Emoji use natural and modest
- Captions: 100-200 words
- Use line breaks for readability`);
  }
  if (platforms.includes('xiaohongshu')) {
    platformRules.push(`XIAOHONGSHU (Little Red Book):
- Authentic, real-person voice (避免 AI 感)
- Discovery-focused hashtags (#話題)
- Emoji use high (2-5 per post)
- Mention benefits/experiences naturally
- Length: 200-400 words`);
  }
  if (platforms.includes('wechat')) {
    platformRules.push(`WECHAT:
- Intimate, personal tone
- Stories > Hard sell
- Use line breaks generously
- Emoji: subtle, 1-2
- Call-to-action: subtle (reply, share with group)
- Length: 150-300 words`);
  }
  if (platforms.includes('linkedin')) {
    platformRules.push(`LINKEDIN:
- Professional, thought-leader voice
- Industry insights prioritized
- Educational or motivational angle
- Emoji: minimal or none
- Length: 200-400 words`);
  }
  if (platforms.includes('threads')) {
    platformRules.push(`THREADS:
- Conversational, Twitter-like brevity
- Thread structure (use line breaks)
- Emoji welcome
- Length: 100-200 words per post
- Can be opinionated or witty`);
  }

  if (platformRules.length > 0) {
    rules += `\n\n${platformRules.join('\n\n')}`;
  }

  return rules;
}

// LAYER 2: Brand context + Tone enforcement (BUG 4 FIX)
function buildLayer2(opts) {
  const { clientName, industry, tone, brandStory, targetAudience, 
          forbiddenWords, mustMentionItems } = opts;

  let layer = `=== LAYER 2: BRAND CONTEXT & TONE ===
Brand Name: ${clientName || 'Unknown'}`;

  if (industry) layer += `\nIndustry: ${industry}`;
  
  // BUG 4 FIX: Explicit tone enforcement (强制执行)
  const toneRules = {
    'professional': `TONE: Professional
MUST DO:
  ✓ Formal vocabulary, complete sentences, no fragments
  ✓ Industry-appropriate terminology, structured thinking
  ✓ Credibility and authority (data, evidence when relevant)
  ✓ Formal register (书面语, not conversational)
MUST NOT:
  ✗ Slang, internet language, Cantonese colloquialisms
  ✗ Excessive emoji (max 0-1), casual markers
  ✗ Short fragments or text-speak
  ✗ Personal gossip or casual chitchat`,
    
    'casual': `TONE: Casual & Friendly
MUST DO:
  ✓ Conversational, warm, approachable
  ✓ Fragments and informal structures OK
  ✓ Personal touches, relatable stories
  ✓ Emoji use natural and frequent (2-4 per post)
MUST NOT:
  ✗ Too corporate or formal
  ✗ Overly technical jargon (explain if must use)
  ✗ Cold or distant language`,
    
    'luxury': `TONE: Luxury & Sophisticated
MUST DO:
  ✓ Elegant, refined language, understatement
  ✓ Premium positioning, timeless appeal
  ✓ Subtle confidence, quality focus
  ✓ Refined aesthetic (minimal emoji, high-quality vocabulary)
MUST NOT:
  ✗ Cheap language, hyperbole, over-selling
  ✗ Excessive emoji or casual markers
  ✗ Slang, colloquialisms, text-speak`,
    
    'energetic': `TONE: Energetic & Youthful
MUST DO:
  ✓ Enthusiastic, dynamic, fast-paced
  ✓ Trend-aware, modern references welcome
  ✓ Emoji & exclamation marks encouraged (3-5 per post)
  ✓ Witty, playful, conversational
MUST NOT:
  ✗ Boring, slow-paced, overly formal
  ✗ Outdated or corporate language`
  };

  if (tone && toneRules[tone]) {
    layer += `\n\n${toneRules[tone]}`;
  }

    // Compress to prevent brand context overwhelming tone rule
  if (brandStory) {
    const s = brandStory.length > 120 ? brandStory.substring(0, 117) + '...' : brandStory;
    layer += `\\nBrand Essence: ${s}`;
  }
  if (targetAudience) {
    const a = targetAudience.length > 100 ? targetAudience.substring(0, 97) + '...' : targetAudience;
    layer += `\\nAudience: ${a}`;
  }
  if (forbiddenWords) layer += `\\nFORBIDDEN WORDS: ${forbiddenWords}`;
  if (mustMentionItems) layer += `\\nMUST MENTION: ${mustMentionItems}`;

  // Tone reminder at end — reinforces tone as primary voice filter
  if (tone && toneRules[tone]) {
    layer += `\\n\\n⚠️ TONE PRIORITY: Confirm output matches ${tone.toUpperCase()} tone. Brand context is secondary — TONE is the primary voice filter.`;
  }

  return layer;
}

// LAYER 3: Compliance + Context triggers
function buildLayer3(platforms, topic, industry) {
  const triggers = [];

  // BUG 5 FIX: Already handled in /api/generate before this function
  // (Language forced to SC for XHS/WeChat)

  // Financial compliance
  const financialIndustries = ['finance', 'insurance', 'banking', 'investment'];
  if (industry && financialIndustries.some(f => industry.toLowerCase().includes(f))) {
    triggers.push(`FINANCIAL COMPLIANCE:
FORBIDDEN: 保本、保息、穩賺、無風險、保證收益
If mentioning returns: MUST add「投資涉及風險，過去表現不代表未來」`);
  }

  // Seasonal context
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

// Pillar-specific layer
function buildPillarLayer(pillars, rotationIndex) {
  if (!pillars || pillars.length === 0) return '';
  
  const pillar = pillars[rotationIndex % pillars.length];
  if (!pillar) return '';
  
  let layer = `=== PILLAR LAYER: CONTENT ANGLE ===
Selected Pillar: "${pillar.name}"`;
  
  if (pillar.description) {
    layer += `\nPillar Description: ${pillar.description}`;
  }
  
  if (pillar.cta) {
    layer += `\n\nCall-to-Action for this pillar: ${pillar.cta}
(Don't force it word-for-word if it breaks the platform's tone — adapt the phrasing while keeping the intent)`;
  }

  layer += `\n\nRULE: Your content should reflect the "${pillar.name}" angle.
This is strategic guidance — use it to shape the angle/perspective, not to restrict the topic.
If you genuinely cannot align with this pillar, create the best content for the topic anyway.`;

  return layer;
}

// ════════════════════════════════════════════
// TOPICS ENDPOINT — B2 Enhanced with Compression (BUG 3 FIX)
// ════════════════════════════════════════════
app.post('/api/topics', async (req, res) => {
  try {
    const { clientName, industry, tone, brandStory, targetAudience,
            platform, language, contentDirection,
            selectedPillars, pillarRotationIndex } = req.body;

    const layer1 = buildLayer1([platform], language);

    // BUG 3 FIX: Compress brand context to prevent over-restriction
    const layer2 = buildLayer2({
      clientName, industry, tone,
      brandStory: brandStory ? brandStory.substring(0, 60) : '', // 減到 60 chars
      targetAudience: targetAudience ? targetAudience.substring(0, 60) : '' // 減到 60 chars
    });

    // Pillar as NAME ONLY inspiration — descriptions omitted to prevent topic restriction
    const pillarHint = selectedPillars && selectedPillars.length > 0
      ? `\nCONTENT ANGLES (inspiration only — do NOT limit topics to these): ${selectedPillars.map(p => p.name).join(', ')}`
      : ''

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

All titles and descriptions in ${langName} ONLY. No English words except brand/platform names. Be specific and creative — NOT generic.`;

    const result = await callAI(prompt, 3000);

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

// ════════════════════════════════════════════
// GENERATE ENDPOINT — B2 Enhanced with Pillar + BUG 5 FIX
// ════════════════════════════════════════════
app.post('/api/generate', async (req, res) => {
  try {
    let { topic, clientName, industry, tone, brandStory, targetAudience,
            forbiddenWords, mustMentionItems, platforms, language,
            selectedPillars, pillarRotationIndex } = req.body;

    // Per-platform language: XHS/WeChat always SC; other platforms follow user selection
    const mainlandPlatforms = platforms.filter(p => ['xiaohongshu', 'wechat'].includes(p));
    const otherPlatforms    = platforms.filter(p => !['xiaohongshu', 'wechat'].includes(p));

    const langMap = {
      tc: 'Traditional Chinese (繁體中文)',
      sc: 'Simplified Chinese (簡體中文)',
      en: 'English'
    };

    let langInstruction = '';
    if (mainlandPlatforms.length > 0 && otherPlatforms.length > 0) {
      // Mixed platforms: specify per-platform
      langInstruction = `LANGUAGE RULES (per platform — strictly follow):
- ${otherPlatforms.map(p => p.toUpperCase()).join(' / ')}: ${langMap[language] || langMap.tc} — authentic grammar and vocabulary for this language
- ${mainlandPlatforms.map(p => p.toUpperCase()).join(' / ')}: Simplified Chinese (簡體中文) ONLY — authentic mainland vocabulary, NO Hong Kong or Taiwan terms`;
    } else if (mainlandPlatforms.length > 0) {
      // All mainland only
      language = 'sc';
      langInstruction = `LANGUAGE: Simplified Chinese (簡體中文) ONLY — authentic mainland vocabulary, NO Hong Kong or Taiwan terms`;
    } else {
      langInstruction = `LANGUAGE: ${langMap[language] || langMap.tc} — every word must be in this language. No English words except brand names.`;
    }

    const layer1 = buildLayer1(platforms, language);
    const layer2 = buildLayer2({
      clientName, industry, tone, brandStory, targetAudience,
      forbiddenWords, mustMentionItems
    });

    // B2: Pillar injection
    const pillarLayer = buildPillarLayer(selectedPillars || [], pillarRotationIndex || 0);

    const layer3 = buildLayer3(platforms, topic, industry);

    const variationFormat = platforms.map((p, i) =>
      `[Variation ${i + 1}] (${p.toUpperCase()})\n[Write ${p} content here]`
    ).join('\n\n');

    const prompt = `You are an expert social media content writer for Hong Kong and Greater Bay Area brands.

${layer1}

${layer2}

${pillarLayer ? pillarLayer + '\n\n' : ''}${layer3 ? layer3 + '\n\n' : ''}=== GENERATION TASK ===
Topic: "${topic}"
Platforms: ${platforms.join(', ')}

⚠️ ${langInstruction}
Do NOT mix languages between platforms unless specified above.
Exception: Brand names, proper nouns, platform names only.

Generate ONE variation per platform (${platforms.length} total).
Each variation MUST follow that platform's exact rules and sound like a real human wrote it.

OUTPUT FORMAT (use exactly):
${variationFormat}`;

    const result = await callAI(prompt, 6000);
    res.json({ success: true, text: result.text, provider: result.provider });
  } catch (err) {
    console.error('Generate error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Flux v2.1 running on port ${PORT} | Supabase: ${SUPABASE_SERVICE_KEY ? 'YES' : 'NO'} | Gemini: ${process.env.GEMINI_API_KEY ? 'YES' : 'NO'}`);
});
