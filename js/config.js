/* =====================================================================
 *  가결산 리포트 설정값
 *  - 세율표·기본값은 여기만 고치면 됩니다. (다른 js 파일은 손대지 않아도 됨)
 * ===================================================================== */
window.CONFIG = {
  // 표지·문서 기본값
  firmName: '편한세무회계',
  reportTitle: '가결산 보고서',
  reportTitleOptions: ['가결산 보고서', '중간결산 보고서', '경영성과 보고서'],
  footnote: '본 보고서는 보고일 현재의 결산내역을 기초로 작성되었습니다.',
  // 접속 암호 (인터넷에 올렸을 때 외부인이 쓰지 못하게). 빈칸이면 암호 없음.
  // 브라우저에 한 번 입력하면 기억합니다. 간단한 잠금이라 보안 장치는 아닙니다.
  accessCode: '',

  // 법인세 세율표 (과세표준 상한, 세율, 누진공제)  ※ 2026 사업연도 귀속 기준 — 확인 필요
  corporateBrackets: [
    { limit: 200000000,      rate: 0.10, deduction: 0 },
    { limit: 20000000000,    rate: 0.20, deduction: 20000000 },
    { limit: 300000000000,   rate: 0.22, deduction: 420000000 },
    { limit: Infinity,       rate: 0.25, deduction: 9420000000 },
  ],
  // 종합소득세 세율표 (국세)  ※ 2026 귀속 기준 — 확인 필요
  individualBrackets: [
    { limit: 14000000,    rate: 0.06, deduction: 0 },
    { limit: 50000000,    rate: 0.15, deduction: 1260000 },
    { limit: 88000000,    rate: 0.24, deduction: 5760000 },
    { limit: 150000000,   rate: 0.35, deduction: 15440000 },
    { limit: 300000000,   rate: 0.38, deduction: 19940000 },
    { limit: 500000000,   rate: 0.40, deduction: 25940000 },
    { limit: 1000000000,  rate: 0.42, deduction: 35940000 },
    { limit: Infinity,    rate: 0.45, deduction: 65940000 },
  ],
  individualBasicDeduction: 1500000, // 개인 기본공제(본인) — 단순 추정용
  localTaxRate: 0.10,                // 지방소득세 = 산출세액의 10%
  defaultEntity: 'indiv',            // 기본 사업자 구분: 'indiv'(개인) | 'corp'(법인). PDF에 '법인세' 항목이 있으면 법인으로 자동 전환

  // 공제·감면 항목. mode: 'rate' = 산출세액의 %  /  'amount' = 금액(원)  /  'both' = 둘 다 입력
  // rates 의 % 값은 귀속연도 세법 기준으로 확인 필요
  creditTypes: [
    { key: 'none',    label: '없음',               mode: 'none' },
    { key: 'startup', label: '창업중소기업 세액감면', mode: 'rate',   rates: [50, 75, 100], hint: '청년창업·지역에 따라 50~100% (확인 필요)' },
    { key: 'sme',     label: '중소기업특별세액감면', mode: 'rate',   rates: [5, 10, 15, 20, 30], hint: '업종·지역·규모별 5~30%' },
    { key: 'employ',  label: '고용증대(통합고용)세액공제', mode: 'amount', hint: '증가 인원 × 1인당 공제액(원)을 계산해 입력' },
    { key: 'other',   label: '기타 (직접 입력)',    mode: 'both',   hint: '감면율(%)과 공제액(원)을 직접 입력' },
  ],

  // 판관비 중 '인건비'로 묶어서 볼 계정 (공백 제거한 계정명에 포함되면 인건비)
  laborKeywords: ['급여', '급료', '임금', '상여', '잡급', '퇴직급여', '퇴직연금', '인건비', '급여수당', '일용급여'],
  // 금융비용으로 볼 계정
  interestKeywords: ['이자비용', '지급이자', '이자'],

  // 진단 기준 (비율은 %)
  thresholds: {
    growthFlat: 3,          // ±3% 이내면 '비슷한 수준'
    opMarginLow: 5,         // 영업이익률 5% 미만 '낮음'
    opMarginGood: 15,       // 15% 이상 '양호'
    itemSurgePct: 30,       // 비용 항목 전년 대비 30% 이상 증가면 언급
    itemMinShare: 3,        // 매출 대비 3% 이상인 항목만 언급
    laborRatioHigh: 40,     // 인건비/매출 40% 이상이면 언급
  },
};
