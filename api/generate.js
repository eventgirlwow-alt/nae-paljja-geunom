export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { ilju, shiju, birth, gender, vibes, custom } = req.body;
  const OPENAI_KEY = process.env.OPENAI_API_KEY;

  if (!OPENAI_KEY) {
    return res.status(500).json({ error: 'API 키가 서버에 설정되지 않았어요.' });
  }

  try {
    const vibeStr   = vibes.join(', ');
    const customStr = custom ? '\n추가 취향: ' + custom : '';
    const timeStr   = (birth.h !== null && birth.h !== undefined)
      ? birth.h + '시 ' + (birth.min || 0) + '분'
      : '시간 모름';
    const calStr = birth.calType === 'lunar' ? '음력' : '양력';

    // ── GPT-4o로 사주 분석 + 이미지 프롬프트 생성 ──
    const sajuPrompt = '당신은 사주명리학 전문가이자 AI 이미지 프롬프트 전문가입니다.\n'
      + '아래 사주 정보를 바탕으로 이상형을 분석하고, DALL-E 3이 최고 퀄리티 실사 이미지를 생성할 수 있는 상세한 프롬프트를 만들어주세요.\n\n'
      + '[사주 정보]\n'
      + '생년월일: ' + calStr + ' ' + birth.y + '년 ' + birth.m + '월 ' + birth.d + '일\n'
      + '출생 시간: ' + timeStr + '\n'
      + '일주: ' + ilju.일주 + ' (' + ilju.설명 + ')\n'
      + '원하는 성별: ' + gender + '\n'
      + '선택한 기운: ' + vibeStr
      + customStr + '\n\n'
      + '[이미지 프롬프트 작성 규칙]\n'
      + '- 반드시 영어로 작성\n'
      + '- "A photorealistic portrait photograph of a strikingly handsome Korean man in his late 20s" 로 시작\n'
      + '- 얼굴 특징 구체적으로: 눈, 코, 입술, 턱선, 피부\n'
      + '- 선택된 기운과 분위기를 영어로 반영\n'
      + '- 촬영 스타일 포함: "shot on Sony A7R IV, 85mm f/1.4 lens, professional studio lighting, shallow depth of field"\n'
      + '- 품질 키워드 포함: "hyperrealistic, 8K, award-winning portrait photography, magazine cover quality"\n'
      + '- 절대 금지: cartoon, anime, illustration, painting, CGI\n'
      + '- 200단어 이내\n\n'
      + '다음 JSON 형식으로만 답변하세요. 마크다운 없이 순수 JSON만:\n'
      + '{"title":"이상형 제목 (15자 이내 한국어)","description":"사주 특성 반영한 이상형 설명 (120자 이내 한국어, 감성적으로)","imagePrompt":"DALL-E 3용 영어 프롬프트"}';

    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + OPENAI_KEY
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 1200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '당신은 사주명리학 전문가입니다. 반드시 JSON만 반환하세요.' },
          { role: 'user', content: sajuPrompt }
        ]
      })
    });

    if (!gptRes.ok) {
      const err = await gptRes.json();
      throw new Error(err.error && err.error.message ? err.error.message : 'GPT API 오류');
    }

    const gptData = await gptRes.json();
    const saju = JSON.parse(gptData.choices[0].message.content);

    // ── DALL-E 3 이미지 생성 ──
    const qualitySuffix = 'The subject has flawless Korean celebrity-level visuals, '
      + 'perfectly symmetrical face, natural skin texture, '
      + 'authentic human appearance, NOT AI-generated looking, '
      + 'professional portrait lighting, cinematic color grading, '
      + 'the kind of face that would appear on the cover of Vogue Korea or GQ Korea. '
      + 'Ultra-photorealistic, indistinguishable from a real photograph.';

    const finalPrompt = saju.imagePrompt + ' ' + qualitySuffix;

    const dalleRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + OPENAI_KEY
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: finalPrompt,
        n: 1,
        size: '1024x1792',
        quality: 'hd',
        style: 'natural'
      })
    });

    if (!dalleRes.ok) {
      const err = await dalleRes.json();
      throw new Error(err.error && err.error.message ? err.error.message : 'DALL-E API 오류');
    }

    const dalleData = await dalleRes.json();
    const imageUrl = dalleData.data[0].url;

    return res.status(200).json({ saju: saju, imageUrl: imageUrl });

  } catch (err) {
    console.error('generate error:', err);
    return res.status(500).json({ error: err.message });
  }
}
