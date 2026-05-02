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
      tc: 'Traditional Chinese (Hong Kong). Adjust register based on brand tone: if tone is professional/trustworthy/educational, use formal written Chinese (書面語); if tone is casual/energetic, use natural HK conversational style with local expressions; if tone is luxury, use elegant formal Chinese. Never mix styles.',
      sc: 'Simplified Chinese - use authentic Mainland China style, WeChat/XiaoHongShu native tone. No HK expressions.',
      en: 'English'
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
      tc: 'Traditional Chinese (Hong Kong). Adjust register based on brand tone: if tone is professional/trustworthy/educational, use formal written Chinese (書面語); if tone is casual/energetic, use natural HK conversational style with local expressions; if tone is luxury, use elegant formal Chinese. Never mix styles.',
      sc: 'Simplified Chinese - use authentic Mainland China style, native to WeChat and XiaoHongShu. No HK or Taiwan expressions.',
      en: 'English'
    };
    const langName = langMap[language] || langMap.tc;

    const platformStyles = {
      facebook: 'Facebook: 100-200 words. Conversational storytelling. 2-3 hashtags. Start with hook.',
      instagram: 'Instagram: 50-100 words. Heavy emojis. 5-10 hashtags. Punchy first line. Line breaks.',
      threads: 'Threads: Under 80 words. Casual opinion. 0-3 hashtags.',
      linkedin: 'LinkedIn: 150-250 words. Professional tone. 3-5 hashtags. End with question.',
      xiaohongshu: '小紅書: Use [title] in 【】. 150-250 words. Lifestyle authentic tone. 8-15 hashtags mixing Chinese/English. Mainland Chinese expressions. Emoji after key points.',
      wechat: '微信朋友圈: 80-150 words. Warm personal tone like sharing with friends. NO hashtags. First-person. End with soft question.'
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

Output Language: ${langName}
CRITICAL WRITING RULES:
- No markdown formatting. No **, no ##. Plain text only.
- Write like a REAL HUMAN, not an AI. Avoid AI-sounding phrases like "In conclusion", "It is worth noting", "Dive into", "Game-changer", "Unlock your potential".
- Use natural conversational language matching the brand tone.
- Vary sentence length. Include specific details, not generic statements.
- For Chinese content: use natural spoken expressions, not formal written Chinese.

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
