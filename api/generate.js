export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { ilju, shiju, birth, gender, vibes, custom } = req.body;

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const OPENAI_KEY    = process.env.OPENAI_API_KEY;

  if (!ANTHROPIC_KEY || !OPENAI_KEY) {
    return res.status(500).json({ error: 'API 키가 서버에 설정되지 않았어요.' });
  }

  try {
    const vibeStr   = vibes.join(', ');
    const customStr = custom ? `\n사용자 추가 취향: ${custom}` : '';
    const timeStr   = (birth.h !== null && birth.h !== undefined)
      ? `${birth.h}시 ${birth.min || 0}분`
      : '시간 모름';
    const calStr = birth.calType === 'lunar' ? '음력' : '양력';

    // ── 1. Claude: 사주 분석 + 이미지 프롬프트 생성 ──
    const sajuPrompt = `당신은 사주명리학 전문가이자 AI 이미지 프롬프트 전문가입니다.
아래 사주 정보를 바탕으로 이상형을 분석하고, DALL-E 3이 최고 퀄리티 실사 이미지를 생성할 수 있는 상세한 프롬프트를 만들어주세요.

[사주 정보]
생년월일: ${calStr} ${birth.y}년 ${birth.m}월 ${birth.d}일
출생 시간: ${timeStr}
일주: ${ilju.일주} (${ilju.설명})
원하는 성별: ${gender}
원하는 분위기: ${vibeStr}${customStr}

[이미지 프롬프트 작성 규칙]
- 반드시 영어로 작성
- 아래 구조를 반드시 포함:
  1) 기본 설정: "A photorealistic portrait photograph of a strikingly handsome Korean man in his late 20s"
  2) 얼굴 특징: 눈, 코, 입술, 턱선, 피부를 구체적으로 (예: sharp double eyelids, high nose bridge, defined jawline, glass skin)
  3) 분위기 키워드: 요청된 분위기를 영어로 반영
  4) 촬영 스타일: "shot on Sony A7R IV, 85mm f/1.4 lens, professional studio lighting with soft rim light, shallow depth of field, bokeh background"
  5) 품질 키워드: "hyperrealistic, 8K resolution, award-winning portrait photography, magazine cover quality, ultra-detailed skin texture"
  6) 스타일: "Korean celebrity style, similar to high-end fashion magazine editorial"
- 절대 포함 금지: cartoon, anime, illustration, painting, drawing, CGI
- 얼굴 클로즈업 위주로 (shoulders and above)
- 프롬프트 길이: 200단어 이내

다음 JSON 형식으로만 답변하세요. 마크다운 없이 순수 JSON만:
{
  "title": "사주 감성 담긴 이상형 제목 (15자 이내, 한국어)",
  "description": "이 일주의 사주 특성과 연결된 이상형 설명 (120자 이내, 감성적이고 시적으로, 한국어)",
  "imagePrompt": "위 규칙대로 작성한 DALL-E 3 영어 프롬프트"
}`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        messages: [{ role: 'user', content: sajuPrompt }]
      })
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.json();
      throw new Error(err.error?.message || 'Claude API 오류');
    }

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content[0].text.trim();
    const cleanText = rawText.replace(/```json|```/g, '').trim();
    const saju = JSON.parse(cleanText);

    // ── 2. 이미지 프롬프트 품질 보강 (고정 suffix 추가) ──
    const qualitySuffix = [
      'The subject has flawless Korean celebrity-level visuals,',
      'perfectly symmetrical face, natural skin texture with visible pores,',
      'authentic human appearance, NOT AI-generated looking, NOT plastic or waxy,',
      'professional portrait lighting, cinematic color grading,',
      'the kind of face that would appear on the cover of Vogue Korea or GQ Korea.',
      'Ultra-photorealistic, indistinguishable from a real photograph.'
    ].join(' ');

    const finalPrompt = `${saju.imagePrompt} ${qualitySuffix}`;

    // ── 3. DALL-E 3 이미지 생성 (HD 퀄리티) ──
    const dalleRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: finalPrompt,
        n: 1,
        size: '1024x1792',   // 세로형 (인물 비율에 최적)
        quality: 'hd',        // standard → hd 로 업그레이드
        style: 'natural'      // vivid 말고 natural (실사에 더 적합)
      })
    });

    if (!dalleRes.ok) {
      const err = await dalleRes.json();
      throw new Error(err.error?.message || 'DALL-E API 오류');
    }

    const dalleData = await dalleRes.json();
    const imageUrl = dalleData.data[0].url;

    return res.status(200).json({ saju, imageUrl });

  } catch (err) {
    console.error('generate error:', err);
    return res.status(500).json({ error: err.message });
  }
}
