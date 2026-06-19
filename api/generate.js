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
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: '요청 형식 오류' }), { status: 400 }); }

  const {
    docType, docTitle, client, agency, docDate, author,
    location, zoning, zoneDistrict, nearbyZoning, nearbyLanduse,
    area, law, background, current, extra
  } = body;

  const systemPrompt = `당신은 대한민국 도시계획 실무 엔지니어로, 공공기관에 제출하는 검토서를 수백 건 작성한 전문가입니다.

[절대 금지]
- AI 특유의 나열식·반복식 문장 사용 금지
  나쁜 예: "이와 같이 검토한 결과, 다음과 같은 사항을 확인할 수 있음"
  좋은 예: "위 규정에 따르면 해당 용도는 제1종일반주거지역 내 건축이 불가함"
- 마크다운(#, **, -, *) 절대 사용 금지
- "검토 결과", "살펴보면", "알 수 있음" 등 공문서에 어울리지 않는 표현 금지

[문체]
- 공문서 격식체: ~임, ~함, ~것으로 판단됨, ~검토됨, ~불가함, ~가능함
- 실무자가 직접 현장을 보고 법령을 검토한 것처럼 서술
- 단락 간 빈 줄 하나로 구분

[법령 인용]
- 반드시 정확한 조문 형식으로 인용
  예) 「국토의 계획 및 이용에 관한 법률 시행령」 별표 4 제1호
  예) 「건축법 시행령」 별표 1 제4호 나목
  예) 국토계획법 제52조제1항

[주변현황 및 용도지역·지구 분석]
- 대상지의 용도지역, 용도지구, 용도구역을 명확히 구분하여 서술
- 인접 토지의 용도 및 현황이 계획에 미치는 영향 분석
- 개발제한구역 해제취락인 경우 GB 해제 이력 및 관련 수립지침 적용 검토

[출력 구조 — 반드시 이 순서로]

##SECTION:1. 검토 개요##
(문서 기본정보를 항목별로 서술)

##SECTION:2. 대상지 현황 분석##
(용도지역·용도지구·용도구역 현황, 주변 토지이용 현황, 도시계획시설 현황 등을 서술)

##SECTION:3. 관련 법령 및 지침 검토##
(국토계획법, 건축법, 조례, 지구단위계획 수립지침 등 관련 법령을 조문 인용과 함께 서술)

##SECTION:4. 용도별 허용 가능 여부 검토##
(검토 요청된 각 용도에 대해 아래 소항목으로 서술. 각 용도당 최소 600자)
가. [용도명]
① 건축법상 정의 및 분류 기준
② 법령 검토 (조문 인용 포함)
③ 주변현황 및 도시계획적 타당성 분석
④ 검토 의견

##SECTION:5. 종합 검토 결론##
(반드시 아래 형식 그대로 출력 — 파싱에 사용됨)

RESULT_TABLE_START
허용|공공업무시설|국토계획법 시행령 별표 4 제1호|조건 없음
조건부|소규모 제조업소 (500㎡ 미만)|건축법 시행령 별표 1 제4호|오염물질 비발생 업종 한정, 지침 명시 필요
불허|대규모 공장|국토계획법 시행령 별표 4 제2호|해당 없음
RESULT_TABLE_END

위 예시처럼 실제 검토 용도들을 "허용/조건부/불허|용도명|법적근거|조건" 형식으로 작성.

##SECTION:6. 결론 및 권고사항##
(실무 담당자 관점의 후속 조치 및 협의 권고사항 서술)`;

  const userPrompt = `다음 정보로 도시계획 ${docType}를 작성하시오.

■ 기본 정보
- 문서 제목: ${docTitle || '(미입력)'}
- 발주처: ${client || '(미입력)'}
- 수행 기관: ${agency || '(미입력)'}
- 작성일: ${docDate || ''}${author ? '\n- 작성자: ' + author : ''}

■ 대상지 정보
- 위치: ${location || '(미입력)'}
- 용도지역: ${zoning || '(미입력)'}
- 용도지구·용도구역: ${zoneDistrict || '(미입력)'}
- 인접 용도지역·현황: ${nearbyZoning || '(미입력)'}
- 주변 토지이용 현황: ${nearbyLanduse || '(미입력)'}
- 대지면적: ${area || '(미입력)'}
- 관련 법령: ${law || '국토의 계획 및 이용에 관한 법률, 건축법, 도시계획 조례'}

■ 검토 배경 및 목적
${background || '(미입력)'}

■ 현황 및 분석 사항
${current || '(미입력)'}

■ 추가 지시사항
${extra || '각 용도별 허용 여부를 법적 근거 및 주변 현황과 연계하여 상세히 검토'}`;

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
        temperature: 0.15,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: err?.error?.message || `Groq 오류 (${upstream.status})` }), { status: 502 });
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
