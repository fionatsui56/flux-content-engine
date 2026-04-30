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
    'v1beta/models/gemini-2.5-flash-preview-04-17',
    'v1beta/models/gemini-2.0-flash-lite',
    'v1beta/models/gemini-1.5-flash',
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
    'v1beta/models/gemini-2.5-flash-preview-04-17',
    'v1beta/models/gemini-2.0-flash-lite',
    'v1beta/models/gemini-1.5-flash',
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

async function callAI(prompt, maxTokens = 2000) {
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
    const langMap = { tc: 'Traditional Chinese (繁體中文)', sc: 'Simplified Chinese (簡體中文)', en: 'English' };
    const langName = langMap[language] || 'Traditional Chinese';
    const prompt = `Generate 8 social media content topic suggestions for ${clientName}.
CLIENT INFO:
Industry: ${industry || 'General'} | Brand Tone: ${tone || 'Professional'}
${brandStory ? `Brand Story: ${brandStory}` : ''}
${targetAudience ? `Target Audience: ${targetAudience}` : ''}
${competitors ? `Competitors: ${competitors}` : ''}
${contentDirection ? `Content Direction: ${contentDirection}` : ''}
Platform: ${platform || 'General'} | Output Language: ${langName}
Generate exactly 8 topics using these angles (mix them): Sales/Promotion, Education/Tips, Entertainment/Fun, Engagement/Interaction, Seasonal/Trending, Daily Life/Relatable, Habits/Routines
Format EXACTLY:
[Topic 1]
Angle: [angle]
Title: [title]
Description: [2 sentences]
[Topic 2]...until [Topic 8]`;
    const result = await callAI(prompt, 2000);
    res.json({ success: true, text: result.text, provider: result.provider });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/generate', async (req, res) => {
  try {
    const { topic, clientName, industry, tone, brandStory, targetAudience, competitors, forbiddenWords, platforms, language } = req.body;
    const langMap = { tc: 'Traditional Chinese (繁體中文)', sc: 'Simplified Chinese (簡體中文)', en: 'English' };
    const langName = langMap[language] || 'Traditional Chinese';
    const prompt = `Generate 5 creative social media content variations for: "${topic}"
BRAND: ${clientName} | Industry: ${industry || 'General'} | Tone: ${tone}
${brandStory ? `Brand Story: ${brandStory}` : ''}
${targetAudience ? `Target Audience: ${targetAudience}` : ''}
${forbiddenWords ? `FORBIDDEN WORDS: ${forbiddenWords}` : ''}
Platforms: ${platforms ? platforms.join(', ') : 'General'} | Output Language: ${langName}
Write all content in ${langName}. Include emojis and 3-5 hashtags. Each variation different angle.
Format:
[Variation 1]
[content]
[Variation 2]
[content]
[Variation 3]
[content]
[Variation 4]
[content]
[Variation 5]
[content]`;
    const result = await callAI(prompt, 2500);
    res.json({ success: true, text: result.text, provider: result.provider });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.listen(PORT, () => {
  console.log(`Flux running on port ${PORT} | Claude: ${process.env.ANTHROPIC_API_KEY ? 'YES' : 'NO'} | Gemini: ${process.env.GEMINI_API_KEY ? 'YES' : 'NO'}`);
});
