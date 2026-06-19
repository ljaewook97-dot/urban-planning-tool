export const config = { runtime: 'edge' };

// 국가법령정보센터 Open API로 최신 법령 조문 수집
async function fetchLawFromOC(lawName, ocKey) {
  try {
    // 1단계: 법령 기본정보 조회
    const infoUrl = `https://www.law.go.kr/DRF/lawSearch.do?OC=${ocKey}&target=law&type=JSON&query=${encodeURIComponent(lawName)}`;
    const infoRes = await fetch(infoUrl);
    if (!infoRes.ok) return null;
    const infoData = await infoRes.json();
    const lawId = infoData?.LawSearch?.law?.[0]?.MST;
    if (!lawId) return null;

    // 2단계: 법령 본문 조회
    const textUrl = `https://www.law.go.kr/DRF/lawService.do?OC=${ocKey}&target=law&MST=${lawId}&type=JSON`;
    const textRes = await fetch(textUrl);
    if (!textRes.ok) return null;
    const textData = await textRes.json();
    // 조문 텍스트 추출
    const articles = textData?.law?.lawSection?.section;
    if (!articles) return null;
    const flat = Array.isArray(articles) ? articles : [articles];
    return flat.map(s => s?.article?.map?.(a =>
      `제${a?.articleNo}조(${a?.articleTitle || ''}) ${a?.articleCont || ''}`
    ).join('\n')).join('\n').slice(0, 3000);
  } catch { return null; }
}

// 법제처 별표/서식 텍스트 수집 (HTML 파싱)
async function fetchLawHtml(lawName) {
  try {
    const url = `https://www.law.go.kr/lsInfoP.do?lsiSeq=&efYd=&lsId=&chrClsCd=010102&urlMode=lsInfoP&viewCls=lsRvsDocInfoR&ancYnChk=0#`;
    // 별표 조항은 직접 URL로 수집
    const searchUrl = `https://www.law.go.kr/DRF/lawSearch.do?OC=test&target=law&type=HTML&query=${encodeURIComponent(lawName)}&display=10`;
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' }
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 2000);
  } catch { return null; }
}

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

  const groqKey = process.env.GROQ_API_KEY;
  const ocKey   = process.env.LAW_OC_KEY || 'openlaw'; // 법제처 Open API 키 (없으면 공개키)

  if (!groqKey) {
    return new Response(JSON.stringify({ error: 'GROQ_API_KEY가 설정되지 않았습니다.' }), { status: 500 });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: '요청 형식 오류' }), { status: 400 }); }

  const {
    docType, docTitle, client, agency, docDate, author,
    location, zoning, zoneDistrict, nearbyZoning, nearbyLanduse,
    area, law, background, current, extra
  } = body;

  // ── 법령 수집 (병렬) ──
  const [ntuRaw, buildRaw] = await Promise.all([
    fetchLawFromOC('국토의 계획 및 이용에 관한 법률 시행령', ocKey),
    fetchLawFromOC('건축법 시행령', ocKey),
  ]);

  // 수집 실패 시 법제처 공개 핵심 조문 텍스트를 하드코딩으로 보완
  const ntuFallback = `
[국토의 계획 및 이용에 관한 법률 시행령 별표 4 — 제1종일반주거지역 건축제한]
1. 건축할 수 있는 건축물 (법 제76조제1항 관련)
  가. 건축법 시행령 별표 1 제1호의 단독주택
  나. 건축법 시행령 별표 1 제2호의 공동주택(아파트를 제외한다)
  다. 건축법 시행령 별표 1 제3호의 제1종 근린생활시설
  라. 건축법 시행령 별표 1 제10호의 교육연구시설 중 유치원·초등학교·중학교 및 고등학교
  마. 건축법 시행령 별표 1 제11호의 노유자시설

2. 도시·군계획조례가 정하는 바에 의하여 건축할 수 있는 건축물
  가. 건축법 시행령 별표 1 제4호의 제2종 근린생활시설(같은 호 아목·자목은 제외한다)
  나. 건축법 시행령 별표 1 제5호의 문화 및 집회시설(같은 호 라목은 제외한다)
  다. 건축법 시행령 별표 1 제9호의 의료시설
  라. 건축법 시행령 별표 1 제10호의 교육연구시설 중 제1호 라목에 해당하지 아니하는 것
  마. 건축법 시행령 별표 1 제12호의 수련시설
  바. 건축법 시행령 별표 1 제13호의 운동시설
  사. 건축법 시행령 별표 1 제18호 가목의 창고(농업·임업·축산업·수산업용만 해당)
  아. 건축법 시행령 별표 1 제21호의 동물 및 식물 관련 시설 중 화초 및 분재 등의 온실
  자. 건축법 시행령 별표 1 제23호의 교정 및 군사 시설
  차. 건축법 시행령 별표 1 제24호의 방송통신시설
  카. 건축법 시행령 별표 1 제25호의 발전시설
  타. 건축법 시행령 별표 1 제26호의 묘지 관련 시설

[국토계획법 제52조 — 지구단위계획의 내용]
① 지구단위계획구역의 지정목적을 이루기 위하여 지구단위계획에는 다음 각 호의 사항 중 제2호와 제4호의 사항을 포함한 둘 이상의 사항이 포함되어야 한다.
④ 지구단위계획은 도시·군관리계획으로 결정한다.
※ 지구단위계획으로 용도지역에서 허용되지 않는 용도를 새롭게 허용할 수 없음 (용도지역 건축제한 범위 내에서만 완화 가능)
`;

  const buildFallback = `
[건축법 시행령 별표 1 — 용도별 건축물의 종류 (주요 발췌)]

제4호. 제2종 근린생활시설
  아. 제조업소, 수리점 등 물품의 제조·가공·수리 등을 위한 시설로서 같은 건축물에 해당 용도로 쓰는 바닥면적의 합계가 500제곱미터 미만이고, 「대기환경보전법」, 「수질 및 수생태계 보전에 관한 법률」 또는 「소음·진동관리법」에 따른 배출시설의 설치 허가 또는 신고의 대상이 아닌 것
  자. 자동차영업소로서 같은 건축물에 해당 용도로 쓰는 바닥면적의 합계가 1천 제곱미터 미만인 것

제7호. 판매시설
  나. 상점(「게임산업진흥에 관한 법률」 제2조제6호의2가목에 따른 청소년게임제공업 시설 제외)으로서 해당 용도로 쓰는 바닥면적의 합계가 1천 제곱미터 이상인 것
  ※ 자동차 전시장 바닥면적 1,000㎡ 이상 → 판매시설 해당

제14호. 업무시설
  가. 공공업무시설: 국가 또는 지방자치단체의 청사와 외국공관의 건축물로서 제1종 근린생활시설에 해당하지 아니하는 것
  나. 일반업무시설: 금융업소, 사무소, 결혼상담소 등 소개업소, 출판사, 신문사, 그 밖에 이와 비슷한 것으로서 같은 건축물에 해당 용도로 쓰는 바닥면적의 합계가 500제곱미터 이상인 것과 오피스텔(업무를 주로 하며, 분리된 주거의 용도로도 쓸 수 있는 구조로 된 건축물)

제17호. 공장
  물품의 제조·가공(세탁, 염색, 도장, 표백, 재봉, 건조, 인쇄 등 포함) 또는 수리에 계속적으로 사용하는 건축물로서 제2종 근린생활시설, 위험물저장 및 처리시설, 자동차 관련 시설, 자원순환 관련 시설 등으로 따로 분류되지 아니한 것
`;

  const ntuLaw   = ntuRaw   || ntuFallback;
  const buildLaw = buildRaw || buildFallback;

  const systemPrompt = `당신은 대한민국 도시계획 실무 엔지니어로 15년 경력을 가진 전문가입니다.

[절대 금지]
- AI 특유의 나열식 문장, "이와 같이 검토한 결과" 류의 표현 금지
- 마크다운(#, **, -, *) 절대 사용 금지
- 제공된 법령 텍스트 외의 조문을 임의로 창작하거나 기억에 의존한 인용 금지

[법령 인용 원칙]
- 반드시 제공된 법령 텍스트에서 확인된 조문만 인용
- 조문 인용: 「국토의 계획 및 이용에 관한 법률 시행령」 별표 4 제1호 / 「건축법 시행령」 별표 1 제4호 아목 등
- 확인 불가한 사항은 "고양시 도시계획 조례 원문 확인 필요" 로 명시

[문체]
- 공문서 격식체: ~임, ~함, ~것으로 판단됨, ~불가함, ~가능함
- 단락 간 빈 줄 하나로 구분

[출력 구조 — 반드시 준수]

##SECTION:1. 검토 개요##
(문서 기본정보 항목별 서술)

##SECTION:2. 대상지 현황 분석##
(용도지역·지구·구역 현황, 인접 토지이용 현황, 주변 현황이 허용용도에 미치는 영향 분석)

##SECTION:3. 관련 법령 및 지침 검토##
(제공된 법령 텍스트 기반 조문 인용 및 해석. 별표 4, 제52조, 별표 1 등 구체적 조항 명시)

##SECTION:4. 용도별 허용 가능 여부 검토##
검토 요청된 각 용도에 대해 아래 4개 소항목으로 서술. 각 용도당 최소 700자.

가. [용도명]
① 건축법상 정의 및 면적 기준
(별표 1 몇 호 몇 목에 해당하는지, 면적 기준에 따라 용도가 어떻게 달라지는지)
② 용도지역 내 법령 검토
(별표 4 기준 해당 용도지역에서 허용/불허 여부, 조례로 추가 허용 가능 여부)
③ 주변현황 및 도시계획적 타당성 분석
(인접 용도지역, 주변 토지이용, 교통·소음·환경 영향)
④ 검토 의견
(명확한 허용/불허/조건부 판단과 구체적 조건)

##SECTION:5. 종합 검토 결론##
아래 형식 그대로 출력 (파싱용, 절대 변경 금지):

RESULT_TABLE_START
허용|용도명|「법령명」 조문|조건 없음
조건부|용도명|「법령명」 조문|구체적 조건
불허|용도명|「법령명」 조문|해당 없음
RESULT_TABLE_END

##SECTION:6. 결론 및 권고사항##
(후속 협의 절차, 고양시 조례 확인 사항, 실무 권고 사항 서술)`;

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
- 인접 용도지역: ${nearbyZoning || '(미입력)'}
- 주변 토지이용 현황: ${nearbyLanduse || '(미입력)'}
- 대지면적: ${area || '(미입력)'}
- 관련 법령: ${law || '국토의 계획 및 이용에 관한 법률, 건축법, 고양시 도시계획 조례'}

■ 검토 배경 및 목적
${background || '(미입력)'}

■ 현황 및 분석 사항
${current || '(미입력)'}

■ 추가 지시사항
${extra || '각 용도별 허용 여부를 법적 근거 및 주변 현황과 연계하여 상세히 검토'}

━━━━━━━━━━━━━━━━━━━━━━━━
[법령 참조 자료 — 반드시 이 내용을 기반으로 조문 인용]

${ntuLaw}

${buildLaw}
━━━━━━━━━━━━━━━━━━━━━━━━`;

  try {
    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 8000,
        temperature: 0.1,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      return new Response(
        JSON.stringify({ error: err?.error?.message || `Groq 오류 (${upstream.status})` }),
        { status: 502 }
      );
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
