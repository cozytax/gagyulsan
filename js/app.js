/* =====================================================================
 *  app.js — 화면 동작 (업로드 · 설정 · 데이터 확인 · 미리보기 · PDF 저장)
 * ===================================================================== */
(function () {
  'use strict';
  const C = window.CONFIG; const A = window.Analysis; const { Fmt, MAJOR_KEYS, MAJOR_LABEL } = A;
  const $ = id => document.getElementById(id);

  const state = {
    files: [],          // {name, stmt, error}
    manual: {},         // {year: {m:{}, months}}
    edits: {},          // {year: {key: value}}  사용자가 손으로 고친 값
    analysis: null,
    years: [],
    warnings: [],
    extras: [{ label: '', amount: 0 }, { label: '', amount: 0 }, { label: '', amount: 0 }], // 추가 비용 시뮬레이션
  };

  /* ---------- 유틸 ---------- */
  function toast(msg, ms) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms || 2400); }
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const isoToKo = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return `${y}년 ${m}월 ${d}일`; };
  const pref = { get(k, d) { try { return localStorage.getItem('gr_' + k) ?? d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('gr_' + k, v); } catch (e) { /* ignore */ } } };

  /* ---------- 파일 처리 ---------- */
  async function addFiles(fileList) {
    const files = Array.from(fileList).filter(f => /\.pdf$/i.test(f.name));
    if (!files.length) { toast('PDF 파일만 올릴 수 있습니다.'); return; }
    setBusy(true);
    for (const f of files) {
      if (state.files.some(x => x.name === f.name)) { toast(`'${f.name}' 은 이미 올라가 있습니다.`); continue; }
      try {
        const buf = await f.arrayBuffer();
        const stmt = await window.Parser.parsePdf(buf, f.name);
        if (!stmt.periods.length) throw new Error('손익계산서 항목을 찾지 못했습니다. 텍스트가 없는 스캔본이거나 양식이 다를 수 있습니다.');
        state.files.push({ name: f.name, stmt });
        if (!$('company').value && stmt.company) $('company').value = stmt.company;
        if (!state._entitySet && stmt.entityType === 'corp') $('entity').value = 'corp';
      } catch (e) {
        console.error(e);
        state.files.push({ name: f.name, error: e.message || String(e) });
      }
    }
    setBusy(false);
    recompute();
  }

  async function loadFromUrl(url) {
    try {
      setBusy(true);
      const res = await fetch(url); if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
      const buf = await res.arrayBuffer();
      const name = decodeURIComponent(url.split('/').pop());
      const stmt = await window.Parser.parsePdf(buf, name);
      state.files.push({ name, stmt });
      if (!$('company').value && stmt.company) $('company').value = stmt.company;
      if (!state._entitySet && stmt.entityType === 'corp') $('entity').value = 'corp';
    } catch (e) { console.error(e); toast('불러오기 실패: ' + e.message); }
    setBusy(false); recompute();
  }

  function removeFile(i) { state.files.splice(i, 1); recompute(); }

  function setBusy(on) { $('busy').style.display = on ? 'inline-block' : 'none'; }

  /* ---------- 계산 ---------- */
  function recompute() {
    const stmts = state.files.filter(f => f.stmt).map(f => f.stmt);
    const merged = A.mergeStatements(stmts, state.manual);
    state.warnings = merged.warnings.slice();
    // 손으로 고친 값 반영 → 구성항목이 바뀌면 합계 재계산(합계를 직접 고친 경우는 그대로)
    for (const y of merged.years) {
      const ed = state.edits[y.year]; if (!ed) continue;
      const keys = Object.keys(ed);
      for (const k of keys) y.m[k] = ed[k];
      const totals = { gross: ['sales', 'cogs'], op: ['gross', 'sga'], pretax: ['op', 'nonOpInc', 'nonOpExp'], net: ['pretax', 'tax'] };
      const calc = { gross: m => m.sales - m.cogs, op: m => m.gross - m.sga, pretax: m => m.op + m.nonOpInc - m.nonOpExp, net: m => m.pretax - m.tax };
      for (const t of ['gross', 'op', 'pretax', 'net']) if (!keys.includes(t)) y.m[t] = calc[t](y.m);
      void totals;
    }
    state.years = merged.years;
    if (!state.years.length) { state.analysis = null; renderAll(); return; }
    state.analysis = A.analyze(state.years, {
      entityType: $('entity').value,
      ...readCredit(),
      lossCarry: parseInt(String($('loss').value).replace(/[^\d-]/g, ''), 10) || 0,
      extras: state.extras.filter(e => e.amount > 0),
    });
    renderAll();
  }

  /* ---------- 화면 ---------- */
  function renderFiles() {
    const ul = $('files'); ul.innerHTML = '';
    state.files.forEach((f, i) => {
      const li = document.createElement('li');
      if (f.error) { li.className = 'err'; li.innerHTML = `<span class="nm" title="${f.name}">${f.name}</span><span class="tag">읽기 실패</span><button class="x" title="제거">×</button><div style="flex-basis:100%;font-size:11.5px;color:#8a3f12">${f.error}</div>`; }
      else {
        const tags = f.stmt.periods.map(p => { const empty = p.items.every(it => !it.value); return `<span class="tag" style="${empty ? 'opacity:.55' : ''}">${p.year}년 ${p.months}개월${p.kind === 'prev' ? '(전기)' : ''}${empty ? ' · 비어 있어 제외' : ''}</span>`; }).join('');
        li.innerHTML = `<span class="nm" title="${f.name}">${f.name}</span>${tags}<button class="x" title="제거">×</button>`;
      }
      li.querySelector('.x').onclick = () => removeFile(i);
      ul.appendChild(li);
    });
  }

  function renderData() {
    const box = $('datatbl'); const ys = state.years;
    if (!ys.length) { box.innerHTML = '<p class="hint">PDF를 올리면 읽어낸 숫자가 여기에 표시됩니다. 틀린 값은 직접 고칠 수 있습니다.</p>'; return; }
    const head = `<tr><th>항목</th>${ys.map(y => `<th>${y.year}년<br><small>${y.months}개월 · ${y.source === 'manual' ? '직접입력' : y.source === 'prev' ? '전기열' : '당기열'}</small></th>`).join('')}</tr>`;
    const totalKeys = ['sales', 'gross', 'op', 'pretax', 'net'];
    const body = MAJOR_KEYS.map(k => `<tr class="${totalKeys.includes(k) ? 'total' : ''}"><td class="lbl ${totalKeys.includes(k) ? '' : 'sub'}">${MAJOR_LABEL[k]}</td>` +
      ys.map(y => { const ed = state.edits[y.year] && state.edits[y.year][k] !== undefined; return `<td><input data-year="${y.year}" data-key="${k}" class="${ed ? 'edited' : ''}" value="${Fmt.won(y.m[k])}"></td>`; }).join('') + '</tr>').join('');
    const monthsRow = `<tr><td class="lbl">실적 개월 수</td>${ys.map(y => `<td><input data-year="${y.year}" data-months="1" value="${y.months}" style="width:60px"></td>`).join('')}</tr>`;
    box.innerHTML = `<table class="datatbl"><thead>${head}</thead><tbody>${body}${monthsRow}</tbody></table>`;
    box.querySelectorAll('input[data-key]').forEach(inp => inp.onchange = () => {
      const yr = inp.dataset.year, k = inp.dataset.key; const v = parseInt(inp.value.replace(/[^\d-]/g, ''), 10);
      if (isNaN(v)) { recompute(); return; }
      state.edits[yr] = state.edits[yr] || {}; state.edits[yr][k] = v; recompute();
    });
    box.querySelectorAll('input[data-months]').forEach(inp => inp.onchange = () => {
      const yr = +inp.dataset.year; const mo = parseInt(inp.value, 10);
      if (!(mo >= 1 && mo <= 12)) { toast('개월 수는 1~12 사이여야 합니다.'); recompute(); return; }
      const y = state.years.find(x => x.year === yr);
      if (y && y.source !== 'manual') { // 파일에서 온 연도: 개월 수만 덮어쓰기
        for (const f of state.files) if (f.stmt) for (const p of f.stmt.periods) if (p.year === yr) p.months = mo;
      } else { state.manual[yr] = state.manual[yr] || { m: {} }; state.manual[yr].months = mo; }
      recompute();
    });
    // 세부 항목 (읽기 전용)
    const det = $('details'); det.innerHTML = '';
    for (const y of ys) {
      const list = y.details.sga || []; if (!list.length) continue;
      const d = document.createElement('details'); d.className = 'detail-box';
      d.innerHTML = `<summary>${y.year}년 판관비 세부 ${list.length}개 항목</summary><div class="detail-list">${list.map(it => `<div><span>${it.label}</span><span>${Fmt.won(it.value)}</span></div>`).join('')}</div>`;
      det.appendChild(d);
    }
  }

  function renderWarnings() {
    const w = $('warnings'); w.innerHTML = state.warnings.map(s => `• ${s}`).join('<br>');
  }

  function renderReport() {
    const rep = $('report'); const btn = $('btnPrint');
    if (!state.analysis) { rep.innerHTML = '<div class="empty"><b>왼쪽에 손익계산서 PDF를 올리면</b><br>표지 · 경영성과 요약 · 진단과 피드백 3장짜리 보고서가 여기에 만들어집니다.</div>'; btn.disabled = true; return; }
    const meta = {
      title: $('title').value || C.reportTitle,
      company: $('company').value.trim(),
      firm: $('firm').value.trim() || C.firmName,
      preparer: $('preparer').value.trim(),
      dateText: isoToKo($('date').value || todayISO()),
      footnote: C.footnote,
      comment: $('commentMode').value === 'none' ? '' : $('comment').value.trim(),
    };
    const options = { unit: +$('unit').value || 1, showTax: $('showTax').checked };
    window.Report.render(rep, { meta, analysis: state.analysis, options });
    fitPages(rep, { meta, analysis: state.analysis, options });
    btn.disabled = false;
    console.info(`REPORT_READY pages=${rep.querySelectorAll('.page').length} years=${state.years.map(y => y.year).join(',')}`);
  }

  /* 페이지가 A4를 넘치면 압축 모드 → 그래도 넘치면 '참고' 성격 진단 포인트부터 하나씩 줄인다 */
  function fitPages(rep, model) {
    const overflow = () => [...rep.querySelectorAll('.page')].some(p => p.scrollHeight > p.clientHeight + 1);
    if (!overflow()) return;
    rep.querySelectorAll('.page').forEach(p => { if (p.scrollHeight > p.clientHeight + 1) p.classList.add('compact'); });
    // 진단 포인트가 있는 페이지가 넘칠 때만 포인트를 줄인다
    const pointsPage = () => { const ul = rep.querySelector('.points'); return ul ? ul.closest('.page') : null; };
    const pointsOverflow = () => { const p = pointsPage(); return !!p && p.scrollHeight > p.clientHeight + 1; };
    if (!pointsOverflow()) { if (overflow()) console.warn('A4 한 장을 넘치는 페이지가 있습니다.'); return; }
    const fb = model.analysis.feedback; const original = fb.points.slice();
    for (let guard = 0; guard < 6 && pointsOverflow(); guard++) {
      const idx = (() => { for (let i = fb.points.length - 1; i >= 0; i--) if (fb.points[i].tone === 'info') return i; return fb.points.length - 1; })();
      if (idx < 0 || fb.points.length <= 3) break;
      fb.points.splice(idx, 1);
      window.Report.render(rep, model);
      rep.querySelectorAll('.page').forEach(p => { if (p.scrollHeight > p.clientHeight + 1) p.classList.add('compact'); });
    }
    if (fb.points.length !== original.length) console.info(`진단 포인트 ${original.length - fb.points.length}개를 지면 사정으로 줄였습니다.`);
    fb.points = original.slice(); // 다음 렌더를 위해 원본 복구 (다시 넘치면 또 줄임)
    if (overflow()) console.warn('A4 한 장을 넘치는 페이지가 있습니다.');
  }

  function renderAll() { renderFiles(); renderData(); renderWarnings(); renderExtras(); renderReport(); }

  /* ---------- 추가 비용 시뮬레이션 ---------- */
  function renderExtras() {
    const tbl = $('extras');
    const rows = state.extras.map((e, i) => `<tr><td><input class="lbl" data-i="${i}" data-f="label" value="${e.label.replace(/"/g, '&quot;')}" placeholder="예: 대표 급여 추가"></td><td><input class="amt" data-i="${i}" data-f="amount" value="${e.amount ? e.amount.toLocaleString('ko-KR') : ''}" placeholder="0"></td><td><button class="x" data-i="${i}" title="삭제">×</button></td></tr>`).join('');
    tbl.innerHTML = `<thead><tr><th>항목</th><th>금액(원)</th><th></th></tr></thead><tbody>${rows}</tbody>`;
    tbl.querySelectorAll('input').forEach(inp => inp.onchange = () => {
      const e = state.extras[+inp.dataset.i];
      if (inp.dataset.f === 'label') e.label = inp.value.trim();
      else { e.amount = parseInt(String(inp.value).replace(/[^\d]/g, ''), 10) || 0; inp.value = e.amount ? e.amount.toLocaleString('ko-KR') : ''; }
      recompute();
    });
    tbl.querySelectorAll('button.x').forEach(b => b.onclick = () => { state.extras.splice(+b.dataset.i, 1); if (!state.extras.length) state.extras.push({ label: '', amount: 0 }); recompute(); });
    const total = state.extras.reduce((s, e) => s + (e.amount || 0), 0);
    $('extraTotal').textContent = total.toLocaleString('ko-KR');
    const saved = state.analysis && state.analysis.tax.extra ? state.analysis.tax.extra.saved : 0;
    $('extraSaved').textContent = Math.round(saved).toLocaleString('ko-KR');
  }

  /* ---------- 공제·감면 선택 ---------- */
  function creditDef() { return C.creditTypes.find(t => t.key === $('creditType').value) || C.creditTypes[0]; }
  function readCredit() {
    const t = creditDef();
    let rate = 0, amount = 0;
    if (t.mode === 'rate') rate = parseFloat($('creditRate').value) || 0;
    if (t.mode === 'both') rate = parseFloat($('creditRateFree').value) || 0;
    if (t.mode === 'amount' || t.mode === 'both') amount = parseInt(String($('creditAmt').value).replace(/[^\d]/g, ''), 10) || 0;
    return { creditType: t.key, creditLabel: t.label, creditRate: rate, creditAmount: amount };
  }
  function syncCreditUI() {
    const t = creditDef();
    $('creditRateWrap').style.display = (t.mode === 'rate' || t.mode === 'both') ? '' : 'none';
    $('creditAmtWrap').style.display = (t.mode === 'amount' || t.mode === 'both') ? '' : 'none';
    $('creditRate').style.display = t.mode === 'rate' ? '' : 'none';
    $('creditRateFree').style.display = t.mode === 'both' ? '' : 'none';
    if (t.mode === 'rate') {
      const sel = $('creditRate'); const cur = sel.value; sel.innerHTML = '';
      t.rates.forEach(r => { const o = document.createElement('option'); o.value = r; o.textContent = r + '%'; sel.appendChild(o); });
      sel.value = t.rates.includes(+cur) ? cur : t.rates[0];
    }
    $('creditHint').textContent = t.hint || '';
  }

  /* ---------- PDF 저장(인쇄) ---------- */
  function printReport() {
    if (!state.analysis) return;
    const prev = document.title;
    const safe = ($('company').value || '회사').replace(/[\\/:*?"<>|]/g, '').trim();
    document.title = `${safe}_${state.analysis.base.year}년 ${$('title').value || C.reportTitle}`;
    const restore = () => { document.title = prev; window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    window.print();
    setTimeout(restore, 4000);
  }

  /* ---------- 초기화 ---------- */
  function init() {
    if (C.accessCode) { // 간단 접속 암호
      let ok = pref.get('access', '') === C.accessCode;
      while (!ok) {
        const v = prompt('접속 암호를 입력하세요');
        if (v === null) { document.body.innerHTML = '<p style="padding:40px;text-align:center;color:#555">접속 암호가 필요합니다. 새로고침 후 다시 시도하세요.</p>'; return; }
        ok = v === C.accessCode;
      }
      pref.set('access', C.accessCode);
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const sel = $('title'); C.reportTitleOptions.forEach(t => { const o = document.createElement('option'); o.value = o.textContent = t; sel.appendChild(o); });
    sel.value = pref.get('title', C.reportTitle);
    $('firm').value = pref.get('firm', C.firmName);
    $('preparer').value = pref.get('preparer', '');
    $('date').value = todayISO();
    $('unit').value = pref.get('unit', '1');

    const drop = $('drop'), input = $('fileInput');
    drop.onclick = () => input.click();
    input.onchange = () => { addFiles(input.files); input.value = ''; };
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));
    document.addEventListener('dragover', e => e.preventDefault()); document.addEventListener('drop', e => e.preventDefault());

    ['title', 'company', 'firm', 'preparer', 'date', 'unit', 'showTax'].forEach(id => $(id).addEventListener('input', () => { pref.set(id, $(id).value); renderReport(); }));
    $('comment').addEventListener('input', renderReport);
    $('commentMode').addEventListener('change', () => { $('comment').disabled = $('commentMode').value === 'none'; renderReport(); });
    $('entity').value = C.defaultEntity || 'indiv';
    const ct = $('creditType'); C.creditTypes.forEach(t => { const o = document.createElement('option'); o.value = t.key; o.textContent = t.label; ct.appendChild(o); });
    syncCreditUI();
    ct.addEventListener('change', () => { syncCreditUI(); recompute(); });
    ['entity', 'creditRate', 'creditRateFree', 'creditAmt', 'loss'].forEach(id => $(id).addEventListener('input', () => { if (id === 'entity') state._entitySet = true; recompute(); }));
    $('creditAmt').addEventListener('change', () => { const v = parseInt(String($('creditAmt').value).replace(/[^\d]/g, ''), 10); $('creditAmt').value = v ? v.toLocaleString('ko-KR') : ''; });
    $('btnPrint').onclick = printReport;
    $('btnAddYear').onclick = () => {
      const yr = parseInt(prompt('추가할 연도를 입력하세요 (예: 2024)'), 10);
      if (!(yr > 2000 && yr < 2100)) return;
      if (state.years.some(y => y.year === yr)) { toast('이미 있는 연도입니다. 아래 표에서 값을 고치세요.'); return; }
      state.manual[yr] = { m: { sales: 0, cogs: 0, sga: 0, nonOpInc: 0, nonOpExp: 0, tax: 0 }, months: 12 };
      recompute(); toast(`${yr}년 열을 추가했습니다. 아래 표에 금액을 입력하세요.`);
    };
    $('btnAddExtra').onclick = () => { state.extras.push({ label: '', amount: 0 }); renderExtras(); tbl_focusLast(); };
    const tbl_focusLast = () => { const ins = $('extras').querySelectorAll('input.lbl'); if (ins.length) ins[ins.length - 1].focus(); };
    $('btnReset').onclick = () => { if (!confirm('올린 파일과 수정한 값을 모두 지울까요?')) return; state.files = []; state.manual = {}; state.edits = {}; state._entitySet = false; state.extras = [{ label: '', amount: 0 }, { label: '', amount: 0 }, { label: '', amount: 0 }]; $('company').value = ''; $('comment').value = ''; $('commentMode').value = 'text'; $('comment').disabled = false; $('entity').value = C.defaultEntity || 'indiv'; recompute(); };

    renderAll();
    const q = new URLSearchParams(location.search).get('load');
    if (q) q.split(',').forEach(u => loadFromUrl(u));
  }

  window.addEventListener('error', e => console.error('APP_ERROR', e.message));
  document.addEventListener('DOMContentLoaded', init);
})();
