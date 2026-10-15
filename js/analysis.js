/* =====================================================================
 *  analysis.js — 연도 병합 · 12개월 환산 · 비율 · 진단 문구 · 예상 세액
 * ===================================================================== */
(function () {
  'use strict';
  const C = window.CONFIG;
  const MAJOR_KEYS = ['sales', 'cogs', 'gross', 'sga', 'op', 'nonOpInc', 'nonOpExp', 'pretax', 'tax', 'net'];
  const MAJOR_LABEL = {
    sales: '매출액', cogs: '매출원가', gross: '매출총이익', sga: '판매비와관리비', op: '영업이익',
    nonOpInc: '영업외수익', nonOpExp: '영업외비용', pretax: '세전이익', tax: '법인세등', net: '당기순이익',
  };

  /* ---------- 숫자 표기 ---------- */
  const Fmt = {
    won(n) { if (n === null || n === undefined || isNaN(n)) return '-'; return Math.round(n).toLocaleString('ko-KR'); },
    wonUnit(n, unit) { // unit: 1(원) | 1000(천원) | 1000000(백만원)
      if (n === null || n === undefined || isNaN(n)) return '-';
      return Math.round(n / unit).toLocaleString('ko-KR');
    },
    // 사장님용 읽기 쉬운 금액: 1억 2,352만원 / 5,223만원 / 7,500원
    man(n, opt) {
      if (n === null || n === undefined || isNaN(n)) return '-';
      const neg = n < 0; const a = Math.abs(Math.round(n));
      let s;
      if (a >= 100000000) {
        const eok = Math.floor(a / 100000000);
        const man = Math.round((a % 100000000) / 10000);
        s = man > 0 ? `${eok.toLocaleString('ko-KR')}억 ${man.toLocaleString('ko-KR')}만원` : `${eok.toLocaleString('ko-KR')}억원`;
      } else if (a >= 10000) {
        s = `${Math.round(a / 10000).toLocaleString('ko-KR')}만원`;
      } else {
        s = `${a.toLocaleString('ko-KR')}원`;
      }
      if (neg) s = (opt && opt.lossWord ? '손실 ' : '−') + s;
      return s;
    },
    pct(x, d) { if (x === null || x === undefined || isNaN(x) || !isFinite(x)) return '-'; return `${x.toFixed(d === undefined ? 1 : d)}%`; },
    delta(x) { // 증감률 화살표
      if (x === null || x === undefined || isNaN(x) || !isFinite(x)) return '-';
      const a = Math.abs(x).toFixed(1);
      return x > 0 ? `▲ ${a}%` : x < 0 ? `▼ ${a}%` : '0.0%';
    },
  };

  /* ---------- 연도 병합 ---------- */
  function emptyYear(year) {
    return { year, months: 12, source: 'manual', fileName: '', m: {}, details: { sales: [], cogs: [], sga: [], nonOpInc: [], nonOpExp: [] } };
  }

  function periodToYear(stmt, per) {
    const y = emptyYear(per.year);
    y.months = per.months || 12; y.source = per.kind; y.fileName = stmt.fileName;
    y.startMonth = per.startMonth; y.endMonth = per.endMonth;
    for (const it of per.items) {
      if (it.level === 'major' && it.key) { if (y.m[it.key] === undefined) y.m[it.key] = it.value; }
      else if (it.level === 'detail' && it.section && y.details[it.section]) y.details[it.section].push({ label: it.label, value: it.value });
    }
    return y;
  }

  /** statements: Parser 결과 배열, manual: {year: {m:{...}}} */
  function mergeStatements(statements, manualYears) {
    const byYear = {}; const warnings = [];
    for (const s of statements) {
      for (const per of s.periods) {
        if (!per.year) { warnings.push(`${s.fileName}: 회계기간을 읽지 못해 건너뛰었습니다.`); continue; }
        const y = periodToYear(s, per);
        const ex = byYear[per.year];
        if (!ex) { byYear[per.year] = y; continue; }
        // 같은 연도가 두 파일에 있으면 '당기' 자료를 우선
        const pick = (ex.source === 'cur' && y.source !== 'cur') ? ex : y;
        const other = pick === ex ? y : ex;
        if (ex.m.sales !== undefined && y.m.sales !== undefined && ex.m.sales !== y.m.sales) {
          warnings.push(`${per.year}년 매출액이 파일마다 다릅니다 (${Fmt.won(ex.m.sales)} / ${Fmt.won(y.m.sales)}). '${pick.fileName}' 의 값을 사용했습니다.`);
        }
        byYear[per.year] = pick;
        void other;
      }
    }
    if (manualYears) for (const [yr, d] of Object.entries(manualYears)) {
      if (!byYear[yr]) byYear[yr] = emptyYear(+yr);
      Object.assign(byYear[yr].m, d.m || {});
      if (d.months) byYear[yr].months = d.months;
    }
    const years = Object.values(byYear).sort((a, b) => a.year - b.year).slice(-3);
    years.forEach(fillDerived);
    return { years, warnings };
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

  /* ---------- 분석 ---------- */
  const ratio = (a, b) => (b && b !== 0) ? a / Math.abs(b) * 100 : null;
  const growth = (cur, prev) => (prev && prev !== 0) ? (cur - prev) / Math.abs(prev) * 100 : null;

  function analyze(years, opts) {
    opts = opts || {};
    if (!years.length) return null;
    const base = years[years.length - 1];
    const factor = base.months > 0 && base.months < 12 ? 12 / base.months : 1;

    const rows = years.map((y, i) => {
      const isBase = y === base;
      const f = isBase ? factor : 1;
      const a = {}; for (const k of MAJOR_KEYS) a[k] = y.m[k] * f;
      const r = {
        grossMargin: ratio(a.gross, a.sales), opMargin: ratio(a.op, a.sales), netMargin: ratio(a.net, a.sales),
        sgaRatio: ratio(a.sga, a.sales), cogsRatio: ratio(a.cogs, a.sales),
      };
      return { ...y, isBase, factor: f, a, r, g: {} };
    });
    for (let i = 1; i < rows.length; i++) {
      const p = rows[i - 1].a, c = rows[i].a;
      rows[i].g = { sales: growth(c.sales, p.sales), gross: growth(c.gross, p.gross), op: growth(c.op, p.op), net: growth(c.net, p.net), sga: growth(c.sga, p.sga) };
    }

    const cost = costStructure(rows);
    const tax = estimateTax(rows[rows.length - 1], opts);
    const feedback = buildFeedback(rows, cost, tax, opts);
    return { base: rows[rows.length - 1], prev: rows[rows.length - 2] || null, rows, factor, cost, tax, feedback, labels: MAJOR_LABEL };
  }

  /* 판관비 구조: 올해(연환산) 기준 큰 항목 */
  function costStructure(rows) {
    const b = rows[rows.length - 1], p = rows[rows.length - 2];
    const map = {};
    const add = (list, who) => list.forEach(it => { const k = it.label; if (!map[k]) map[k] = { label: k, cur: 0, prev: 0 }; map[k][who] += it.value; });
    add(b.details.sga, 'cur'); if (p) add(p.details.sga, 'prev');
    const items = Object.values(map).map(it => ({
      ...it, curA: it.cur * b.factor,
      share: ratio(it.cur * b.factor, b.a.sales),
      change: p ? growth(it.cur * b.factor, it.prev) : null,
    })).sort((x, y) => y.curA - x.curA);
    const isLabor = l => C.laborKeywords.some(k => l.includes(k));
    const labor = items.filter(it => isLabor(it.label)).reduce((s, it) => ({ cur: s.cur + it.curA, prev: s.prev + it.prev }), { cur: 0, prev: 0 });
    const interest = [...b.details.nonOpExp].filter(it => C.interestKeywords.some(k => it.label.includes(k))).reduce((s, it) => s + it.value, 0) * b.factor;
    return { items, labor: { ...labor, share: ratio(labor.cur, b.a.sales) }, interest, hasDetail: items.length > 0 };
  }

  /* 예상 세액 (연환산 세전이익 기준, 단순 추정) */
  function bracketTax(baseAmt, brackets) {
    if (baseAmt <= 0) return 0;
    for (const br of brackets) if (baseAmt <= br.limit) return baseAmt * br.rate - br.deduction;
    return 0;
  }
  function estimateTax(b, opts) {
    const entity = opts.entityType || 'corp';
    const credit = Math.min(1, Math.max(0, (opts.creditRate || 0) / 100));
    const loss = Math.max(0, opts.lossCarry || 0);
    const calc = (pretax) => {
      const ded = entity === 'indiv' ? C.individualBasicDeduction : 0;
      const taxBase = Math.max(0, pretax - loss - ded);
      const brackets = entity === 'indiv' ? C.individualBrackets : C.corporateBrackets;
      const computed = Math.max(0, bracketTax(taxBase, brackets));
      const creditAmt = computed * credit;
      const national = computed - creditAmt;
      const local = national * C.localTaxRate;
      return { taxBase, computed, creditAmt, national, local, total: national + local };
    };
    return { entity, creditRate: credit * 100, loss, actual: calc(b.m.pretax), annual: calc(b.a.pretax) };
  }

  /* ---------- 진단 문구 (규칙 기반) ---------- */
  function buildFeedback(rows, cost, tax, opts) {
    const T = C.thresholds;
    const b = rows[rows.length - 1], p = rows[rows.length - 2] || null, pp = rows[rows.length - 3] || null;
    const yr = b.year, mon = b.months;
    const est = b.isBase && b.factor !== 1;
    const estWord = est ? '연환산 기준 ' : '';
    const points = [];
    const push = (tone, title, body) => points.push({ tone, title, body });

    // 1. 매출
    if (p) {
      const g = b.g.sales;
      if (g === null) push('info', '매출', `전년 매출 자료가 없어 증감을 비교하지 못했습니다. 올해 ${estWord}매출은 ${Fmt.man(b.a.sales)}입니다.`);
      else if (Math.abs(g) <= T.growthFlat) push('info', '매출은 전년과 비슷한 수준', `올해 ${estWord}매출 ${Fmt.man(b.a.sales)}로 전년(${Fmt.man(p.a.sales)})과 비슷합니다(${Fmt.delta(g)}).`);
      else if (g > 0) {
        let s = `올해 ${estWord}매출은 ${Fmt.man(b.a.sales)}로 전년 ${Fmt.man(p.a.sales)}보다 ${g.toFixed(1)}% 늘어날 것으로 보입니다.`;
        if (pp && p.g.sales !== null && p.g.sales > T.growthFlat) s += ' 2년 연속 성장 흐름입니다.';
        push('good', '매출 증가', s);
      } else {
        let s = `올해 ${estWord}매출은 ${Fmt.man(b.a.sales)}로 전년 ${Fmt.man(p.a.sales)}보다 ${Math.abs(g).toFixed(1)}% 줄어들 것으로 보입니다.`;
        if (pp && p.g.sales !== null && p.g.sales < -T.growthFlat) s += ' 2년 연속 감소라 원인 점검이 필요합니다.';
        else s += ' 남은 기간 매출 회복 여부를 지켜봐야 합니다.';
        push('warn', '매출 감소', s);
      }
    } else {
      push('info', '매출', `올해 ${estWord}매출은 ${Fmt.man(b.a.sales)}입니다. 전년 자료를 함께 올리면 추이를 비교해 드립니다.`);
    }

    // 2. 영업이익·수익성
    {
      const om = b.r.opMargin;
      const turned = p ? ((p.a.op <= 0 && b.a.op > 0) ? 'toProfit' : (p.a.op > 0 && b.a.op <= 0) ? 'toLoss' : null) : null;
      if (turned === 'toProfit') push('good', '영업이익 흑자 전환', `전년 영업손실 ${Fmt.man(Math.abs(p.a.op))}에서 올해 ${estWord}영업이익 ${Fmt.man(b.a.op)}으로 흑자 전환이 예상됩니다.`);
      else if (turned === 'toLoss') push('warn', '영업이익 적자 전환', `전년 영업이익 ${Fmt.man(p.a.op)}에서 올해 ${estWord}영업손실 ${Fmt.man(Math.abs(b.a.op))}으로 적자가 예상됩니다. 매출 대비 비용 구조를 먼저 살펴봐야 합니다.`);
      else if (b.a.op <= 0) push('warn', '영업손실 지속', `올해 ${estWord}영업손실은 ${Fmt.man(Math.abs(b.a.op))}입니다. 매출 ${Fmt.man(b.a.sales)}에 비해 비용(매출원가+판관비) ${Fmt.man(b.a.cogs + b.a.sga)}이 더 큽니다.`);
      else if (om !== null && om < T.opMarginLow) push('warn', '영업이익률 낮음', `매출 100원당 영업이익이 ${om.toFixed(1)}원(영업이익률 ${Fmt.pct(om)})으로 낮은 편입니다. 가격·원가·고정비 중 어디서 이익이 새는지 확인이 필요합니다.`);
      else if (om !== null && om >= T.opMarginGood) push('good', '영업이익률 양호', `매출 100원당 영업이익이 ${om.toFixed(1)}원(영업이익률 ${Fmt.pct(om)})으로 양호합니다.` + (p && p.r.opMargin !== null ? ` 전년 ${Fmt.pct(p.r.opMargin)}에서 ${om >= p.r.opMargin ? '개선' : '다소 하락'}했습니다.` : ''));
      else if (om !== null) push('info', '영업이익률 보통', `영업이익률은 ${Fmt.pct(om)}입니다.` + (p && p.r.opMargin !== null ? ` 전년 ${Fmt.pct(p.r.opMargin)} 대비 ${om >= p.r.opMargin ? '개선' : '하락'}했습니다.` : ''));
    }

    // 3. 매출총이익률 변화 (원가가 있는 업종)
    if (p && b.a.cogs > 0 && p.a.cogs > 0 && b.r.grossMargin !== null && p.r.grossMargin !== null) {
      const d = b.r.grossMargin - p.r.grossMargin;
      if (Math.abs(d) >= 3) push(d > 0 ? 'good' : 'warn', d > 0 ? '원가율 개선' : '원가율 상승',
        `매출총이익률이 전년 ${Fmt.pct(p.r.grossMargin)}에서 ${Fmt.pct(b.r.grossMargin)}로 ${Math.abs(d).toFixed(1)}%p ${d > 0 ? '올랐습니다. 원가 관리가 잘 되고 있습니다.' : '내려갔습니다. 매입단가나 판매가격 변동을 확인해 보세요.'}`);
    }

    // 4. 판관비·비용 구조
    if (cost.hasDetail) {
      const top = cost.items.slice(0, 3).filter(it => it.curA > 0);
      if (top.length) {
        const s = top.map(it => `${it.label} ${Fmt.man(it.curA)}(매출의 ${Fmt.pct(it.share)})`).join(', ');
        push('info', '비용은 어디에 많이 쓰이나', `판관비 중 큰 항목은 ${s} 순입니다.` + (b.r.sgaRatio !== null ? ` 판관비 전체는 매출의 ${Fmt.pct(b.r.sgaRatio)}` + (p && p.r.sgaRatio !== null ? `(전년 ${Fmt.pct(p.r.sgaRatio)})` : '') + '입니다.' : ''));
      }
      if (p) {
        const surges = cost.items.filter(it => it.change !== null && it.change >= T.itemSurgePct && it.share !== null && it.share >= T.itemMinShare && it.prev > 0);
        if (surges.length) {
          const s = surges.slice(0, 3).map(it => `${it.label}(${Fmt.man(it.prev)} → ${Fmt.man(it.curA)}, ${Fmt.delta(it.change)})`).join(', ');
          push('warn', '전년보다 크게 늘어난 비용', `${estWord}${s}. 증가 이유가 일시적인지 구조적인지 확인이 필요합니다.`);
        }
        // 전년에 컸는데 올해 거의 사라진 비용 (급여 미반영 등 장부 누락 가능성)
        const drops = cost.items.filter(it => it.change !== null && it.change <= -70 && p.a.sales > 0 && it.prev / Math.abs(p.a.sales) * 100 >= T.itemMinShare);
        if (drops.length) {
          const s = drops.slice(0, 3).map(it => `${it.label}(전년 ${Fmt.man(it.prev)} → 올해 ${Fmt.man(it.curA)})`).join(', ');
          push('warn', '전년보다 크게 줄어든 비용', `${s}. 실제로 줄어든 것인지, 아직 장부에 반영되지 않은 것인지 확인이 필요합니다. 누락된 비용이 있으면 이익과 세금이 실제보다 크게 계산됩니다.`);
        }
      }
      if (cost.labor.share !== null && cost.labor.share >= T.laborRatioHigh) push('warn', '인건비 비중 높음', `인건비(급여·상여 등)가 매출의 ${Fmt.pct(cost.labor.share)}를 차지합니다. 인력 대비 매출이 충분한지 점검해 보세요.`);
    }

    // 5. 영업외 — 이자비용
    if (cost.interest > 0 && b.a.sales > 0) {
      const sh = ratio(cost.interest, b.a.sales);
      if (sh >= 2) push('warn', '이자 부담', `이자비용이 ${estWord}${Fmt.man(cost.interest)}로 매출의 ${Fmt.pct(sh)}입니다. 차입금 규모와 금리 조건을 점검할 필요가 있습니다.`);
    }

    // 6. 당기순이익·세금
    {
      const net = b.a.net;
      if (net > 0) {
        const tx = tax.annual;
        let s = `올해 ${estWord}당기순이익은 ${Fmt.man(net)}` + (b.r.netMargin !== null ? `(순이익률 ${Fmt.pct(b.r.netMargin)})` : '') + '로 예상됩니다.';
        if (tx.total > 0) s += ` 이대로 결산하면 ${tax.entity === 'indiv' ? '종합소득세' : '법인세'}는 지방소득세 포함 약 ${Fmt.man(tx.total)} 수준입니다.`;
        if (est) s += ` 남은 ${12 - mon}개월 동안 누락된 경비·증빙을 챙기고, 적용 가능한 세액공제(고용·투자 등)를 미리 검토하면 세부담을 줄일 수 있습니다.`;
        push(tx.total > 0 ? 'info' : 'good', '예상 순이익과 세금', s);
      } else {
        push('info', '순손실 예상', `올해 ${estWord}당기순손실은 ${Fmt.man(Math.abs(net))}입니다. 올해 세금은 거의 없을 것으로 보이며, 결손금은 이후 연도 이익에서 공제(이월결손금)할 수 있으니 신고를 빠뜨리지 않는 것이 중요합니다.`);
      }
    }

    // 7. 환산 주의
    if (est) push('info', '12개월 환산에 대하여', `올해 수치는 ${b.startMonth || 1}월~${b.endMonth || mon}월 ${mon}개월 실적에 ${(12 / mon).toFixed(2)}배를 곱해 1년치로 추정한 것입니다. 계절적으로 매출이 몰리는 달이 있거나 연말에 큰 지출이 예정되어 있다면 실제 결산과 차이가 날 수 있습니다.`);

    // 총평 한 줄
    const summary = buildSummary(rows, est);
    const checklist = buildChecklist(rows, cost, tax, est);
    return { summary, points, checklist };
  }

  /* 남은 기간 체크리스트 (상황별) */
  function buildChecklist(rows, cost, tax, est) {
    const b = rows[rows.length - 1], p = rows[rows.length - 2] || null;
    const list = [];
    list.push('매출·매입 세금계산서, 카드·현금영수증 등 증빙 누락 여부 점검');
    if (cost.labor.cur === 0 && cost.hasDetail) list.push(tax.entity === 'corp' ? '급여(대표이사 포함)·4대보험이 장부에 반영되지 않았습니다. 급여 책정·반영 여부 확인' : '급여·4대보험 반영 여부 확인');
    else list.push('급여·4대보험·퇴직급여 반영 여부 확인');
    const dep = cost.items.find(it => it.label.includes('감가상각'));
    if (p && dep && dep.prev > 0 && dep.cur === 0) list.push('감가상각비 등 결산 때 반영되는 비용은 아직 빠져 있음 — 기말에 반영 예정');
    else list.push('감가상각비·미지급비용 등 결산조정 항목 반영');
    if (b.a.pretax > 0) {
      list.push('고용증대·통합투자·중소기업특별세액감면 등 적용 가능한 공제·감면 검토');
      if (tax.entity === 'corp' && est) list.push('중간예납 세액과 기납부세액 확인 후 연말 납부 자금 준비');
      else if (est) list.push('연말 납부 자금(예상 세금) 미리 준비');
    } else {
      list.push('결손금 이월공제를 받으려면 기한 내 신고가 필수 — 신고 누락 주의');
    }
    return list.slice(0, 5);
  }

  function buildSummary(rows, est) {
    const b = rows[rows.length - 1], p = rows[rows.length - 2];
    const g = p ? b.g.sales : null;
    const salesWord = g === null ? '' : Math.abs(g) <= C.thresholds.growthFlat ? '매출은 전년 수준을 유지하고' : g > 0 ? `매출은 전년보다 ${g.toFixed(1)}% 늘고` : `매출은 전년보다 ${Math.abs(g).toFixed(1)}% 줄고`;
    const profitWord = b.a.op > 0
      ? `영업이익 ${Fmt.man(b.a.op)}(이익률 ${Fmt.pct(b.r.opMargin)})이 예상됩니다`
      : `영업손실 ${Fmt.man(Math.abs(b.a.op))}이 예상됩니다`;
    const turn = p ? ((p.a.op <= 0 && b.a.op > 0) ? ' 전년 적자에서 흑자로 돌아서는 해입니다.' : (p.a.op > 0 && b.a.op <= 0) ? ' 전년 흑자에서 적자로 돌아서는 점이 가장 큰 변화입니다.' : '') : '';
    return `${b.year}년은 ${est ? '지금 추세대로라면 ' : ''}${salesWord ? salesWord + ', ' : ''}${profitWord}.${turn}`;
  }

  window.Analysis = { Fmt, MAJOR_KEYS, MAJOR_LABEL, mergeStatements, analyze, emptyYear, fillDerived };
})();
