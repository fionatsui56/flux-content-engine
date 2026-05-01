const prompt = `Generate 8 social media topics for ${clientName} (${industry||'General'}, ${tone}).
${brandStory ? 'Brand: '+brandStory.substring(0,100) : ''}
${targetAudience ? 'Audience: '+targetAudience.substring(0,80) : ''}
${contentDirection ? 'Direction: '+contentDirection : ''}
Platform: ${platform} | Language: ${langName}

OUTPUT ONLY 8 TOPICS. NO intro. Start with [Topic 1].
Angles: Sales, Education, Entertainment, Engagement, Seasonal, Daily Life, Habits.

[Topic 1]
Angle: [angle]
Title: [max 10 Chinese chars / 6 English words]
Description: [1-2 sentences]

[Topic 2]
Angle: [angle]
Title: [max 10 Chinese chars / 6 English words]
Description: [1-2 sentences]

[Topic 3]
Angle: [angle]
Title: [max 10 Chinese chars / 6 English words]
Description: [1-2 sentences]

[Topic 4]
Angle: [angle]
Title: [max 10 Chinese chars / 6 English words]
Description: [1-2 sentences]

[Topic 5]
Angle: [angle]
Title: [max 10 Chinese chars / 6 English words]
Description: [1-2 sentences]

[Topic 6]
Angle: [angle]
Title: [max 10 Chinese chars / 6 English words]
Description: [1-2 sentences]

[Topic 7]
Angle: [angle]
Title: [max 10 Chinese chars / 6 English words]
Description: [1-2 sentences]

[Topic 8]
Angle: [angle]
Title: [max 10 Chinese chars / 6 English words]
Description: [1-2 sentences]`;
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
      facebook: 'Facebook: 100-200 words. Conversational. 2-3 hashtags. Start with hook.',
      instagram: 'Instagram: 50-100 words. Heavy emojis. 5-10 hashtags. Punchy first line. Line breaks.',
      threads: 'Threads: Under 80 words. Casual opinion. 0-3 hashtags.',
      linkedin: 'LinkedIn: 150-250 words. Professional. 3-5 hashtags. End with question.',
      xiaohongshu: '小紅書: 【】title. 150-250 words. Lifestyle tone. 8-15 hashtags. Mainland Chinese. Emoji after key points.',
      wechat: '微信朋友圈: 80-150 words. Personal warm tone. NO hashtags. First-person. End with soft question.'
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
    const result = await callAI(prompt, 4000);
    res.json({ success: true, text: result.text, provider: result.provider });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.listen(PORT, () => {
  console.log(`Flux running on port ${PORT} | Claude: ${process.env.ANTHROPIC_API_KEY ? 'YES' : 'NO'} | Gemini: ${process.env.GEMINI_API_KEY ? 'YES' : 'NO'}`);
});
