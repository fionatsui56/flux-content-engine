const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ─── KEEP-ALIVE: prevents Render free tier cold start ───────────────────────
app.get('/ping', (req, res) => {
  res.json({ status: 'alive', time: new Date().toISOString() });
});

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ 
    service: 'Flux Strategy Content Engine',
    status: 'running',
    ai: process.env.ANTHROPIC_API_KEY ? 'claude' : process.env.GEMINI_API_KEY ? 'gemini' : 'no-key'
  });
});

// ─── CORE: call Claude (primary) or Gemini (fallback) ────────────────────────
async function callAI(prompt, maxTokens = 2000) {
  
  // Try Claude first
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
      
      if (data.error) {
        console.error('Claude error:', data.error.message);
        // Fall through to Gemini
      } else {
        return { text: data.content[0].text, provider: 'claude' };
      }
    } catch (err) {
      console.error('Claude fetch failed:', err.message);
      // Fall through to Gemini
    }
  }

  // Fallback to Gemini
  if (process.env.GEMINI_API_KEY) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: maxTokens }
          })
        }
      );
      
      const data = await response.json();
      
      if (data.error) throw new Error(data.error.message);
      
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('No content from Gemini');
      
      return { text, provider: 'gemini' };
    } catch (err) {
      console.error('Gemini fetch failed:', err.message);
      throw new Error('Both Claude and Gemini failed: ' + err.message);
    }
  }

  throw new Error('No API key configured. Please set ANTHROPIC_API_KEY in Render environment variables.');
}

// ─── ENDPOINT: Generate Topic Suggestions ─────────────────────────────────────
app.post('/api/topics', async (req, res) => {
  try {
    const { clientName, industry, tone, brandStory, targetAudience, competitors, platform, language, contentDirection } = req.body;

    const langMap = { tc: 'Traditional Chinese (繁體中文)', sc: 'Simplified Chinese (簡體中文)', en: 'English' };
    const langName = langMap[language] || 'Traditional Chinese';

    const prompt = `Generate 8 social media content topic suggestions for ${clientName}.

CLIENT INFO:
Industry: ${industry || 'General'}
Brand Tone: ${tone || 'Professional'}
${brandStory ? `Brand Story: ${brandStory}` : ''}
${targetAudience ? `Target Audience: ${targetAudience}` : ''}
${competitors ? `Competitors: ${competitors}` : ''}
${contentDirection ? `Content Direction: ${contentDirection}` : ''}

Platform: ${platform || 'General'}
Output Language: ${langName}

Generate exactly 8 topics using these 7 angles (mix them):
1. Sales/Promotion
2. Education/Tips
3. Entertainment/Fun
4. Engagement/Interaction
5. Seasonal/Trending
6. Daily Life/Relatable
7. Habits/Routines

Format EXACTLY like this for each:
[Topic 1]
Angle: [angle name]
Title: [concise title]
Description: [2 sentences why this topic works for this client on this platform]

[Topic 2]
...and so on until [Topic 8]`;

    const result = await callAI(prompt, 2000);
    res.json({ success: true, text: result.text, provider: result.provider });

  } catch (err) {
    console.error('Topics error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── ENDPOINT: Generate Content ───────────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  try {
    const { topic, clientName, industry, tone, brandStory, targetAudience, competitors, forbiddenWords, platforms, language } = req.body;

    const langMap = { tc: 'Traditional Chinese (繁體中文)', sc: 'Simplified Chinese (簡體中文)', en: 'English' };
    const langName = langMap[language] || 'Traditional Chinese';

    const prompt = `Generate 5 creative social media content variations for: "${topic}"

BRAND INFORMATION:
Client: ${clientName}
Industry: ${industry || 'General'}
Brand Tone: ${tone}
${brandStory ? `Brand Story: ${brandStory}` : ''}
${targetAudience ? `Target Audience: ${targetAudience}` : ''}
${competitors ? `Competitors to avoid mentioning: ${competitors}` : ''}
${forbiddenWords ? `FORBIDDEN WORDS (never use these): ${forbiddenWords}` : ''}

Platforms: ${platforms ? platforms.join(', ') : 'General'}
Output Language: ${langName}

Requirements:
- Write all content in ${langName}
- Adapt tone and style for each platform
- Include relevant emojis
- Include 3-5 relevant hashtags per variation
- Each variation should have a different angle/approach

Format EXACTLY like this:
[Variation 1]
[content here]

[Variation 2]
[content here]

[Variation 3]
[content here]

[Variation 4]
[content here]

[Variation 5]
[content here]`;

    const result = await callAI(prompt, 2500);
    res.json({ success: true, text: result.text, provider: result.provider });

  } catch (err) {
    console.error('Generate error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Flux Content Engine running on port ${PORT}`);
  console.log(`AI Provider: ${process.env.ANTHROPIC_API_KEY ? 'Claude (primary)' : 'Gemini only'}`);
});
