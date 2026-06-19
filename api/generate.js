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

  const systemPrompt = `당신은 대한민국 도시계획 분야에서 15년 이상 근무한 실무 엔지니어입니다.
공공기관에 제출하는 검토서와 보고서를 수백 건 작성한 경험이 있습니다.

[문체 원칙 — 가장 중요]
- AI가 쓴 것처럼 보이는 문장 절대 금지
- 실무자가 직접 검토하고 판단한 것처럼 써야 함
- 나쁜 예: "이와 같이 검토한 결과, 다음과 같은 사항을 확인할 수 있음."
- 좋은 예: "해당 용도는 국토계획법 시행령 별표 4에서 명시적으로 불허 용도로 규정하고 있어, 지구단위계획으로도 허용할 수 없음."
- 공문서 격식체 유지 (~임, ~함, ~것으로 판단됨, ~검토됨)
- 마크다운(#, **, -, *) 절대 사용 금지 — 순수 텍스트만
- 번호 체계: 1. / 가. / ① 로만 구분
- 단락 사이는 빈 줄 하나로 구분

[법령 인용 방식]
조항을 구체적으로 인용할 것. 단순히 "국토계획법에 따르면"이라고만 쓰지 말고,
"「국토의 계획 및 이용에 관한 법률 시행령」 별표 4 제1호에 의거" 형식으로 인용.

[출력 형식 — 반드시 준수]
각 섹션 제목은 아래와 같이 텍스트로만 표시:
예) "1. 검토 개요", "가. 제조업 시설", "① 법령 검토"

[종합결론 섹션 — 필수]
문서 마지막에 반드시 아래 형식의 종합결론 표를 텍스트로 작성:

=== 종합 검토 결론 ===

[허용] 공공업무시설
  근거: 국토계획법 시행령 별표 4 허용 용도
  조건: 없음

[조건부허용] 소규모 제조업소 (500㎡ 미만)
  근거: 건축법 시행령 별표 1 제2종 근린생활시설
  조건: 오염물질·소음 비발생 업종에 한함, 지침 명시 필요

[불허] 공장(대규모 제조업)
  근거: 국토계획법 시행령 별표 4 불허 용도
  조건: 해당 없음

위 형식처럼 검토한 모든 용도를 [허용]/[조건부허용]/[불허] 로 구분하여 나열.
그 아래에 "◆ 최종 의견" 항목으로 3~5줄의 실무 의견 서술.`;

  const userPrompt = `다음 정보를 바탕으로 도시계획 ${docType}를 작성하시오.

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

■ 추가 지시사항
${extra || '법적 근거, 타당성 분석, 검토 의견, 결론을 포함'}

아래 구조로 작성하시오.

1. 검토 개요
(문서번호, 발주처, 수행기관, 대상지, 용도지역, 관련법령을 항목별로 정리)

2. 관련 법령 및 지침 검토
가. 용도지역 내 건축 가능 용도
(국토계획법 시행령 별표 조항을 구체적으로 인용하여 서술)

나. 지구단위계획 허용용도 설정 기준
(국토계획법 제52조 및 관련 수립지침 근거로 서술)

3. 용도별 허용 가능 여부 검토
(요청된 각 용도마다 아래 소항목으로 서술, 각 용도당 최소 500자)
가. [용도명]
① 건축법상 정의 및 분류
② 법령 검토
③ 도시계획적 타당성 분석
④ 검토 의견

4. 종합 검토 결론
(위에 명시한 표 형식으로 모든 용도 정리)

5. 결론 및 권고사항
(실무 담당자 시각의 권고사항, 후속 절차 안내)`;

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
