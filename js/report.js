/* =====================================================================
 *  report.js — 보고서 3장(표지·경영성과·진단) HTML 생성 + 추이 차트(SVG)
 * ===================================================================== */
(function () {
  'use strict';
  const { Fmt, MAJOR_LABEL } = window.Analysis;
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const koDate = d => `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;

  function periodText(y) {
    if (!y) return '';
    if (y.months >= 12 || !y.startMonth) return `${y.year}년 1월 1일 ~ 12월 31일 (12개월)`;
    return `${y.year}년 ${y.startMonth}월 1일 ~ ${y.endMonth}월 말 (${y.months}개월)`;
  }

  /* ---------- 표지 ---------- */
  function cover(model) {
    const { meta, analysis } = model;
    const b = analysis.base;
    const est = b.factor !== 1;
    return `
<section class="page cover">
  <div class="rule-top"></div><div class="rule-top-thin"></div>
  <div class="body">
    <div class="fy">${b.year} 사업연도</div>
    <div class="title-band"><h1>${esc(meta.title)}</h1></div>
    <div class="sub">기준기간 <span class="period">${esc(periodText(b))}</span>${analysis.rows.length > 1 ? `<br>${est ? '12개월 환산 추정 및 ' : ''}최근 ${analysis.rows.length}개년 비교 포함` : (est ? '<br>12개월 환산 추정 포함' : '')}</div>
    <div class="company-box"><small>회 사 명</small>${esc(meta.company || '회사명 미입력')}</div>
    <div class="meta">보고일 &nbsp;${esc(meta.dateText)}${meta.preparer ? `<br>담당 &nbsp;${esc(meta.preparer)}` : ''}</div>
    <div class="firm"><img src="assets/logo_v.png" alt="${esc(meta.firm)}" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"><span style="display:none">${esc(meta.firm)}<small>TAX &amp; ACCOUNTING</small></span></div>
  </div>
  <div class="foot">${esc(meta.footnote)}</div>
</section>`;
  }

  /* ---------- 2장: 경영성과 요약 ---------- */
  function kpi(label, sub, valA, valActual, g, est, months) {
    const neg = valA < 0;
    return `<div class="kpi">
  <div class="k">${label}<small>${est ? '12개월 환산' : '당기 실적'}</small></div>
  <div class="v${neg ? ' neg' : ''}">${Fmt.man(valA)}</div>
  <div class="s">${est ? `<span>${months}개월 실적 <b>${Fmt.man(valActual)}</b></span>` : ''}<span>전년 대비 <b class="${g > 0 ? 'up' : g < 0 ? 'down' : ''}">${Fmt.delta(g)}</b></span></div>
</div>`;
  }

  function plTable(model) {
    const { analysis, options } = model;
    const rows = analysis.rows; const b = analysis.base; const est = b.factor !== 1;
    const unit = options.unit || 1;
    const prevRows = rows.slice(0, -1);
    const head = ['<th>항목</th>']
      .concat(prevRows.map(y => `<th>${y.year}년<small>${y.months < 12 ? `${y.months}개월 실적` : '결산'}</small></th>`))
      .concat([`<th>${b.year}년 실적<small>${b.startMonth || 1}~${b.endMonth || 12}월 (${b.months}개월)</small></th>`])
      .concat(est ? [`<th>${b.year}년 연환산<small>12개월 추정</small></th>`] : [])
      .concat(analysis.prev ? [`<th>전년 대비<small>${est ? '연환산' : '실적'} 기준</small></th>`] : [])
      .join('');
    const spec = [
      ['sales', 'total'], ['cogs', 'sub'], ['gross', 'total'], ['sga', 'sub'], ['op', 'total hl'],
      ['nonOpInc', 'sub'], ['nonOpExp', 'sub'], ['pretax', 'total'], ['tax', 'sub'], ['net', 'total hl'],
    ];
    const cell = (v, cls) => `<td class="${cls || ''}${v < 0 ? ' neg' : ''}">${Fmt.wonUnit(v, unit)}</td>`;
    const body = spec.map(([k, cls]) => {
      const isTotal = cls.includes('total');
      let label = MAJOR_LABEL[k];
      if (k === 'tax') label = analysis.tax.entity === 'indiv' ? '소득세등' : '법인세등';
      if (k === 'pretax') label = analysis.tax.entity === 'indiv' ? '소득세차감전이익' : '법인세차감전이익';
      const g = analysis.prev ? (b.g[k] !== undefined ? b.g[k] : ((analysis.prev.a[k]) ? (b.a[k] - analysis.prev.a[k]) / Math.abs(analysis.prev.a[k]) * 100 : null)) : null;
      const gCls = g === null ? '' : g > 0 ? 'up' : g < 0 ? 'down' : '';
      return `<tr class="${cls}"><td class="${isTotal ? '' : 'sub'}">${label}</td>` +
        prevRows.map(y => cell(y.m[k])).join('') + cell(b.m[k]) +
        (est ? cell(b.a[k], 'est') : '') +
        (analysis.prev ? `<td class="delta ${g ? gCls : ''}">${Fmt.delta(g)}</td>` : '') + '</tr>';
    }).join('');
    const partialPrev = prevRows.filter(y => y.factor !== 1);
    const foot = partialPrev.length ? `<div class="unit-note" style="text-align:left;margin-top:1mm">※ ${partialPrev.map(y => `${y.year}년은 ${y.months}개월 실적`).join(', ')}이므로 전년 대비는 양쪽 모두 12개월로 환산해 비교했습니다.</div>` : '';
    return `<div class="unit-note">(단위: ${unit === 1000 ? '천원' : '원'})</div><table class="pl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${foot}`;
  }

  /* 추이 차트: 항목별 그룹, 연도별 막대 */
  function chart(analysis) {
    const rows = analysis.rows; const b = analysis.base; const est = b.factor !== 1;
    const metrics = [['sales', '매출액'], ['op', '영업이익'], ['net', '당기순이익']];
    const W = 760, H = 176, padL = 14, padR = 14, padT = 20, padB = 26;
    const vals = [];
    rows.forEach(y => metrics.forEach(([k]) => vals.push(y.a[k], y.m[k])));
    let max = Math.max(0, ...vals), min = Math.min(0, ...vals);
    if (max === 0 && min === 0) max = 1;
    const span = max - min; max += span * 0.12; min -= (min < 0 ? span * 0.12 : 0);
    const plotH = H - padT - padB, plotW = W - padL - padR;
    const yOf = v => padT + (max - v) / (max - min) * plotH;
    const y0 = yOf(0);
    const colors = rows.length === 3 ? ['var(--y1)', 'var(--y2)', 'var(--y3)'] : rows.length === 2 ? ['var(--y2)', 'var(--y3)'] : ['var(--y3)'];
    const short = v => { const a = Math.abs(v); const s = a >= 1e8 ? `${(a / 1e8).toFixed(2).replace(/\.?0+$/, '')}억` : a >= 1e4 ? `${Math.round(a / 1e4).toLocaleString('ko-KR')}만` : `${Math.round(a).toLocaleString('ko-KR')}`; return (v < 0 ? '−' : '') + s; };

    const groupW = plotW / metrics.length;
    const barW = Math.min(44, (groupW * 0.72) / rows.length), gap = 6;
    const totalBars = rows.length * barW + (rows.length - 1) * gap;
    let svg = '';
    // 격자
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = min + (max - min) * i / ticks; const yy = yOf(v);
      svg += `<line x1="${padL}" x2="${W - padR}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="#e8ecf1" stroke-width="1"/>`;
    }
    svg += `<line x1="${padL}" x2="${W - padR}" y1="${y0.toFixed(1)}" y2="${y0.toFixed(1)}" stroke="#9aa3b2" stroke-width="1.2"/>`;
    metrics.forEach(([k, label], gi) => {
      const gx = padL + gi * groupW + (groupW - totalBars) / 2;
      rows.forEach((y, yi) => {
        const x = gx + yi * (barW + gap);
        const actual = y.m[k], annual = y.a[k];
        const rect = (v0, v1, fill, op) => {
          const top = Math.min(yOf(v0), yOf(v1)), h = Math.abs(yOf(v0) - yOf(v1));
          return h > 0.3 ? `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${fill}" opacity="${op}"/>` : '';
        };
        const partial = y.factor !== 1;
        svg += rect(0, actual, colors[yi], 1);
        if (partial) svg += rect(actual, annual, 'var(--y3e)', 1);
        const labelV = partial ? annual : actual;
        const ly = labelV >= 0 ? yOf(labelV) - 5 : yOf(labelV) + 12;
        svg += `<text x="${(x + barW / 2).toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="10.5" fill="#1d2433" font-weight="${y.isBase ? 700 : 500}">${short(labelV)}</text>`;
      });
      svg += `<text x="${(padL + gi * groupW + groupW / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="12" font-weight="600" fill="#4b5563">${label}</text>`;
    });
    const anyPartial = rows.some(y => y.factor !== 1);
    const legend = rows.map((y, i) => `<span><i style="background:${colors[i]}"></i>${y.year}년${y.factor !== 1 ? ` 실적(${y.months}개월)` : ''}</span>`).join('') +
      (anyPartial ? `<span><i style="background:var(--y3e)"></i>12개월 환산 추정분</span>` : '');
    return `<div class="chart-wrap"><div class="chart-legend">${legend}</div>
<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="매출·영업이익·당기순이익 연도별 추이">${svg}</svg>
<div class="chart-note">막대 위 숫자는 금액(만원·억원). ${anyPartial ? `12개월 미만 연도는 실적(진한 색) 위에 12개월 환산 추정분(연한 색)을 덧붙여 표시했습니다.` : ''} 손실은 기준선 아래로 표시됩니다.</div></div>`;
  }

  function page2(model) {
    const { meta, analysis } = model; const b = analysis.base; const p = analysis.prev; const est = b.factor !== 1;
    const g = k => (p ? b.g[k] : null);
    return `
<section class="page">
  <div class="page-head"><h2><span>Ⅰ.</span>경영성과 요약</h2><div class="meta">${esc(meta.company)}<br>${esc(periodText(b))} 기준</div></div>
  <div class="kpis">
    ${kpi('매출액', '', b.a.sales, b.m.sales, g('sales'), est, b.months)}
    ${kpi('영업이익', '', b.a.op, b.m.op, g('op'), est, b.months)}
    ${kpi('당기순이익', '', b.a.net, b.m.net, g('net'), est, b.months)}
  </div>
  <h3 class="sec">손익계산서 요약 <small>최근 ${analysis.rows.length}개년 비교${est ? ` · ${b.year}년은 ${b.months}개월 실적과 12개월 환산을 함께 표시` : ''}</small></h3>
  ${plTable(model)}
  <h3 class="sec">연도별 추이 <small>매출액 · 영업이익 · 당기순이익</small></h3>
  ${chart(analysis)}
  <h3 class="sec">비용은 어디에 쓰였나 <small>판관비 상위 항목</small></h3>
  ${costTable(analysis, model.options.unit || 1)}
  <div class="page-foot"><span><img src="assets/logo_h.png" alt="" onerror="this.remove()">${esc(meta.title)}</span><span>${esc(meta.company)} · 1 / 2</span></div>
</section>`;
  }

  /* ---------- 3장: 진단과 피드백 ---------- */
  function ratioCard(label, key, analysis, invert) {
    const rows = analysis.rows; const b = analysis.base; const p = analysis.prev; const pp = rows.length >= 3 ? rows[rows.length - 3] : null;
    const v = b.r[key]; const pv = p ? p.r[key] : null;
    const d = (v !== null && pv !== null) ? v - pv : null;
    const good = d === null ? null : (Math.abs(d) < 0.05 ? null : d > 0);
    return `<div class="ratio">
  <div class="k">${label}</div>
  <div class="v${v !== null && v < 0 ? ' neg' : ''}">${Fmt.pct(v)}</div>
  <div class="t">전년 <b>${Fmt.pct(pv)}</b>${d !== null ? ` → <b class="${good === null ? '' : good ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d.toFixed(1)}%p</b>` : ''}</div>
  ${pp ? `<div class="d">${pp.year}년 ${Fmt.pct(pp.r[key])} · ${p.year}년 ${Fmt.pct(pv)} · ${b.year}년 ${Fmt.pct(v)}</div>` : ''}
</div>`;
  }

  function costTable(analysis, unit) {
    const c = analysis.cost; const b = analysis.base; const est = b.factor !== 1;
    if (!c.hasDetail) return `<p class="tax-note">판관비 세부 항목을 PDF에서 읽지 못해 비용 구조 표를 생략했습니다.</p>`;
    const items = c.items.filter(it => it.curA > 0 || it.prev > 0).slice(0, 5);
    const sgaA = b.a.sga, sgaP = analysis.prev ? analysis.prev.a.sga : null;
    const rows = items.map(it => `<tr><td>${esc(it.label)}</td><td>${Fmt.wonUnit(it.curA, unit)}</td>${analysis.prev ? `<td>${Fmt.wonUnit(it.prev, unit)}</td>` : ''}<td>${Fmt.pct(it.share)}</td>${analysis.prev ? `<td class="${it.change > 0 ? 'up' : it.change < 0 ? 'down' : ''}">${Fmt.delta(it.change)}</td>` : ''}</tr>`).join('');
    const etc = sgaA - items.reduce((s, it) => s + it.curA, 0);
    return `<table class="mini"><thead><tr><th>판관비 항목</th><th>${b.year}년${est ? '(환산)' : ''}</th>${analysis.prev ? `<th>${analysis.prev.year}년</th>` : ''}<th>매출比</th>${analysis.prev ? '<th>증감</th>' : ''}</tr></thead>
<tbody>${rows}${etc > 0.5 ? `<tr><td>기타</td><td>${Fmt.wonUnit(etc, unit)}</td>${analysis.prev ? '<td>-</td>' : ''}<td>${Fmt.pct(etc / Math.abs(b.a.sales || 1) * 100)}</td>${analysis.prev ? '<td>-</td>' : ''}</tr>` : ''}
<tr class="total"><td>판관비 합계</td><td>${Fmt.wonUnit(sgaA, unit)}</td>${analysis.prev ? `<td>${Fmt.wonUnit(sgaP, unit)}</td>` : ''}<td>${Fmt.pct(b.r.sgaRatio)}</td>${analysis.prev ? `<td class="${b.g.sga > 0 ? 'up' : b.g.sga < 0 ? 'down' : ''}">${Fmt.delta(b.g.sga)}</td>` : ''}</tr></tbody></table>
<p class="tax-note">(단위: ${unit === 1000 ? '천원' : '원'}) 매출比 = 항목 금액 ÷ 매출액. ${c.labor.cur > 0 ? `인건비 합계(급여·상여 등) ${Fmt.man(c.labor.cur)}, 매출의 ${Fmt.pct(c.labor.share)}.` : ''}</p>`;
  }

  function taxTable(analysis, unit) {
    const t = analysis.tax; const b = analysis.base; const est = b.factor !== 1;
    const nm = t.entity === 'indiv' ? '종합소득세' : '법인세';
    if (t.extra) return taxCompareTable(analysis, unit, nm);
    const r = (label, k, cls) => `<tr class="${cls || ''}"><td>${label}</td><td>${Fmt.wonUnit(t.actual[k], unit)}</td>${est ? `<td>${Fmt.wonUnit(t.annual[k], unit)}</td>` : ''}</tr>`;
    return `<table class="mini"><thead><tr><th>구분</th><th>${b.months}개월 실적 기준</th>${est ? '<th>12개월 환산 기준</th>' : ''}</tr></thead><tbody>
<tr><td>세전이익</td><td class="${b.m.pretax < 0 ? 'neg' : ''}">${Fmt.wonUnit(b.m.pretax, unit)}</td>${est ? `<td class="${b.a.pretax < 0 ? 'neg' : ''}">${Fmt.wonUnit(b.a.pretax, unit)}</td>` : ''}</tr>
${t.loss > 0 || t.entity === 'indiv' ? r(`과세표준${t.loss > 0 ? ' (이월결손금 차감)' : ''}`, 'taxBase') : ''}
${r(`${nm} 산출세액`, 'computed')}
${t.hasCredit ? r(`(−) ${t.creditLabel}`, 'creditAmt') : ''}
${r('지방소득세 (10%)', 'local')}
${r('예상 세금 합계', 'total', 'total')}
</tbody></table>
<p class="tax-note">(단위: ${unit === 1000 ? '천원' : '원'}) ${nm} 기본세율만 적용한 단순 추정입니다. ${t.entity === 'indiv' ? '소득공제는 본인 기본공제만 반영했고, ' : ''}세무조정(접대비 한도·감가상각 등), ${t.hasCredit ? '선택한 항목 외의 공제·감면과 최저한세, ' : '각종 공제·감면, '}중간예납 기납부세액은 반영하지 않았습니다.</p>`;
  }

  /* 추가 비용 반영 전/후 비교표 */
  function taxCompareTable(analysis, unit, nm) {
    const t = analysis.tax; const x = t.extra; const b = analysis.base; const est = b.factor !== 1;
    const A = t.annual, B = x.after;
    const diff = (a, c, color) => { const d = c - a; return `<td class="${color ? (d < 0 ? 'down' : d > 0 ? 'up' : '') : ''}">${d === 0 ? '-' : (d > 0 ? '+' : '−') + Fmt.wonUnit(Math.abs(d), unit)}</td>`; };
    const r = (label, a, c, cls, color) => `<tr class="${cls || ''}"><td>${label}</td><td class="${a < 0 ? 'neg' : ''}">${Fmt.wonUnit(a, unit)}</td><td class="${c < 0 ? 'neg' : ''}">${Fmt.wonUnit(c, unit)}</td>${diff(a, c, color !== false)}</tr>`;
    const items = x.items.map(it => `<li>${esc(it.label || '추가 비용')} <b>${Fmt.wonUnit(it.amount, unit)}</b></li>`).join('');
    return `<table class="mini"><thead><tr><th>구분${est ? '<small> (12개월 환산 기준)</small>' : ''}</th><th>반영 전</th><th>반영 후</th><th>차이</th></tr></thead><tbody>
${r('세전이익', b.a.pretax, x.pretaxAfter, '', false)}
<tr><td>(−) 추가 비용</td><td>-</td><td>${Fmt.wonUnit(x.total, unit)}</td><td></td></tr>
${r(`${nm} 산출세액`, A.computed, B.computed)}
${t.hasCredit ? r(`(−) ${t.creditLabel}`, A.creditAmt, B.creditAmt) : ''}
${r('지방소득세 (10%)', A.local, B.local)}
${r('예상 세금 합계', A.total, B.total, 'total')}
</tbody></table>
<div class="saving"><div class="lbl">절세 효과</div><div class="big">${Fmt.man(x.saved)} <small>감소</small></div><div class="sub">추가 비용 ${Fmt.man(x.total)} 반영 시 · 지출 100원당 세금 약 ${x.marginal.toFixed(0)}원 감소 · 세금 차감 후 실제 부담 ${Fmt.man(x.netCost)}</div><ul class="items">${items}</ul></div>
<p class="tax-note">(단위: ${unit === 1000 ? '천원' : '원'}) ${nm} 기본세율만 적용한 단순 추정입니다. 추가 비용은 실제 지출·증빙이 있어야 비용으로 인정되며, 세무조정·최저한세·중간예납 기납부세액은 반영하지 않았습니다.</p>`;
  }

  function page3(model) {
    const { meta, analysis, options } = model; const b = analysis.base; const fb = analysis.feedback; const unit = options.unit || 1;
    const points = fb.points.map(pt => `<li><span class="dot ${pt.tone}"></span><div><b>${esc(pt.title)}</b><p>${esc(pt.body)}</p></div></li>`).join('');
    return `
<section class="page">
  <div class="page-head"><h2><span>Ⅱ.</span>진단과 피드백</h2><div class="meta">${esc(meta.company)}<br>${esc(periodText(b))} 기준</div></div>
  <div class="summary"><div class="lbl">총 평</div><p>${esc(fb.summary)}</p>${fb.note ? `<div class="note">※ ${esc(fb.note)}</div>` : ''}</div>
  <div class="ratios">
    ${ratioCard('매출총이익률', 'grossMargin', analysis)}
    ${ratioCard('영업이익률', 'opMargin', analysis)}
    ${ratioCard('순이익률', 'netMargin', analysis)}
    ${ratioCard('판관비율', 'sgaRatio', analysis, true)}
  </div>
  <h3 class="sec">진단 포인트</h3>
  <ul class="points">${points}</ul>
  <div class="two-col">
    ${options.showTax ? `<div><h3 class="sec">예상 세금 <small>${analysis.tax.entity === 'indiv' ? '종합소득세' : '법인세'} + 지방소득세</small></h3>${taxTable(analysis, unit)}</div>` : ''}
    <div><h3 class="sec">확인 요청 사항 <small>결산 전까지</small></h3><ol class="checklist">${fb.checklist.map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>
  </div>
  ${meta.comment ? `<div class="comment"><div class="lbl">담당자 코멘트</div><p>${esc(meta.comment).replace(/\n/g, '<br>')}</p><div class="sign">${esc(meta.firm)}${meta.preparer ? ` · 담당 ${esc(meta.preparer)}` : ''}</div></div>` : ''}
  <div class="disclaimer">본 보고서는 보고일 현재 장부를 기준으로 한 가결산 추정치이며, 실제 결산·세액은 기말 결산 결과에 따라 달라질 수 있습니다. 중요한 결정 전에는 담당자와 상의해 주세요.</div>
  <div class="page-foot"><span><img src="assets/logo_h.png" alt="" onerror="this.remove()">${esc(meta.title)}</span><span>${esc(meta.company)} · 2 / 2</span></div>
</section>`;
  }

  function render(container, model) {
    container.innerHTML = cover(model) + page2(model) + page3(model);
  }

  window.Report = { render, periodText, koDate };
})();
