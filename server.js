const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

app.get('/ping', (req, res) => res.json({ status: 'alive', time: new Date().toISOString() }));
app.get('/', (req, res) => res.json({ service: 'Flux Strategy Content Engine', status: 'running' }));

// LIST all available models for this API key
app.get('/list-models', async (req, res) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.json({ error: 'No GEMINI_API_KEY' });
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    const d = await r.json();
    if (d.error) return res.json({ error: d.error.message });
    const names = (d.models || [])
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => m.name);
    res.json({ available_models: names });
  } catch(e) { res.json({ error: e.message }); }
});

app.get('/test-gemini', async (req, res) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.json({ error: 'No GEMINI_API_KEY' });
  const candidates = [
    'v1beta/models/gemini-2.5-flash',
    'v1beta/models/gemini-flash-latest',
    'v1beta/models/gemini-flash-lite-latest',
    'v1/models/gemini-1.5-flash',
    'v1beta/models/gemini-1.5-pro',
    'v1/models/gemini-1.5-pro',
  ];
  const results = [];
  for (const model of candidates) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/${model}:generateContent?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'Say hi' }] }] }) }
      );
      const d = await r.json();
      if (d.error) results.push({ model, status: 'FAIL', error: d.error.message });
      else results.push({ model, status: 'OK', text: d.candidates?.[0]?.content?.parts?.[0]?.text });
    } catch (e) { results.push({ model, status: 'ERROR', error: e.message }); }
  }
  res.json({ results });
});

async function callGemini(prompt, maxTokens) {
  const key = process.env.GEMINI_API_KEY;
  const models = [
    'v1beta/models/gemini-2.5-flash',
    'v1beta/models/gemini-flash-latest',
    'v1beta/models/gemini-flash-lite-latest',
    'v1/models/gemini-1.5-flash',
    'v1beta/models/gemini-1.5-pro',
  ];
  for (const model of models) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/${model}:generateContent?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens } }) }
      );
      const d = await r.json();
      if (d.error) { console.log(`Gemini ${model} failed: ${d.error.message}`); continue; }
      const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) continue;
      console.log(`Gemini OK: ${model}`);
      return { text, provider: 'gemini' };
    } catch (e) { console.log(`Gemini ${model} error: ${e.message}`); continue; }
  }
  throw new Error('All Gemini models failed. Visit /list-models to see available models.');
}

async function callAI(prompt, maxTokens = 3000) {
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

app.post('/api/topics', async (req, res) => {
  try {
    const { clientName, industry, tone, brandStory, targetAudience, competitors, platform, language, contentDirection } = req.body;
    const langMap = { 
    tc: 'Traditional Chinese (繁體中文) — use Hong Kong Chinese expressions and style', 
    sc: 'Simplified Chinese — write in authentic Mainland China style, use Mainland Chinese vocabulary, expressions, and tone native to platforms like WeChat and XiaoHongShu. Avoid Hong Kong or Taiwan expressions entirely.', 
    en: 'English' 
  };
    const langName = langMap[language] || 'Traditional Chinese';
    const prompt = `Generate 8 social media content topic suggestions for ${clientName}.
CLIENT INFO:
Industry: ${industry || 'General'} | Brand Tone: ${tone || 'Professional'}
${brandStory ? `Brand Story: ${brandStory}` : ''}
${targetAudience ? `Target Audience: ${targetAudience}` : ''}
${competitors ? `Competitors: ${competitors}` : ''}
${contentDirection ? `Content Direction: ${contentDirection}` : ''}
Platform: ${platform || 'General'} | Output Language: ${langName}
OUTPUT ONLY THE 8 TOPICS BELOW. NO introduction sentence. NO conclusion. START DIRECTLY WITH [Topic 1].

Generate EXACTLY 8 topics. Use these angles (mix them): Sales/Promotion, Education/Tips, Entertainment/Fun, Engagement/Interaction, Seasonal/Trending, Daily Life/Relatable, Habits/Routines.

YOU MUST OUTPUT ALL 8 TOPICS. Format each topic EXACTLY like this with no deviation:

[Topic 1]
Angle: [angle name]
Title: [topic title]
Description: [2 sentences explaining why this works]

[Topic 2]
Angle: [angle name]
Title: [topic title]
Description: [2 sentences explaining why this works]

[Topic 3]
Angle: [angle name]
Title: [topic title]
Description: [2 sentences explaining why this works]

[Topic 4]
Angle: [angle name]
Title: [topic title]
Description: [2 sentences explaining why this works]

[Topic 5]
Angle: [angle name]
Title: [topic title]
Description: [2 sentences explaining why this works]

[Topic 6]
Angle: [angle name]
Title: [topic title]
Description: [2 sentences explaining why this works]

[Topic 7]
Angle: [angle name]
Title: [topic title]
Description: [2 sentences explaining why this works]

[Topic 8]
Angle: [angle name]
Title: [topic title]
Description: [2 sentences explaining why this works]`;
    const result = await callAI(prompt, 2000);
    res.json({ success: true, text: result.text, provider: result.provider });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/generate', async (req, res) => {
  try {
    const { topic, clientName, industry, tone, brandStory, targetAudience, competitors, forbiddenWords, platforms, language } = req.body;
    const langMap = { 
    tc: 'Traditional Chinese (繁體中文) — use Hong Kong Chinese expressions and style', 
    sc: 'Simplified Chinese — write in authentic Mainland China style, use Mainland Chinese vocabulary, expressions, and tone native to platforms like WeChat and XiaoHongShu. Avoid Hong Kong or Taiwan expressions entirely.', 
    en: 'English' 
  };
    const langName = langMap[language] || 'Traditional Chinese';
    // Platform style guide
    const platformStyles = {
      facebook: 'Facebook: Longer captions OK (100-300 words). Conversational, storytelling tone. 2-3 hashtags max. Good for educational and sharing content. Start with a hook question or bold statement.',
      instagram: 'Instagram: Short punchy caption (50-150 words). Heavy emojis. 5-10 hashtags. Visual-first mindset. First line must be attention-grabbing. Line breaks for readability.',
      threads: 'Threads: Very short and conversational (under 100 words). Opinion-based or thought-provoking. 0-3 hashtags. Casual tone like talking to a friend.',
      linkedin: 'LinkedIn: Professional tone. 150-300 words. Structured with clear paragraphs. 3-5 hashtags. Include industry insight or data. End with a question to drive comments.',
      xiaohongshu: '小紅書 XiaoHongShu: Use 【】for title. Authentic lifestyle tone. 200-400 words. 8-15 hashtags mixing Chinese and English. Use Mainland Chinese expressions. Include personal experience angle. Emoji after each key point.',
      wechat: 'WeChat 微信: Warm and trustworthy tone. 150-300 words. Practical and informative. 0-3 hashtags. Focus on value and usefulness. Suitable for sharing in groups.'
    };

    const selectedPlatforms = platforms || ['general'];
    const platformInstructions = selectedPlatforms.map(p => platformStyles[p] || p).join('
');

    const prompt = `Generate ONE content variation for EACH of the following platforms for the topic: "${topic}"

BRAND INFORMATION:
Client: ${clientName}
Industry: ${industry || 'General'}
Brand Tone: ${tone}
${brandStory ? `Brand Story: ${brandStory}` : ''}
${targetAudience ? `Target Audience: ${targetAudience}` : ''}
${forbiddenWords ? `FORBIDDEN WORDS - never use these: ${forbiddenWords}` : ''}

Output Language: ${langName}
Write ALL content in ${langName} only.
CRITICAL: Do NOT use any markdown formatting. No **, no ##, no __, no ---. Do not write 标题: or 内容: labels. Write pure plain text content directly.

PLATFORM STYLE RULES (follow strictly for each platform):
${platformInstructions}

YOU MUST OUTPUT ONE VARIATION PER PLATFORM. Use this EXACT format:

${selectedPlatforms.map((p, i) => `[Variation ${i+1}] (${p.toUpperCase()})
[Write ${p} content here following the style rules above]`).join('

')}
`;
    const result = await callAI(prompt, 3500);
    res.json({ success: true, text: result.text, provider: result.provider });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.listen(PORT, () => {
  console.log(`Flux running on port ${PORT} | Claude: ${process.env.ANTHROPIC_API_KEY ? 'YES' : 'NO'} | Gemini: ${process.env.GEMINI_API_KEY ? 'YES' : 'NO'}`);
});
