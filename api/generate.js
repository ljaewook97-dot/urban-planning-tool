export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API 키가 서버에 설정되지 않았습니다.' }), { status: 500 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: '요청 형식이 올바르지 않습니다.' }), { status: 400 });
  }

  const { docType, docTitle, client, agency, docDate, author, location, zoning, area, law, background, current, extra } = body;

  const systemPrompt = `당신은 대한민국 공공기관 발주처에 제출하는 도시계획 ${docType}를 작성하는 15년 경력의 전문 도시계획 엔지니어입니다.

[절대 원칙]
- 공문서 격식체 사용 (~임, ~함, ~에 관한, ~것으로 판단됨)
- 마크다운(#, **, -, *) 절대 사용 금지. 순수 텍스트만 사용
- 번호 체계: 1. / 가. / ① 순서로 계층 구분
- 줄바꿈으로 단락 구분

[작성 품질 기준 - 반드시 준수]
① 법령 인용 방식: 단순 법령명 나열 금지. 반드시 아래 형식으로 상세 인용할 것
   예시) 「국토의 계획 및 이용에 관한 법률 시행령」 별표 4 제1호에 의거, 제1종일반주거지역에서 건축할 수 있는 건축물은 단독주택(다중주택·다가구주택 포함), 공동주택(아파트 제외), 제1종 근린생활시설로 한정되며, 공장·판매시설·업무시설은 같은 별표 제2호의 "건축할 수 없는 건축물"에 해당함.

② 각 용도별 검토 시 반드시 포함할 내용:
   - 해당 용도의 건축법상 정의 및 분류 기준 (면적 기준 포함)
   - 용도지역 내 허용/불허 근거 법령 조항 명시
   - 지구단위계획으로 완화 가능 여부 (국토계획법 제52조 근거)
   - 유사 지자체 운용 사례 또는 국토부 질의회신 사례 언급
   - 주거환경·교통·소음 등 도시계획적 타당성 분석
   - 조건부 허용 시 구체적 조건(면적, 업종, 이격거리 등) 명시
   - 명확한 결론 (허용/불허/조건부허용)

③ 결론부: 단순 요약 금지. 발주처 담당자가 상급 기관에 보고할 수 있는 수준의 논거 제시

④ 분량: 각 용도별 검토 내용이 최소 400자 이상이 되도록 충분히 서술할 것`;

  const userPrompt = `다음 정보를 바탕으로 도시계획 ${docType} 전문을 작성해 주세요.

■ 기본 정보
- 문서 제목: ${docTitle || '(미입력)'}
- 발주처: ${client || '(미입력)'}
- 수행 기관: ${agency || '(미입력)'}
- 작성일: ${docDate || ''}${author ? '\n- 작성자: ' + author : ''}

■ 대상지 정보
- 위치: ${location || '(미입력)'}
- 용도지역: ${zoning || '(미입력)'}
- 대지면적: ${area || '(미입력)'}
- 관련 법령: ${law || '국토의 계획 및 이용에 관한 법률, 건축법, 도시계획 조례'}

■ 검토 배경 및 목적
${background || '(미입력)'}

■ 현황 및 분석 사항
${current || '(미입력)'}

■ 추가 작성 지시사항
${extra || '법적 근거, 타당성 분석, 검토 의견, 결론을 포함하여 작성'}

[출력 구조 - 반드시 이 순서로 작성]

1. 검토 개요
   (문서 기본정보 표 형식으로 정리)

2. 관련 법령 및 지침 검토
   가. 용도지역별 건축 가능 용도 (국토계획법 시행령 별표 근거로 구체적 조항 인용)
   나. 지구단위계획 허용용도 설정 기준 (국토계획법 제52조, 관련 수립지침)
   다. 개발제한구역 해제취락 관련 특별 규정 (해당시)

3. 용도별 허용 가능 여부 검토
   (검토 요청된 각 용도에 대해 아래 소항목으로 상세 서술)
   가. [용도명]
      ① 건축법상 정의 및 분류
      ② 관련 법령 검토 (구체적 조항 인용)
      ③ 도시계획적 타당성 분석
      ④ 검토 의견 및 결론

4. 종합 검토 의견
   (각 용도별 허용 여부 종합 정리)

5. 결론 및 권고사항
   (발주처 담당자가 상급기관 보고에 활용할 수 있는 수준의 논거와 후속 조치 권고)`;

  try {
    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 8000,
        temperature: 0.2,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      const msg = err?.error?.message || `Groq API 오류 (${upstream.status})`;
      return new Response(JSON.stringify({ error: msg }), { status: 502 });
    }

    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
