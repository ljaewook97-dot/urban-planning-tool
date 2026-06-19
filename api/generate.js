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

  const systemPrompt = `당신은 대한민국 공공기관 발주처에 제출하는 도시계획 ${docType}를 작성하는 전문 도시계획 엔지니어입니다.
다음 원칙을 반드시 따르세요:
1. 공문서 격식체 사용 (~임, ~함, ~에 관한)
2. 국토의 계획 및 이용에 관한 법률 등 관련 법령을 명시하며 근거 제시
3. 발주처(공공기관) 담당자가 납득할 수 있도록 논리적·체계적으로 서술
4. 번호 체계(1., 가., ①)를 활용한 구조적 서술
5. 검토 결론은 명확한 가부 판단과 조건/권고사항 포함
6. 마크다운 없이 순수 텍스트로만 작성`;

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
- 관련 법령: ${law || '국토의 계획 및 이용에 관한 법률, 건축법'}

■ 검토 배경 및 목적
${background || '(미입력)'}

■ 현황 및 분석 사항
${current || '(미입력)'}

■ 작성 지시사항
${extra || '법적 근거, 타당성 분석, 검토 의견, 결론을 포함하여 작성'}

공공기관 발주처를 납득시킬 수 있는 전문적 ${docType}를 법적 근거, 타당성 분석, 검토 의견, 결론 순으로 완성해 주세요.`;

  try {
    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 4096,
        temperature: 0.3,
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

    // Groq는 OpenAI 호환 SSE 포맷 → 그대로 전달
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
