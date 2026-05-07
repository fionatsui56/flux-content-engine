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

// Test Gemini models
app.get('/test-gemini', async (req, res) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.json({ error: 'No GEMINI_API_KEY' });
  const candidates = [
    'v1beta/models/gemini-2.5-flash-preview-04-17',
    'v1beta/models/gemini-2.0-flash-lite',
    'v1beta/models/gemini-1.5-flash',
    'v1/models/gemini-1.5-flash',
  ];
  const results = [];
  for (const model of candidates) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/${model}:generateContent?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Say hi' }] }] })
      });
      const d = await r.json();
      if (d.error) results.push({ model, status: 'FAIL', error: d.error.message });
      else results.push({ model, status: 'OK', text: d.candidates?.[0]?.content?.parts?.[0]?.text });
    } catch (e) { results.push({ model, status: 'ERROR', error: e.message }); }
  }
  res.json({ results });
});

// List available models
app.get('/list-models', async (req, res) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.json({ error: 'No GEMINI_API_KEY' });
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    const d = await r.json();
    if (d.error) return res.json({ error: d.error.message });
    const names = (d.models || []).filter(m => m.supportedGenerationMethods?.includes('generateContent')).map(m => m.name);
    res.json({ available_models: names });
  } catch(e) { res.json({ error: e.message }); }
});

// Call Gemini with multi-model fallback
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

// Main AI caller - Claude primary, Gemini fallback
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

// TOPICS endpoint
app.post('/api/topics', async (req, res) => {
  try {
    const { clientName, industry, tone, brandStory, targetAudience, platform, language, contentDirection } = req.body;
    const langMap = {
      tc: 'Traditional Chinese (Hong Kong). Match register to brand tone: professional/educational = formal written Chinese (書面語); casual/energetic = natural HK conversational style; luxury = elegant formal Chinese. NEVER mix registers. NEVER use Taiwan expressions.',
      sc: 'Simplified Chinese - AUTHENTIC Mainland China style, native to WeChat and XiaoHongShu. No HK or Taiwan expressions.',
      en: 'Hong Kong Business English — clear, direct, professional but not stiff.'
    };
    const langName = langMap[language] || langMap.tc;

    const prompt = `Generate 8 social media topics for ${clientName} (${industry || 'General'}, ${tone} tone).
${brandStory ? 'Brand: ' + brandStory.substring(0, 100) : ''}
${targetAudience ? 'Audience: ' + targetAudience.substring(0, 80) : ''}
${contentDirection ? 'Direction: ' + contentDirection : ''}
Platform: ${platform} | Language: ${langName}

OUTPUT ONLY 8 TOPICS. NO intro text. Start directly with [Topic 1].
Angles to mix: Sales, Education, Entertainment, Engagement, Seasonal, Daily Life, Habits.

[Topic 1]
Angle: [angle]
Title: [max 10 Chinese chars or 6 English words]
Description: [1-2 sentences]

[Topic 2]
Angle: [angle]
Title: [max 10 Chinese chars or 6 English words]
Description: [1-2 sentences]

[Topic 3]
Angle: [angle]
Title: [max 10 Chinese chars or 6 English words]
Description: [1-2 sentences]

[Topic 4]
Angle: [angle]
Title: [max 10 Chinese chars or 6 English words]
Description: [1-2 sentences]

[Topic 5]
Angle: [angle]
Title: [max 10 Chinese chars or 6 English words]
Description: [1-2 sentences]

[Topic 6]
Angle: [angle]
Title: [max 10 Chinese chars or 6 English words]
Description: [1-2 sentences]

[Topic 7]
Angle: [angle]
Title: [max 10 Chinese chars or 6 English words]
Description: [1-2 sentences]

[Topic 8]
Angle: [angle]
Title: [max 10 Chinese chars or 6 English words]
Description: [1-2 sentences]`;

    const result = await callAI(prompt, 2000);
    res.json({ success: true, text: result.text, provider: result.provider });
  } catch (err) {
    console.error('Topics error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GENERATE endpoint
app.post('/api/generate', async (req, res) => {
  try {
    const { topic, clientName, industry, tone, brandStory, targetAudience, forbiddenWords, platforms, language } = req.body;

    const langMap = {
      tc: 'Traditional Chinese (Hong Kong). Match register to brand tone: professional/educational = formal written Chinese (書面語) e.g. 「我們提供⋯」「協助您⋯」; casual/energetic = natural HK conversational style e.g. 「搞掂！」「係咁先！」; luxury = elegant formal Chinese e.g. 「臻選」「尊享」. NEVER mix registers. NEVER use Taiwan expressions (棒、哦、超級、讚).',
      sc: 'Simplified Chinese - AUTHENTIC Mainland China style, native to WeChat and XiaoHongShu. No HK or Taiwan expressions. Use 很棒 not 好正; 没问题 not 冇問題; 真的 not 真係.',
      en: 'Hong Kong Business English. Clear, direct, professional but not stiff. NOT American English (no gonna/wanna). LinkedIn: Hook → Evidence → Insight → Question structure. Instagram/Threads: short punchy sentences. Always vary sentence length.'
    };
    const langName = langMap[language] || langMap.tc;

    // Detect seasonal context from topic
    const topicLower = topic.toLowerCase();
    let contentDirectionHint = '';
    const emotionalKeys = ['母親節','父親節','情人節','christmas','聖誕','valentine','中秋','新年','cny','感恩'];
    const promoKeys = ['雙十一','11.11','618','black friday','singles day','促銷','優惠','sale'];
    const culturalKeys = ['清明','重陽','端午','中秋','佛誕','dragon boat','mid-autumn'];
    const bizKeys = ['財年','quarterly','budget','q1','q2','q3','q4','strategy','annual'];
    if (emotionalKeys.some(k => topicLower.includes(k))) {
      contentDirectionHint = 'SEASONAL NOTE: Emotional/festive occasion — prioritise warmth and personal connection. Avoid hard-sell language.';
    } else if (promoKeys.some(k => topicLower.includes(k))) {
      contentDirectionHint = 'SEASONAL NOTE: Major promotional season — sales-driven but must feel authentic, not like a pure ad.';
    } else if (culturalKeys.some(k => topicLower.includes(k))) {
      contentDirectionHint = 'SEASONAL NOTE: Cultural festival — lead with cultural meaning before any brand message.';
    } else if (bizKeys.some(k => topicLower.includes(k))) {
      contentDirectionHint = 'SEASONAL NOTE: Business/professional context — thought leadership tone, lead with insight or data.';
    }

    const platformStyles = {
      facebook: `Facebook: 100-200 words. Conversational storytelling. 2-3 hashtags.
HOOK (pick one): Counter-intuitive statement | Pain-point question | Number opener ("3 reasons...") | Story opener
CTA: Specific comment-driving question | "Tag someone who needs this" | "Save this post"`,

      instagram: `Instagram: 50-100 words. Hook MUST land within first 125 characters. Heavy emojis. 5-10 hashtags. Line breaks between sentences.
HOOK (pick one): Bold statement | Data drop | Pain point | Contrast ("Before vs After")
CTA: Drive SAVES ("Save this for later") or SHARES — algorithm prioritises saves+shares over likes in 2025-26.`,

      threads: `Threads: Under 80 words. Sound like talking to a friend. 0-3 hashtags.
HOOK: Direct opinion | Casual observation | Relatable moment
CTA: Soft question or light provocation that invites replies. Never corporate tone.`,

      linkedin: `LinkedIn: 150-250 words. Hook in first 210 characters (before "see more"). Personal voice beats brand voice. 3-5 hashtags.
HOOK (pick one): Number + insight | Personal story | Industry observation | Bold question
STRUCTURE: Hook → Expand (2-3 sentences) → Key insight → Closing question
CTA: Genuine discussion question at the end.`,

      xiaohongshu: `小紅書: 150-250 words. Title in 【】brackets. Hook must grab in 3 seconds. 8-15 hashtags Chinese/English mix. Emoji after key points. MAINLAND CHINESE only.
HOOK: 數字型 "5個方法讓你⋯" | 疑問型 "為什麼你的XX總是失敗？" | 對比型 "用了這個之後再也回不去了"
STYLE: 種草 mindset — friend sharing a discovery, NOT an advertisement.
CTA: Drive 收藏 (saves). Soft interactive question at end.
RULES: No 最/第一/唯一. No guarantee language. No false urgency.`,

      wechat: `微信朋友圈: 80-150 words. Warm and personal like sharing with close friends. NO hashtags. First-person. MAINLAND CHINESE only.
HOOK: Warm personal opening that feels like a private thought being shared.
CTA: Soft closing question e.g. 「你呢？」「你也有這種感覺嗎？」— never a hard sell.
RULES: No superlatives. No promotional language. No hashtags. No links.`
    };

    const selectedPlatforms = (platforms && platforms.length) ? platforms : ['general'];
    const platformInstructions = selectedPlatforms.map(p => platformStyles[p] || p).join('\n');

    const variationFormat = selectedPlatforms.map((p, i) =>
      `[Variation ${i + 1}] (${p.toUpperCase()})\n[Write ${p} content here]`
    ).join('\n\n');

    const prompt = `Generate ONE content variation for EACH platform for topic: "${topic}"

BRAND:
Client: ${clientName} | Industry: ${industry || 'General'} | Tone: ${tone}
${brandStory ? 'Brand story: ' + brandStory.substring(0, 150) : ''}
${targetAudience ? 'Audience: ' + targetAudience.substring(0, 100) : ''}
${forbiddenWords ? 'FORBIDDEN WORDS (never use): ' + forbiddenWords : ''}
${contentDirectionHint ? contentDirectionHint : ''}

Output Language: ${langName}

CRITICAL WRITING RULES:
- No markdown. No **, no ##. Plain text only.
- Write like a REAL HUMAN. NEVER use: "In conclusion", "It is worth noting", "Dive into", "Game-changer", "Unlock your potential", "Leverage", "Empower", "Ecosystem", "Synergy", "Paradigm".
- Vary sentence length — short sentences and longer ones mixed together.
- Include specific details, not generic statements.
- Chinese content: match tone to brand personality as specified in language rules above.
- English content: HK Business English — clear, direct, not stiff. Vary structure per platform.

PLATFORM RULES (follow strictly):
${platformInstructions}

OUTPUT FORMAT - generate exactly ${selectedPlatforms.length} variation(s):
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
