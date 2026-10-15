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
        if (per.items.every(it => !it.value)) { warnings.push(`${s.fileName}: ${per.year}년(${per.kind === 'prev' ? '전기' : '당기'}) 열이 전부 0이라 제외했습니다.`); continue; }
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
    const entity = opts.entityType || C.defaultEntity || 'indiv';
    const credit = Math.min(1, Math.max(0, (opts.creditRate || 0) / 100));
    const creditFixed = Math.max(0, opts.creditAmount || 0);
    const loss = Math.max(0, opts.lossCarry || 0);
    const calc = (pretax) => {
      const ded = entity === 'indiv' ? C.individualBasicDeduction : 0;
      const taxBase = Math.max(0, pretax - loss - ded);
      const brackets = entity === 'indiv' ? C.individualBrackets : C.corporateBrackets;
      const computed = Math.max(0, bracketTax(taxBase, brackets));
      const creditAmt = Math.min(computed, computed * credit + creditFixed); // 산출세액을 넘지 않게
      const national = computed - creditAmt;
      const local = national * C.localTaxRate;
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
    // 추가 비용 시뮬레이션: 연환산 세전이익에서 추가 비용을 뺀 뒤 다시 계산
    const extras = (opts.extras || []).filter(e => e && e.amount > 0);
    const extraTotal = extras.reduce((s, e) => s + e.amount, 0);
    let extra = null;
    if (extraTotal > 0) {
      const after = calc(b.a.pretax - extraTotal);
      const afterActual = calc(b.m.pretax - extraTotal);
      const saved = annual.total - after.total;
      extra = { items: extras, total: extraTotal, after, afterActual, saved, savedActual: actual.total - afterActual.total,
        marginal: extraTotal > 0 ? saved / extraTotal * 100 : 0, netCost: extraTotal - saved, pretaxAfter: b.a.pretax - extraTotal };
    }
    return { entity, creditType: opts.creditType || 'none', creditRate: credit * 100, creditAmount: creditFixed, creditLabel, hasCredit, loss, actual, annual, extra };
  }

  /* ---------- 진단 문구 (규칙 기반) — 사장님이 읽는 글. 짧게, 결론부터. ---------- */
  function buildFeedback(rows, cost, tax, opts) {
    const T = C.thresholds;
    const b = rows[rows.length - 1], p = rows[rows.length - 2] || null, pp = rows[rows.length - 3] || null;
    const est = b.isBase && b.factor !== 1;
    const yr = b.year;
    const nm = tax.entity === 'indiv' ? '종합소득세' : '법인세';
    const points = [];
    const push = (tone, title, body) => points.push({ tone, title, body });

    // 1. 매출
    if (p && b.g.sales !== null) {
      const g = b.g.sales;
      if (Math.abs(g) <= T.growthFlat) push('info', '매출은 전년 수준', `올해 매출 ${Fmt.man(b.a.sales)}, 전년(${Fmt.man(p.a.sales)})과 비슷합니다.`);
      else if (g > 0) push('good', `매출 ${g.toFixed(0)}% 증가`, `올해 매출 ${Fmt.man(b.a.sales)}, 전년 ${Fmt.man(p.a.sales)}보다 늘었습니다.` + (pp && p.g.sales !== null && p.g.sales > T.growthFlat ? ' 2년 연속 성장입니다.' : ''));
      else push('warn', `매출 ${Math.abs(g).toFixed(0)}% 감소`, `올해 매출 ${Fmt.man(b.a.sales)}, 전년 ${Fmt.man(p.a.sales)}보다 줄었습니다.` + (pp && p.g.sales !== null && p.g.sales < -T.growthFlat ? ' 2년 연속 감소입니다.' : ''));
    } else {
      push('info', '올해 매출', `${Fmt.man(b.a.sales)}입니다.` + (p ? '' : ' 전년 자료가 있으면 추이를 비교해 드립니다.'));
    }

    // 2. 영업이익
    {
      const om = b.r.opMargin;
      const turned = p ? ((p.a.op <= 0 && b.a.op > 0) ? 'toProfit' : (p.a.op > 0 && b.a.op <= 0) ? 'toLoss' : null) : null;
      if (turned === 'toProfit') push('good', '흑자 전환', `전년 영업손실 ${Fmt.man(Math.abs(p.a.op))} → 올해 영업이익 ${Fmt.man(b.a.op)}. 적자에서 벗어났습니다.`);
      else if (turned === 'toLoss') push('warn', '적자 전환', `전년 영업이익 ${Fmt.man(p.a.op)} → 올해 영업손실 ${Fmt.man(Math.abs(b.a.op))}. 매출 대비 비용이 커졌습니다.`);
      else if (b.a.op <= 0) push('warn', '영업손실 지속', `올해 영업손실 ${Fmt.man(Math.abs(b.a.op))}. 매출 ${Fmt.man(b.a.sales)}보다 비용 ${Fmt.man(b.a.cogs + b.a.sga)}이 큽니다.`);
      else if (om !== null && om < T.opMarginLow) push('warn', '이익률 낮음', `매출 100원에 영업이익 ${om.toFixed(1)}원(영업이익률 ${Fmt.pct(om)}). 가격·원가·고정비 점검이 필요합니다.`);
      else if (om !== null && om >= T.opMarginGood) push('good', '이익률 양호', `매출 100원에 영업이익 ${om.toFixed(1)}원(영업이익률 ${Fmt.pct(om)}).` + (p && p.r.opMargin !== null ? ` 전년 ${Fmt.pct(p.r.opMargin)}에서 ${om >= p.r.opMargin ? '개선' : '하락'}.` : ''));
      else if (om !== null) push('info', '이익률 보통', `영업이익률 ${Fmt.pct(om)}` + (p && p.r.opMargin !== null ? `, 전년 ${Fmt.pct(p.r.opMargin)} 대비 ${om >= p.r.opMargin ? '개선' : '하락'}.` : '.'));
    }

    // 3. 원가율 (원가가 있는 업종만)
    if (p && b.a.cogs > 0 && p.a.cogs > 0 && b.r.grossMargin !== null && p.r.grossMargin !== null) {
      const d = b.r.grossMargin - p.r.grossMargin;
      if (Math.abs(d) >= 3) push(d > 0 ? 'good' : 'warn', d > 0 ? '원가율 개선' : '원가율 상승',
        `매출총이익률 ${Fmt.pct(p.r.grossMargin)} → ${Fmt.pct(b.r.grossMargin)}. ${d > 0 ? '원가 관리가 잘 되고 있습니다.' : '매입단가나 판매가격 변동을 확인해 보세요.'}`);
    }

    // 4. 비용 — 크게 늘거나 줄어든 항목만
    if (cost.hasDetail && p) {
      const surges = cost.items.filter(it => it.change !== null && it.change >= T.itemSurgePct && it.share !== null && it.share >= T.itemMinShare && it.prev > 0);
      if (surges.length) push('warn', '크게 늘어난 비용', surges.slice(0, 3).map(it => `${it.label} ${Fmt.man(it.prev)} → ${Fmt.man(it.curA)}`).join(', ') + '. 일시적인지 계속될지 봐야 합니다.');
      const drops = cost.items.filter(it => it.change !== null && it.change <= -70 && p.a.sales > 0 && it.prev / Math.abs(p.a.sales) * 100 >= T.itemMinShare);
      if (drops.length) push('info', '크게 줄어든 비용', drops.slice(0, 3).map(it => `${it.label} ${Fmt.man(it.prev)} → ${Fmt.man(it.curA)}`).join(', ') + '. 아직 안 넘겨주신 지출이 있으면 알려주세요.');
      if (cost.labor.share !== null && cost.labor.share >= T.laborRatioHigh) push('warn', '인건비 비중 높음', `인건비가 매출의 ${Fmt.pct(cost.labor.share)}입니다. 인력 대비 매출이 충분한지 점검해 보세요.`);
    }

    // 5. 이자 부담
    if (cost.interest > 0 && b.a.sales > 0) {
      const sh = ratio(cost.interest, b.a.sales);
      if (sh >= 2) push('warn', '이자 부담', `이자비용 ${Fmt.man(cost.interest)}, 매출의 ${Fmt.pct(sh)}입니다. 차입 규모와 금리 조건을 점검해 보세요.`);
    }

    // 6. 순이익·세금
    {
      const net = b.a.net; const tx = tax.annual;
      if (net > 0) {
        let s = `올해 순이익 ${Fmt.man(net)}` + (b.r.netMargin !== null ? `(순이익률 ${Fmt.pct(b.r.netMargin)})` : '') + ' 예상.';
        if (tx.total > 0) s += ` 이대로면 ${nm} 약 ${Fmt.man(tx.total)}(지방소득세 포함)입니다.`;
        else s += ` 공제·감면 적용 후 ${nm}는 거의 없을 것으로 보입니다.`;
        push('info', '예상 순이익과 세금', s);
      } else {
        push('info', '순손실 예상', `올해 순손실 ${Fmt.man(Math.abs(net))}. 올해 세금은 거의 없고, 손실은 다음 해 이익에서 공제됩니다.`);
      }
    }

    // 7. 추가 비용 시뮬레이션
    if (tax.extra) {
      const x = tax.extra;
      if (x.saved > 0) push('good', '추가 비용 반영 시', `비용 ${Fmt.man(x.total)}을 더 반영하면 세금 ${Fmt.man(tax.annual.total)} → ${Fmt.man(x.after.total)}, ${Fmt.man(x.saved)} 줄어듭니다. 실제 지출과 증빙이 있어야 합니다.`);
      else push('info', '추가 비용 반영 시', `비용 ${Fmt.man(x.total)}을 더 반영해도 낼 세금이 거의 없어 줄어드는 세금은 없습니다.`);
    }

    // 최대 6개: 넘치면 '참고' 성격부터 뺀다
    while (points.length > 6) {
      const i = points.map(x => x.tone).lastIndexOf('info');
      points.splice(i >= 0 ? i : points.length - 1, 1);
    }

    const summary = buildSummary(rows, est);
    const note = est ? `올해 수치는 ${b.startMonth || 1}~${b.endMonth || b.months}월 ${b.months}개월 실적을 12개월로 단순 환산한 추정치입니다. 매출이 몰리는 달이나 연말 큰 지출이 있으면 실제와 차이가 날 수 있습니다.` : '';
    const checklist = buildChecklist(rows, cost, tax, est);
    return { summary, note, points, checklist };
  }

  /* 사장님께 부탁드리는 것 — 사무실에서 처리하는 결산·세무조정 업무는 넣지 않는다 */
  function buildChecklist(rows, cost, tax, est) {
    const b = rows[rows.length - 1];
    const list = [];
    list.push('아직 전달하지 않은 세금계산서·카드·현금영수증 등 증빙이 있으면 보내주세요.');
    if (cost.hasDetail && cost.labor.cur === 0) list.push(tax.entity === 'corp' ? '대표이사 급여를 어떻게 책정할지 정해 주세요. 급여 반영 여부에 따라 세금이 달라집니다.' : '급여 지급이 있었다면 내역을 알려주세요.');
    else list.push('직원 채용·급여 변경 계획이 있으면 알려주세요. 고용 관련 공제를 검토합니다.');
    list.push('연말까지 예정된 큰 지출(비품·차량·퇴직연금 등)이 있으면 미리 알려주세요. 절세 효과를 계산해 드립니다.');
    if (b.a.pretax > 0 && tax.annual.total > 0) list.push(`${est ? '내년 신고 때' : '신고 때'} 납부할 세금(예상 ${Fmt.man(tax.annual.total)})을 미리 준비해 두세요.`);
    else if (b.a.pretax <= 0) list.push('올해는 손실이라 세금 부담은 거의 없습니다. 손실을 다음 해에 공제받도록 저희가 신고합니다.');
    return list.slice(0, 4);
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
