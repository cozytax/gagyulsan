/* =====================================================================
 *  analysis.js — 연도 병합 · 데이터 검증 · 12개월 환산 · 비율 · 예상 세액 · 시뮬레이션 · 진단 문구 · 실행계획
 * ===================================================================== */
(function () {
  'use strict';
  const C = window.CONFIG;
  const MAJOR_KEYS = ['sales', 'cogs', 'gross', 'sga', 'op', 'nonOpInc', 'nonOpExp', 'pretax', 'tax', 'net'];
  const MAJOR_LABEL = {
    sales: '매출액', cogs: '매출원가', gross: '매출총이익', sga: '판매비와관리비', op: '영업이익',
    nonOpInc: '영업외수익', nonOpExp: '영업외비용', pretax: '세전이익', tax: '법인세등', net: '당기순이익',
  };
  const TOTAL_CALC = { gross: m => m.sales - m.cogs, op: m => m.gross - m.sga, pretax: m => m.op + m.nonOpInc - m.nonOpExp, net: m => m.pretax - m.tax };

  /* ---------- 숫자 표기 ---------- */
  const Fmt = {
    won(n) { if (n === null || n === undefined || isNaN(n)) return '-'; return Math.round(n).toLocaleString('ko-KR'); },
    wonUnit(n, unit) { if (n === null || n === undefined || isNaN(n)) return '-'; return Math.round(n / unit).toLocaleString('ko-KR'); },
    // 사장님용 읽기 쉬운 금액: 1억 2,352만원 / 5,223만원 / 7,500원
    man(n, opt) {
      if (n === null || n === undefined || isNaN(n)) return '-';
      const neg = n < 0; const a = Math.abs(Math.round(n));
      let s;
      if (a >= 100000000) {
        const eok = Math.floor(a / 100000000); const man = Math.round((a % 100000000) / 10000);
        s = man > 0 ? `${eok.toLocaleString('ko-KR')}억 ${man.toLocaleString('ko-KR')}만원` : `${eok.toLocaleString('ko-KR')}억원`;
      } else if (a >= 10000) s = `${Math.round(a / 10000).toLocaleString('ko-KR')}만원`;
      else s = `${a.toLocaleString('ko-KR')}원`;
      if (neg) s = (opt && opt.lossWord ? '손실 ' : '−') + s;
      return s;
    },
    pct(x, d) { if (x === null || x === undefined || isNaN(x) || !isFinite(x)) return '-'; return `${x.toFixed(d === undefined ? 1 : d)}%`; },
    delta(x) { if (x === null || x === undefined || isNaN(x) || !isFinite(x)) return '-'; const a = Math.abs(x).toFixed(1); return x > 0 ? `▲ ${a}%` : x < 0 ? `▼ ${a}%` : '0.0%'; },
    // "약 7% 증가" 식 서술
    growthWord(x) { if (x === null || x === undefined || isNaN(x) || !isFinite(x)) return null; const a = Math.abs(x); return a < 0.05 ? '전년과 같은 수준' : `약 ${a.toFixed(a >= 10 ? 0 : 1)}% ${x > 0 ? '증가' : '감소'}`; },
  };

  /* ---------- 세율표 선택 (귀속연도별) ---------- */
  function getBrackets(year, entity) {
    const years = Object.keys(C.taxTables).map(Number).sort((a, b) => a - b);
    let pick = years[0];
    for (const y of years) if (y <= year) pick = y;
    const t = C.taxTables[pick];
    return { year: pick, list: entity === 'indiv' ? t.individual : t.corporate, exact: pick === year };
  }

  /* ---------- 연도 병합 ---------- */
  function emptyYear(year) {
    return { year, months: 12, source: 'manual', fileName: '', m: {}, found: {}, details: { sales: [], cogs: [], sga: [], nonOpInc: [], nonOpExp: [] } };
  }

  function periodToYear(stmt, per) {
    const y = emptyYear(per.year);
    y.months = per.months || 12; y.source = per.kind; y.fileName = stmt.fileName;
    y.startMonth = per.startMonth; y.endMonth = per.endMonth;
    for (const it of per.items) {
      if (it.level === 'major' && it.key) { if (y.m[it.key] === undefined) { y.m[it.key] = it.value; y.found[it.key] = true; } }
      else if (it.level === 'detail' && it.section && y.details[it.section]) y.details[it.section].push({ label: it.label, value: it.value });
    }
    return y;
  }

  /**
   * statements: Parser 결과 배열, manual: {year: {m:{...}, months}}
   * 반환: { years(최근 3개년), samePeriod(전년 동기 자료, 있을 때), warnings, issues }
   */
  function mergeStatements(statements, manualYears) {
    const byYear = {}; const warnings = []; const periods = [];
    for (const s of statements) {
      for (const per of s.periods) {
        if (per.items.every(it => !it.value)) { if (per.year) warnings.push(`${s.fileName}: ${per.year}년(${per.kind === 'prev' ? '전기' : '당기'}) 열이 전부 0이라 제외했습니다.`); continue; }
        if (!per.year) { warnings.push(`${s.fileName}: ${per.kind === 'prev' ? '전기' : '당기'} 열의 회계기간을 읽지 못해 건너뛰었습니다.`); continue; }
        periods.push(periodToYear(s, per));
      }
    }
    // 기준연도 = 가장 최근 연도
    const maxYear = periods.length ? Math.max(...periods.map(p => p.year)) : null;
    const basePer = periods.filter(p => p.year === maxYear).sort((a, b) => (b.source === 'cur') - (a.source === 'cur') || b.months - a.months)[0] || null;
    let samePeriod = null;
    for (const y of periods) {
      // 전년 동기 자료: 기준연도-1, 같은 시작월·같은 개월 수(12개월 미만)
      if (basePer && y.year === maxYear - 1 && basePer.months < 12 && y.months === basePer.months && (y.startMonth || 1) === (basePer.startMonth || 1)) samePeriod = y;
      const ex = byYear[y.year];
      if (!ex) { byYear[y.year] = y; continue; }
      // 같은 연도가 둘이면: 개월 수가 긴 쪽(연간 결산) → 같으면 '당기' 열 우선
      const pick = (y.months > ex.months) ? y : (y.months < ex.months) ? ex : (ex.source === 'cur' && y.source !== 'cur') ? ex : y;
      const other = pick === ex ? y : ex;
      if (pick.months === other.months && ex.m.sales !== undefined && y.m.sales !== undefined && ex.m.sales !== y.m.sales) {
        warnings.push(`${y.year}년 매출액이 파일마다 다릅니다 (${Fmt.won(ex.m.sales)} / ${Fmt.won(y.m.sales)}). '${pick.fileName}' 의 값을 사용했습니다.`);
      }
      byYear[y.year] = pick;
    }
    if (samePeriod) samePeriod = { ...samePeriod, m: { ...samePeriod.m } }; // 연도 레코드와 분리
    if (manualYears) for (const [yr, d] of Object.entries(manualYears)) {
      if (!byYear[yr]) byYear[yr] = emptyYear(+yr);
      Object.assign(byYear[yr].m, d.m || {});
      for (const k of Object.keys(d.m || {})) byYear[yr].found[k] = true;
      if (d.months) byYear[yr].months = d.months;
    }
    const years = Object.values(byYear).sort((a, b) => a.year - b.year).slice(-3);
    years.forEach(fillDerived);
    if (samePeriod) fillDerived(samePeriod);
    return { years, samePeriod, warnings, issues: validate(years) };
  }

  function fillDerived(y) {
    const m = y.m; const v = k => (m[k] === undefined || m[k] === null) ? null : m[k];
    if (v('sales') === null) m.sales = 0;
    if (v('cogs') === null) m.cogs = v('gross') !== null ? m.sales - m.gross : 0;
    if (v('gross') === null) m.gross = m.sales - m.cogs;
    if (v('sga') === null) m.sga = v('op') !== null ? m.gross - m.op : 0;
    if (v('op') === null) m.op = m.gross - m.sga;
    if (v('nonOpInc') === null) m.nonOpInc = 0;
    if (v('nonOpExp') === null) m.nonOpExp = 0;
    if (v('pretax') === null) m.pretax = m.op + m.nonOpInc - m.nonOpExp;
    if (v('tax') === null) m.tax = 0;
    if (v('net') === null) m.net = m.pretax - m.tax;
  }

  /* ---------- 데이터 검증: 필수 항목·합계 일치·비정상 숫자 ---------- */
  function validate(years) {
    const issues = [];
    for (const y of years) {
      const m = y.m, f = y.found || {}; const tag = `${y.year}년`;
      if (y.source !== 'manual' && !f.sales) issues.push({ level: 'error', year: y.year, text: `${tag}: 매출액 항목을 PDF에서 찾지 못했습니다. 아래 표에서 직접 입력해 주세요.` });
      if (f.sales && m.sales < 0) issues.push({ level: 'error', year: y.year, text: `${tag}: 매출액이 음수(${Fmt.won(m.sales)})입니다. 추출 오류를 확인해 주세요.` });
      if (f.sales && m.sales === 0 && (m.sga > 0 || m.cogs > 0)) issues.push({ level: 'warn', year: y.year, text: `${tag}: 매출액이 0인데 비용이 있습니다. 매출 항목 인식을 확인해 주세요.` });
      const checks = [['gross', '매출총이익', '매출액 − 매출원가'], ['op', '영업이익', '매출총이익 − 판관비'], ['pretax', '세전이익', '영업이익 + 영업외수익 − 영업외비용'], ['net', '당기순이익', '세전이익 − 법인세등']];
      for (const [k, label, formula] of checks) {
        if (!f[k]) continue; // PDF에서 읽은 합계만 검증 (계산해서 채운 값은 항상 일치)
        const calc = TOTAL_CALC[k](m);
        if (Math.abs(calc - m[k]) > 1) issues.push({ level: 'warn', year: y.year, text: `${tag}: ${label}(${Fmt.won(m[k])})이 ${formula}(${Fmt.won(calc)})와 ${Fmt.won(Math.abs(calc - m[k]))}원 차이 납니다. 항목이 잘못 읽혔을 수 있습니다.` });
      }
      if (m.sales > 0 && m.sga > m.sales * 5) issues.push({ level: 'warn', year: y.year, text: `${tag}: 판관비가 매출의 5배를 넘습니다. 숫자 자릿수를 확인해 주세요.` });
      if (!(y.months >= 1 && y.months <= 12)) issues.push({ level: 'error', year: y.year, text: `${tag}: 실적 개월 수(${y.months})가 잘못되었습니다.` });
    }
    return issues;
  }

  /* ---------- 분석 ---------- */
  const ratio = (a, b) => (b && b !== 0) ? a / Math.abs(b) * 100 : null;
  const growth = (cur, prev) => (prev && prev !== 0) ? (cur - prev) / Math.abs(prev) * 100 : null;

  function analyze(years, opts) {
    opts = opts || {};
    if (!years.length) return null;
    const base = years[years.length - 1];
    const factor = base.months > 0 && base.months < 12 ? 12 / base.months : 1;
    const industry = C.industries.find(i => i.key === (opts.industry || '')) || C.industries[0];

    const rows = years.map(y => {
      const isBase = y === base;
      const f = (y.months > 0 && y.months < 12) ? 12 / y.months : 1;
      const a = {}; for (const k of MAJOR_KEYS) a[k] = y.m[k] * f;
      const r = { grossMargin: ratio(a.gross, a.sales), opMargin: ratio(a.op, a.sales), netMargin: ratio(a.net, a.sales), sgaRatio: ratio(a.sga, a.sales), cogsRatio: ratio(a.cogs, a.sales) };
      return { ...y, isBase, factor: f, a, r, g: {} };
    });
    for (let i = 1; i < rows.length; i++) {
      const p = rows[i - 1].a, c = rows[i].a;
      rows[i].g = { sales: growth(c.sales, p.sales), gross: growth(c.gross, p.gross), op: growth(c.op, p.op), net: growth(c.net, p.net), sga: growth(c.sga, p.sga) };
    }
    const b = rows[rows.length - 1];
    // 전년 동기 대비(실제)
    let same = null;
    if (opts.samePeriod && opts.samePeriod.year === b.year - 1) {
      const s = opts.samePeriod.m;
      same = { year: opts.samePeriod.year, months: opts.samePeriod.months, m: s, g: { sales: growth(b.m.sales, s.sales), op: growth(b.m.op, s.op), net: growth(b.m.net, s.net) } };
    }

    const cost = costStructure(rows, industry);
    const tax = estimateTax(b, opts);
    const feedback = buildFeedback(rows, cost, tax, same, industry, opts);
    const plan = buildPlan(rows, cost, tax, same, industry, opts);
    return { base: b, prev: rows[rows.length - 2] || null, rows, factor, same, industry, cost, tax, feedback, plan, labels: MAJOR_LABEL };
  }

  /* 판관비 구조: 올해(연환산) 기준. 업종 중점 항목을 앞에 둔다 */
  function costStructure(rows, industry) {
    const b = rows[rows.length - 1], p = rows[rows.length - 2];
    const map = {};
    const add = (list, who) => list.forEach(it => { const k = it.label; if (!map[k]) map[k] = { label: k, cur: 0, prev: 0 }; map[k][who] += it.value; });
    add(b.details.sga, 'cur'); if (p) add(p.details.sga, 'prev');
    if (p && p.factor !== 1) Object.values(map).forEach(it => { it.prev *= p.factor; });
    const focusKeys = (industry && industry.focus) || [];
    const items = Object.values(map).map(it => ({
      ...it, curA: it.cur * b.factor,
      share: ratio(it.cur * b.factor, b.a.sales),
      change: p ? growth(it.cur * b.factor, it.prev) : null,
      focus: focusKeys.some(k => it.label.includes(k)),
    })).sort((x, y) => (y.focus - x.focus) || (y.curA - x.curA));
    const has = kws => l => kws.some(k => l.includes(k));
    const sum = (list, pred) => list.filter(it => pred(it.label)).reduce((s, it) => ({ cur: s.cur + it.curA, prev: s.prev + it.prev }), { cur: 0, prev: 0 });
    const labor = sum(items, has(C.laborKeywords));
    const entertain = sum(items, has(C.entertainKeywords));
    const ad = sum(items, has(['광고선전비', '광고비']));
    const interest = [...b.details.nonOpExp].filter(it => C.interestKeywords.some(k => it.label.includes(k))).reduce((s, it) => s + it.value, 0) * b.factor;
    return { items, labor: { ...labor, share: ratio(labor.cur, b.a.sales) }, entertain: { ...entertain, share: ratio(entertain.cur, b.a.sales) }, ad: { ...ad, share: ratio(ad.cur, b.a.sales) }, interest, hasDetail: items.length > 0 };
  }

  /* ---------- 예상 세액 ----------
   * 산출세액 = 과세표준 × 세율 − 누진공제 (국세). 공제·감면 차감 후 국세에 지방소득세 10%.
   * '예상 세액 합계'는 산출 기준이며 기납부세액(중간예납·원천징수)은 빼지 않는다 → 최종 납부세액이 아님.
   */
  function bracketTax(baseAmt, brackets) {
    if (baseAmt <= 0) return 0;
    for (const br of brackets) if (baseAmt <= br.limit) return baseAmt * br.rate - br.deduction;
    return 0;
  }
  function bracketInfo(taxBase, brackets) {
    let idx = brackets.findIndex(br => taxBase <= br.limit); if (idx < 0) idx = brackets.length - 1;
    const br = brackets[idx]; const lower = idx > 0 ? brackets[idx - 1].limit : 0;
    const next = brackets[idx + 1] || null;
    return { idx, rate: br.rate * 100, lower, upper: isFinite(br.limit) ? br.limit : null, room: isFinite(br.limit) ? br.limit - taxBase : null, nextRate: next ? next.rate * 100 : null, taxBase, inBracket: taxBase - lower };
  }

  /* 추가 비용 항목 정규화: {label, type, amount(지출), allowed(인정 예상액, null=자동), status('done'|'review')} */
  function normalizeExtra(e, entity) {
    const type = C.extraTypes.find(t => t.key === e.type) || C.extraTypes[0];
    const amount = Math.max(0, e.amount || 0);
    const defaultRate = (entity === 'corp' && type.allowCorp !== undefined) ? type.allowCorp : type.allow;
    const auto = (e.allowed === null || e.allowed === undefined);
    const allowed = auto ? Math.round(amount * defaultRate) : Math.max(0, Math.min(amount, e.allowed));
    return { label: e.label || type.label, type: type.key, typeLabel: type.label, note: type.note, amount, allowed, status: e.status === 'done' ? 'done' : 'review', autoAllowed: auto, defaultRate };
  }

  function estimateTax(b, opts) {
    const entity = opts.entityType || C.defaultEntity || 'indiv';
    const credit = Math.min(1, Math.max(0, (opts.creditRate || 0) / 100));
    const creditFixed = Math.max(0, opts.creditAmount || 0);
    const loss = Math.max(0, opts.lossCarry || 0);
    const bt = getBrackets(b.year, entity);
    const calc = (pretax) => {
      const ded = entity === 'indiv' ? C.individualBasicDeduction : 0;
      const taxBase = Math.max(0, pretax - loss - ded);           // 음수 과세표준은 0
      const computed = Math.max(0, bracketTax(taxBase, bt.list)); // 산출세액(국세)
      const creditAmt = Math.min(computed, computed * credit + creditFixed);
      const national = computed - creditAmt;                      // 공제·감면 후 국세
      const local = national * C.localTaxRate;                    // 지방소득세
      return { taxBase, computed, creditAmt, national, local, total: national + local };
    };
    const hasCredit = !!(opts.creditType && opts.creditType !== 'none') && (credit > 0 || creditFixed > 0);
    let creditLabel = '';
    if (hasCredit) {
      creditLabel = (opts.creditLabel || '공제·감면').replace(' (직접 입력)', ' 공제·감면');
      const parts = []; if (credit > 0) parts.push(`${credit * 100}%`); if (creditFixed > 0) parts.push(`${Fmt.won(creditFixed)}원`);
      if (parts.length) creditLabel += ` (${parts.join(' + ')})`;
    }
    const annual = calc(b.a.pretax), actual = calc(b.m.pretax);

    // 추가 비용 시뮬레이션: 검토 완료 항목의 '비용 인정 예상액'만 차감
    const extras = (opts.extras || []).filter(e => e && e.amount > 0).map(e => normalizeExtra(e, entity));
    const applied = extras.filter(e => e.status === 'done' && e.allowed > 0);
    const pending = extras.filter(e => e.status !== 'done');
    const allowedTotal = applied.reduce((s, e) => s + e.allowed, 0);
    const spendTotal = applied.reduce((s, e) => s + e.amount, 0);
    let extra = null;
    if (allowedTotal > 0 && annual.total > 0) {
      const after = calc(b.a.pretax - allowedTotal);
      const saved = annual.total - after.total;
      extra = { items: applied, pending, total: allowedTotal, spend: spendTotal, after, saved, marginal: saved / allowedTotal * 100, netCost: spendTotal - saved, pretaxAfter: b.a.pretax - allowedTotal };
    }
    const bracket = annual.taxBase > 0 ? { list: bt.list, annual: bracketInfo(annual.taxBase, bt.list), actual: actual.taxBase > 0 ? bracketInfo(actual.taxBase, bt.list) : null, after: extra && extra.after.taxBase > 0 ? bracketInfo(extra.after.taxBase, bt.list) : null } : null;
    return { entity, tableYear: bt.year, tableExact: bt.exact, creditType: opts.creditType || 'none', creditRate: credit * 100, creditAmount: creditFixed, creditLabel, hasCredit, loss, actual, annual, extra, pendingExtras: pending, allExtras: extras, bracket, noTax: actual.computed <= 0 && annual.computed <= 0 };
  }

  /* ---------- 진단 문구: 확인된 사실 → 왜 봐야 하는지 → 조치 ---------- */
  function buildFeedback(rows, cost, tax, same, industry, opts) {
    const T = C.thresholds;
    const b = rows[rows.length - 1], p = rows[rows.length - 2] || null, pp = rows[rows.length - 3] || null;
    const est = b.factor !== 1;
    const estTag = est ? '연환산 기준 ' : '';
    const nm = tax.entity === 'indiv' ? '종합소득세' : '법인세';
    const points = [];
    const push = (tone, title, body) => points.push({ tone, title, body });
    const gw = Fmt.growthWord;

    // 1. 매출
    if (p && b.g.sales !== null) {
      const g = b.g.sales; const w = gw(g);
      const sameTxt = same && same.g.sales !== null ? ` 전년 같은 기간(${same.months}개월) 실제 실적과 비교하면 ${gw(same.g.sales)}입니다.` : '';
      if (Math.abs(g) <= T.growthFlat) push('info', '매출은 전년 수준', `${estTag}올해 매출 ${Fmt.man(b.a.sales)}로 전년(${Fmt.man(p.a.sales)})과 비슷한 수준이 예상됩니다.${sameTxt}`);
      else if (g > 0) push('good', `매출 ${w} 예상`, `${estTag}올해 매출 ${Fmt.man(b.a.sales)}로 전년 ${Fmt.man(p.a.sales)} 대비 ${w}가 예상됩니다.${sameTxt}` + (pp && p.g.sales !== null && p.g.sales > T.growthFlat ? ' 2년 연속 성장 흐름입니다.' : '') + (est ? ' 남은 기간 매출 추이에 따라 달라질 수 있습니다.' : ''));
      else push('warn', `매출 ${w} 예상`, `${estTag}올해 매출 ${Fmt.man(b.a.sales)}로 전년 ${Fmt.man(p.a.sales)} 대비 ${w}가 예상됩니다.${sameTxt} 거래처·품목별로 어디서 줄었는지 확인이 필요하며, 매출 감소가 이어지면 고정비 조정을 함께 검토하겠습니다.`);
    } else {
      push('info', '올해 매출', `${estTag}올해 매출은 ${Fmt.man(b.a.sales)}입니다.` + (p ? '' : ' 전년 손익계산서를 함께 올리면 추이를 비교해 드립니다.'));
    }

    // 2. 영업이익
    {
      const om = b.r.opMargin;
      const turned = p ? ((p.a.op <= 0 && b.a.op > 0) ? 'toProfit' : (p.a.op > 0 && b.a.op <= 0) ? 'toLoss' : null) : null;
      if (turned === 'toProfit') push('good', '흑자 전환 예상', `전년 영업손실 ${Fmt.man(Math.abs(p.a.op))}에서 ${estTag}올해 영업이익 ${Fmt.man(b.a.op)}으로 돌아설 것으로 보입니다. 이익이 생기는 만큼 세금이 함께 발생하므로 하반기 세부담을 미리 준비하겠습니다.`);
      else if (turned === 'toLoss') push('warn', '적자 전환 예상', `전년 영업이익 ${Fmt.man(p.a.op)}에서 ${estTag}올해 영업손실 ${Fmt.man(Math.abs(b.a.op))}으로 돌아설 것으로 보입니다. 매출 대비 비용이 커진 원인(원가·인건비·임차료)을 항목별로 확인하겠습니다.`);
      else if (b.a.op <= 0) push('warn', '영업손실 지속', `${estTag}올해 영업손실 ${Fmt.man(Math.abs(b.a.op))}이 예상됩니다. 매출 ${Fmt.man(b.a.sales)}보다 비용 ${Fmt.man(b.a.cogs + b.a.sga)}이 큽니다. 고정비 가운데 줄일 수 있는 항목이 있는지 함께 점검하겠습니다.`);
      else if (om !== null && om < T.opMarginLow) push('warn', '영업이익률 낮음', `매출 100원당 영업이익 ${om.toFixed(1)}원(영업이익률 ${Fmt.pct(om)})으로 낮은 편입니다. 판매가격·원가·고정비 중 어디서 이익이 줄어드는지 확인이 필요합니다.`);
      else if (om !== null && om >= T.opMarginGood) push('good', '영업이익률 양호', `매출 100원당 영업이익 ${om.toFixed(1)}원(영업이익률 ${Fmt.pct(om)})으로 양호합니다.` + (p && p.r.opMargin !== null ? ` 전년 ${Fmt.pct(p.r.opMargin)}에서 ${om >= p.r.opMargin ? '개선' : '다소 하락'}했습니다.` : '') + ' 이익 규모에 맞춰 세부담도 커지므로 공제·감면 적용 가능성을 검토하겠습니다.');
      else if (om !== null) push('info', '영업이익률 보통', `영업이익률 ${Fmt.pct(om)}` + (p && p.r.opMargin !== null ? `로 전년 ${Fmt.pct(p.r.opMargin)} 대비 ${om >= p.r.opMargin ? '개선' : '하락'}했습니다.` : '입니다.'));
    }

    // 3. 원가율 (원가가 있는 업종)
    if (p && b.a.cogs > 0 && p.a.cogs > 0 && b.r.grossMargin !== null && p.r.grossMargin !== null) {
      const d = b.r.grossMargin - p.r.grossMargin;
      if (Math.abs(d) >= 3) push(d > 0 ? 'good' : 'warn', d > 0 ? '원가율 개선' : '원가율 상승',
        `매출총이익률이 전년 ${Fmt.pct(p.r.grossMargin)}에서 ${estTag}${Fmt.pct(b.r.grossMargin)}로 ${Math.abs(d).toFixed(1)}%p ${d > 0 ? '올랐습니다. 매입단가 관리가 잘 되고 있는 것으로 보입니다.' : '내려갔습니다. 매입단가 상승인지 판매가격 변동인지 확인이 필요하며, 재고 반영 여부도 결산 때 점검하겠습니다.'}`);
    } else if (industry && industry.cogs && b.a.cogs === 0 && b.a.sales > 0) {
      push('info', '매출원가 미반영', `${industry.label}인데 매출원가가 0으로 잡혀 있습니다. 매입·재고가 아직 장부에 반영되지 않았을 수 있어 결산 전 매입 자료를 확인하겠습니다.`);
    }

    // 4. 비용 — 크게 늘거나 줄어든 항목
    if (cost.hasDetail && p) {
      const surges = cost.items.filter(it => it.change !== null && it.change >= T.itemSurgePct && it.share !== null && it.share >= T.itemMinShare && it.prev > 0).sort((x, y) => y.curA - x.curA);
      if (surges.length) {
        const it = surges[0]; const others = surges.slice(1, 3).map(x => x.label).join('·');
        push('warn', `${it.label} ${gw(it.change)} 예상`, `${it.label}가 전년 ${Fmt.man(it.prev)}에서 ${estTag}${Fmt.man(it.curA)}으로 ${gw(it.change)}할 것으로 예상됩니다${others ? ` (${others}도 증가)` : ''}. 일시적인 지출인지 확인하고, 업무 관련 증빙을 함께 점검하겠습니다.`);
      }
      const drops = cost.items.filter(it => it.change !== null && it.change <= -70 && p.a.sales > 0 && it.prev / Math.abs(p.a.sales) * 100 >= T.itemMinShare);
      if (drops.length) push('info', '크게 줄어든 비용', drops.slice(0, 3).map(it => `${it.label} ${Fmt.man(it.prev)} → ${Fmt.man(it.curA)}`).join(', ') + '. 실제로 줄어든 것인지, 아직 장부에 반영되지 않은 지출이 있는지 확인이 필요합니다. 누락된 비용이 있으면 이익과 세금이 실제보다 크게 계산됩니다.');
    }
    if (cost.hasDetail && cost.labor.share !== null && cost.labor.share >= T.laborRatioHigh) push('warn', '인건비 비중 높음', `인건비(급여·상여 등)가 매출의 ${Fmt.pct(cost.labor.share)}입니다. 인력 대비 매출이 충분한지 점검이 필요하며, 고용 관련 세액공제 요건에 해당하는지 확인하겠습니다.`);
    if (industry && industry.key === 'retail' && cost.ad.share !== null && cost.ad.share >= T.adRatioHigh) push('warn', '광고비 비중 높음', `광고선전비가 매출의 ${Fmt.pct(cost.ad.share)}입니다. 광고비 대비 매출 효과(채널별 성과)를 점검하고, 플랫폼 수수료와 함께 마진 구조를 확인할 필요가 있습니다.`);
    if (industry && industry.key === 'professional' && cost.entertain.cur > 0 && cost.entertain.share !== null && cost.entertain.share >= 2) push('info', '기업업무추진비 증빙', `기업업무추진비가 ${estTag}${Fmt.man(cost.entertain.cur)}(매출의 ${Fmt.pct(cost.entertain.share)})입니다. 한도를 넘는 금액은 비용으로 인정되지 않으므로, 건당 증빙(3만원 초과 시 법정 증빙)을 함께 점검하겠습니다.`);

    // 5. 이자 부담
    if (cost.interest > 0 && b.a.sales > 0) {
      const sh = ratio(cost.interest, b.a.sales);
      if (sh >= 2) push('warn', '이자 부담', `이자비용이 ${estTag}${Fmt.man(cost.interest)}로 매출의 ${Fmt.pct(sh)}입니다. 차입 규모와 금리 조건을 점검할 필요가 있습니다.`);
    }

    // 6. 순이익·세금
    {
      const net = b.a.net; const tx = tax.annual;
      if (net > 0) {
        let s = `${estTag}올해 당기순이익 ${Fmt.man(net)}` + (b.r.netMargin !== null ? `(순이익률 ${Fmt.pct(b.r.netMargin)})` : '') + '이 예상됩니다.';
        if (tx.total > 0) s += ` 이대로 결산하면 기본세율 기준 ${nm} 예상 산출세액은 약 ${Fmt.man(tx.total)}(지방소득세 포함)입니다. 기납부세액과 공제·감면에 따라 실제 납부액은 달라집니다.`;
        else s += ` 공제·감면 적용 후 ${nm}는 거의 발생하지 않을 것으로 보입니다.`;
        if (tax.bracket) { const bi = tax.bracket.annual; s += ` 과세표준 ${Fmt.man(bi.taxBase)}은 ${bi.rate}% 구간이며, 상위 세율은 구간을 초과하는 금액에만 적용됩니다.`; }
        push('info', '예상 순이익과 세금', s);
      } else {
        push('info', '순손실 예상', `${estTag}올해 당기순손실 ${Fmt.man(Math.abs(net))}` + (b.r.netMargin !== null ? `(매출 대비 ${Fmt.pct(Math.abs(b.r.netMargin))})` : '') + '이 예상됩니다. 손실은 다음 해 이익에서 공제(이월결손금)되므로 신고를 빠뜨리지 않는 것이 중요합니다.');
      }
    }

    // 7. 추가 비용 시뮬레이션 (검토 완료 항목만)
    if (tax.extra) {
      const x = tax.extra;
      push('good', '추가 비용 반영 시 예상 세액 변화', `검토가 끝난 추가 비용 ${Fmt.man(x.spend)} 중 올해 비용으로 인정될 것으로 보는 ${Fmt.man(x.total)}을 반영하면 예상 세액은 ${Fmt.man(tax.annual.total)}에서 ${Fmt.man(x.after.total)}으로 약 ${Fmt.man(x.saved)} 줄어듭니다(추정치). 실제 지출과 증빙이 있어야 하며, 결산 때 인정 금액을 다시 확인하겠습니다.`);
    }
    if (tax.pendingExtras && tax.pendingExtras.length && !tax.noTax) {
      push('info', '검토 중인 지출 계획', tax.pendingExtras.map(e => `${e.label} ${Fmt.man(e.amount)}`).join(', ') + '은 세무상 비용 인정 여부를 검토한 뒤 반영 여부를 알려드리겠습니다. 예상 세액에는 아직 반영하지 않았습니다.');
    }

    // 최대 6개: 넘치면 '참고' 성격부터 뺀다
    while (points.length > 6) { const i = points.map(x => x.tone).lastIndexOf('info'); points.splice(i >= 0 ? i : points.length - 1, 1); }

    const summary = buildSummary(rows, same, est);
    const note = est ? `올해 수치는 ${b.startMonth || 1}~${b.endMonth || b.months}월 ${b.months}개월 실적을 12개월로 단순 환산한 추정치입니다. 매출이 몰리는 달이나 연말 큰 지출이 있으면 실제와 차이가 날 수 있습니다.` : '';
    return { summary, note, points };
  }

  function buildSummary(rows, same, est) {
    const b = rows[rows.length - 1], p = rows[rows.length - 2];
    const g = p ? b.g.sales : null;
    const salesWord = g === null ? '' : Math.abs(g) <= C.thresholds.growthFlat ? '매출은 전년 수준을 유지하고' : `매출은 전년 대비 ${Fmt.growthWord(g)}가 예상되고`;
    const profitWord = b.a.op > 0 ? `영업이익 ${Fmt.man(b.a.op)}(이익률 ${Fmt.pct(b.r.opMargin)})이 예상됩니다` : `영업손실 ${Fmt.man(Math.abs(b.a.op))}이 예상됩니다`;
    const turn = p ? ((p.a.op <= 0 && b.a.op > 0) ? ' 전년 적자에서 흑자로 돌아서는 해입니다.' : (p.a.op > 0 && b.a.op <= 0) ? ' 전년 흑자에서 적자로 돌아서는 점이 가장 큰 변화입니다.' : '') : '';
    return `${b.year}년은 ${est ? '지금 추세대로라면(연환산 기준) ' : ''}${salesWord ? salesWord + ', ' : ''}${profitWord}.${turn}`;
  }

  /* ---------- 실행계획: 거래처 확인사항 / 사무소 관리계획 (자동 생성, 담당자가 수정 가능) ---------- */
  function buildPlan(rows, cost, tax, same, industry, opts) {
    const b = rows[rows.length - 1]; const p = rows[rows.length - 2] || null;
    const loss = b.a.pretax <= 0; const est = b.factor !== 1;
    const endM = b.endMonth || 12;
    // 기한: 실적 종료월+2개월과 보고일 다음 달 중 늦은 쪽(12월을 넘지 않음)
    const rd = opts.reportDate instanceof Date ? opts.reportDate : null;
    const nextOfReport = rd && rd.getFullYear() === b.year ? rd.getMonth() + 2 : 0;
    const dueM = Math.min(12, Math.max(endM + 2, nextOfReport));
    const due = (rd && rd.getFullYear() > b.year) ? `${rd.getFullYear()}년 ${rd.getMonth() + 1}월 말` : `${b.year}년 ${dueM}월 말`;
    const client = [], office = [];
    client.push({ text: '아직 전달하지 않은 매출·매입 세금계산서, 카드·현금영수증 등 증빙 전달', due: '매월 말' });
    if (cost.hasDetail && cost.labor.cur === 0) client.push({ text: tax.entity === 'corp' ? '대표이사 급여 책정 여부·금액 결정 (급여 반영에 따라 법인세가 달라집니다)' : '급여 지급이 있었다면 지급 내역 전달', due });
    if (!loss) {
      client.push({ text: '연말까지 예정된 큰 지출(비품·차량·퇴직연금 등)과 채용·급여 변경 계획 공유', due });
      if (tax.annual.total > 0) client.push({ text: `${est ? '내년 신고 때' : '신고 때'} 납부할 세금(예상 산출세액 약 ${Fmt.man(tax.annual.total)}, 기납부세액 차감 전) 자금 준비`, due: `${b.year + 1}년 ${tax.entity === 'corp' ? '3월' : '5월'}` });
    } else {
      client.push({ text: '매출·매입 자료를 결산 전까지 제때 전달 (손실을 다음 해에 공제받으려면 기한 내 신고 필요)', due });
    }
    if (tax.pendingExtras && tax.pendingExtras.length) client.push({ text: `검토 중인 지출(${tax.pendingExtras.map(e => e.label).join(', ')}) 관련 계약서·견적서 전달`, due });

    office.push({ text: '결산 전 누락 경비·미반영 매입 점검 및 장부 반영' });
    if (!loss) {
      office.push({ text: `적용 가능한 공제·감면 검토${tax.hasCredit ? ` (${tax.creditLabel.split(' (')[0]} 요건 재확인 포함)` : ' (고용증대·창업감면·중소기업특별세액감면 등)'}` });
      office.push({ text: `${tax.entity === 'corp' ? '중간예납' : '중간예납·원천징수'} 등 기납부세액을 반영한 최종 납부 예상액 재산정` });
      if (tax.extra || (tax.pendingExtras && tax.pendingExtras.length)) office.push({ text: '추가 지출 계획의 세무상 비용 인정 여부 검토 후 예상 세액 재계산' });
    } else {
      office.push({ text: '결손금이 다음 해에 공제되도록 결산·신고 시 이월결손금 반영' });
    }
    if (cost.hasDetail && cost.entertain.cur > 0) office.push({ text: '기업업무추진비 한도 및 증빙 점검' });
    if (b.a.cogs > 0) office.push({ text: '기말 재고 반영 후 매출원가 확정' });
    if (industry && industry.key === 'retail') office.push({ text: '플랫폼 수수료·광고비 매칭 자료 확인 및 매출 누락 점검' });
    return { client: client.slice(0, 4), office: office.slice(0, 4), due };
  }

  window.Analysis = { Fmt, MAJOR_KEYS, MAJOR_LABEL, TOTAL_CALC, mergeStatements, analyze, emptyYear, fillDerived, getBrackets, normalizeExtra, validate };
})();
