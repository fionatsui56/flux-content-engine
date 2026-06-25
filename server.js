const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Keep-alive
app.get('/ping', (req, res) => res.json({ status: 'alive', time: new Date().toISOString() }));

// Health check
app.get('/', (req, res) => res.json({ service: 'Flux Strategy Content Engine', status: 'running' }));

// ── GEMINI FALLBACK ──
async function callGemini(prompt, maxTokens) {
  const key = process.env.GEMINI_API_KEY;
  const models = [
    'v1beta/models/gemini-2.5-flash-preview-04-17',
    'v1beta/models/gemini-2.0-flash-lite',
    'v1beta/models/gemini-flash-latest',
    'v1beta/models/gemini-1.5-flash',
    'v1/models/gemini-1.5-flash',
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

// ── MAIN AI CALLER ──
async function callAI(prompt, maxTokens) {
  maxTokens = maxTokens || 3000;
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
- CTA: Specific comment-driving question or "Tag someone who needs this"
- Algorithm tip: Drive comments and saves — not just likes`,

    instagram: `INSTAGRAM RULES:
- Length: 50-100 words (caption cuts at 125 chars — hook MUST land before cutoff)
- Style: Concise, visual-forward, emoji-rich
- Hashtags: 8-10 at end
- Line breaks between every sentence
- CTA: Drive SAVES ("Save this for later") — algorithm prioritises saves+shares
- Hook options: Bold statement | Data drop | Pain point | Before vs After contrast`,

    threads: `THREADS RULES:
- Length: Under 80 words
- Style: Extremely casual, like talking to a friend
- Hashtags: 0-3 max
- Fragments are OK. Open-ended is better than concluded.
- CTA: Soft question or light provocation that invites replies
- NEVER corporate tone`,

    linkedin: `LINKEDIN RULES:
- Length: 150-250 words
- Hook in first 210 characters (before "see more")
- Style: Personal voice beats brand voice. Professional but human.
- Hashtags: 3-5 precise ones
- Structure: Hook → Expand → Key insight → Closing question
- CTA: Genuine discussion question at end
- NO fake inspirational stories. NO pure sales language.`,

    xiaohongshu: `XIAOHONGSHU (RED) RULES:
- Length: 150-250 words
- Title MUST use 【】brackets e.g.【這個方法真的有效！】
- Style: 種草 mindset — friend sharing a discovery, NOT an ad
- Hashtags: 8-15, Chinese/English mix, placed at end or between paragraphs
- Emoji after every key point
- MAINLAND CHINESE ONLY — NO HK expressions (冇、靠、得啦)
- Hook options: 數字型 "5個方法" | 疑問型 "為什麼你總是…" | 對比型 "用了之後再也回不去了"
- CTA: Drive 收藏 (saves). Soft interactive question at end.
- FORBIDDEN: 最/第一/唯一/保證/限時特惠`,

    wechat: `WECHAT MOMENTS RULES:
- Length: 80-150 words
- Style: Warm and personal, like sharing with close friends
- NO hashtags (WeChat Moments has no hashtag function)
- First-person voice, genuine feel
- MAINLAND CHINESE ONLY
- CTA: Soft closing question e.g.「你呢？」「你也有這種感覺嗎？」
- Natural paragraphs — NO bullet points
- FORBIDDEN: Promotional language, superlatives, links`
  };

  const langRules = {
    tc: `LANGUAGE: Traditional Chinese (Hong Kong)
- Adjust style to brand tone:
  - Professional/Educational: Formal written Chinese (書面語): 「我們提供…」「協助您…」「發現…」
  - Casual/Energetic: Natural HK conversational: 「搞掂！」「係咁先！」「得唔得呀？」
  - Luxury: Elegant formal: 「臻選」「尊享」「精粹」
- NEVER mix written and colloquial in same piece
- NEVER use Taiwan expressions: 棒、哦、超級、讚 (use: 正、好、非常、好鐘意)
- Punctuation: HK style 「」for quotes`,

    sc: `LANGUAGE: Simplified Chinese (Mainland)
- This is NOT just font conversion — it is a full GRAMMAR and TONE conversion
- Sound native to XiaoHongShu and WeChat
- COMPLETELY AVOID: HK expressions (冇、靠、得唔得、係咁先), Taiwan expressions (棒、讚)
- Natural Mainland expressions:
  很棒 not 好正 | 没问题 not 冇問題 | 试试看 not 試吓 | 非常喜欢 not 好鐘意 | 真的 not 真係`,

    en: `LANGUAGE: English (Hong Kong English standard)
- British spelling: colour, organisation, realise, capitalise
- Tone varies by platform (LinkedIn = professional, Threads = casual fragments)
- AVOID American corporate jargon: leverage, synergise, paradigm shift, game-changer, ecosystem
- AVOID AI clichés: "I'm thrilled to share", "In today's world", "Unlock your potential", "Without further ado"
- Keep it direct, clear, approachable — real person talking, not corporate memo
- Vary sentence length: short punchy sentences mixed with longer ones`
  };

  const antiAI = `
ANTI-AI WRITING RULES (CRITICAL — apply to every variation):
- Write like a real human, NOT a corporate announcement
- Vary sentence length — short punchy sentences mixed with longer ones
- Include specific details (names, places, times) not vague descriptions
- Show emotion and personality — not mechanical statements
- NO markdown formatting: no **, no ##, no bullet points in output
- FORBIDDEN AI phrases: "In conclusion", "It is worth noting", "Dive into", "Game-changer",
  "Unlock your potential", "In today's rapidly evolving", "I'm thrilled to share",
  "Without further ado", "At the end of the day", "Thank you for reading",
  "Leverage", "Empower", "Ecosystem", "Synergy", "Paradigm"
- Instead: Start with a story, a question, a specific moment, or a bold opinion
- Add dialogue where possible ("My client asked me...")
- Reference specific times ("Last week", "Yesterday", "3 months ago")`;

  const selectedPlatformRules = platforms
    .filter(p => platformRules[p])
    .map(p => platformRules[p])
    .join('\n\n');

  return `=== LAYER 1: PLATFORM & LANGUAGE RULES ===
${selectedPlatformRules}

${langRules[lang] || langRules['tc']}
${antiAI}`;
}

function buildLayer2(client) {
  const toneDescriptions = {
    professional: 'Professional & trustworthy — authoritative but approachable, data-informed, confidence-building',
    casual: 'Casual & friendly — conversational, warm, relatable, like talking to a knowledgeable friend',
    luxury: 'Luxury & premium — elegant, aspirational, refined language, exclusivity without arrogance',
    energetic: 'Energetic & bold — high energy, action-oriented, inspiring, dynamic and motivating'
  };

  let layer = `=== LAYER 2: BRAND RULES ===
Client: ${client.clientName}`;
  if (client.industry) layer += `\nIndustry: ${client.industry}`;
  layer += `\nBrand Tone: ${toneDescriptions[client.tone] || client.tone}`;
  if (client.brandStory) layer += `\nBrand Story: ${client.brandStory.substring(0, 200)}`;
  if (client.targetAudience) layer += `\nTarget Audience: ${client.targetAudience.substring(0, 150)}`;
  if (client.competitors) layer += `\nCompetitors to differentiate from: ${client.competitors}`;
  if (client.forbiddenWords) layer += `\nFORBIDDEN WORDS — never use these: ${client.forbiddenWords}`;
  return layer;
}

function buildLayer3(platforms, topic, industry) {
  const triggers = [];

  // Mainland compliance
  const mainlandPlatforms = platforms.filter(p => p === 'xiaohongshu' || p === 'wechat');
  if (mainlandPlatforms.length > 0) {
    triggers.push(`CHINA ADVERTISING LAW COMPLIANCE (${mainlandPlatforms.join(', ')}):
FORBIDDEN superlatives: 最優、最好、最佳、最強、第一、唯一、獨一無二、頂級、極致、100%、絕對、革命性、顛覆性
Replace with: 優質、出色、卓越、備受好評、業界認可、創新方案
FORBIDDEN exaggeration: 火爆全港、瘋搶、秒空、不買就後悔、限時特惠
Content must feel EDUCATIONAL or personal, not sales-driven`);
  }

  // Financial compliance
  const financialIndustries = ['finance', 'insurance', 'banking', 'investment'];
  if (industry && financialIndustries.some(f => industry.toLowerCase().includes(f))) {
    triggers.push(`FINANCIAL CONTENT COMPLIANCE:
ABSOLUTELY FORBIDDEN: 保本、保息、穩賺、必賺、無風險、零風險、保證收益、確保回報、躺賺
Replace with: 具保障成分、歷史表現參考、具增值潛力、風險相對較低
If mentioning specific returns (%), MUST add disclaimer: 「投資涉及風險，過去表現不代表未來」
Content must BUILD TRUST through education — do not hard-sell products`);
  }

  // Seasonal detection
  const topicLower = topic.toLowerCase();
  const seasonalMap = {
    'christmas': '🎄 Christmas — gift-giving, year-end gratitude, family warmth. Weave festive spirit naturally.',
    'xmas': '🎄 Christmas — gift-giving, year-end gratitude, family warmth.',
    '聖誕': '🎄 聖誕節 — 禮物、年終感恩、家庭溫暖，自然融入節日氣氛',
    'new year': '🎊 New Year — fresh start, resolutions, reflection. Hopeful and forward-looking tone.',
    '新年': '🧧 農曆新年 — 團圓、繁榮、家庭、新開始，喜慶但真誠',
    'valentine': "💕 Valentine's Day — love, appreciation, connection. Warm emotional tone.",
    '情人節': '💕 情人節 — 愛、感恩、連結，溫暖情感語氣',
    'mother': "💐 Mother's Day — appreciation, family bond, heartfelt gratitude.",
    '母親節': '💐 母親節 — 感恩、家庭情感，真誠溫暖',
    'mid-autumn': '🥮 Mid-Autumn Festival — reunion, mooncakes, family traditions.',
    '中秋': '🥮 中秋節 — 團圓、月餅、家庭傳統，文化先於品牌',
    '端午': '🐉 端午節 — 粽子、傳統、家庭聚會，文化先於品牌',
    'summer': '☀️ Summer — energy, holidays, refreshment themes.',
    'back to school': '📚 Back to school — new beginnings, preparation, achievement themes.',
    '開學': '📚 開學季 — 新學年、準備、成就主題'
  };

  for (const [keyword, hook] of Object.entries(seasonalMap)) {
    if (topicLower.includes(keyword)) {
      triggers.push(`SEASONAL CONTEXT: ${hook}\nWeave this angle naturally — do not force it.`);
      break;
    }
  }

  // Month-based
  const month = new Date().getMonth() + 1;
  if ((month === 1 || month === 2) && !triggers.some(t => t.includes('新年'))) {
    triggers.push('SEASONAL: Chinese New Year period — prosperity, fresh starts, family reunion themes resonate strongly now.');
  }
  if (month === 12 && !triggers.some(t => t.includes('Christmas'))) {
    triggers.push('SEASONAL: Year-end period — reflection, gratitude, holiday giving themes resonate strongly now.');
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

    const prompt = `You are an expert social media strategist for Hong Kong and Greater Bay Area brands.

${layer1}

${layer2}

=== TASK: GENERATE EXACTLY 8 TOPIC SUGGESTIONS ===
Platform: ${platform}
${contentDirection ? 'Content Direction: ' + contentDirection : ''}

Mix angles across: Sales/Promotion, Education/Tips, Entertainment, Engagement, Seasonal/Trending, Daily Life, Habits/Routines.

CRITICAL: Use THIS EXACT FORMAT. Start directly with [Topic 1]. No intro text.

[Topic 1]
Angle: [angle name]
Title: [max 10 Chinese chars or 6 English words]
Description: [1-2 sentences explaining why this topic works for this client on this platform]

[Topic 2]
Angle: [angle name]
Title: [max 10 Chinese chars or 6 English words]
Description: [1-2 sentences]

[Topic 3]
Angle: [angle name]
Title: [max 10 Chinese chars or 6 English words]
Description: [1-2 sentences]

[Topic 4]
Angle: [angle name]
Title: [max 10 Chinese chars or 6 English words]
Description: [1-2 sentences]

[Topic 5]
Angle: [angle name]
Title: [max 10 Chinese chars or 6 English words]
Description: [1-2 sentences]

[Topic 6]
Angle: [angle name]
Title: [max 10 Chinese chars or 6 English words]
Description: [1-2 sentences]

[Topic 7]
Angle: [angle name]
Title: [max 10 Chinese chars or 6 English words]
Description: [1-2 sentences]

[Topic 8]
Angle: [angle name]
Title: [max 10 Chinese chars or 6 English words]
Description: [1-2 sentences]`;

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

    const variationFormat = platforms.map((p, i) =>
      `[Variation ${i + 1}] (${p.toUpperCase()})\n[Write ${p} content here following the rules above]`
    ).join('\n\n');

    const prompt = `You are an expert social media content writer for Hong Kong and Greater Bay Area brands.

${layer1}

${layer2}

${layer3 ? layer3 + '\n\n' : ''}=== CONTENT GENERATION TASK ===
Topic: "${topic}"
Platforms: ${platforms.join(', ')}

Generate ONE content variation per platform (${platforms.length} total).
Each variation must:
- Follow that platform's rules exactly
- Sound like a real human wrote it — not AI
- Match the brand tone precisely
- Use a different hook/angle from each other

OUTPUT FORMAT — use exactly as shown:
${variationFormat}`;

    const result = await callAI(prompt, 4000);
    res.json({ success: true, text: result.text, provider: result.provider });
  } catch (err) {
    console.error('Generate error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Flux running on port ${PORT} | Claude: ${process.env.ANTHROPIC_API_KEY ? 'YES' : 'NO'} | Gemini: ${process.env.GEMINI_API_KEY ? 'YES' : 'NO'}`);
});
