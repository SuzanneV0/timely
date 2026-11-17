/* Timely — time tracking for freelancers. All times are shown and exported in US Eastern Time. */
(function () {
  'use strict';

  const TZ = 'America/New_York';
  const STORAGE_KEY = 'timely.v1';
  // Dusty Lavender, Ghostly Blue, Pumpkin Orange, Antique Pink, Butter Yellow, Fog
  const COLORS = ['#A88BC1', '#91B7C5', '#FDB17A', '#C49AA5', '#F4D48D', '#B6B0B7'];
  // Default category colours from earlier versions, moved onto the current palette.
  const OLD_COLORS = ['#0f766e', '#2563eb', '#c2410c', '#7c3aed', '#be185d', '#4d7c0f', '#b45309', '#0369a1'];

  const $ = (sel) => document.querySelector(sel);
  const pad = (n) => String(n).padStart(2, '0');
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- Eastern Time helpers ---------- */

  const partsFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const clockFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  function etParts(ms) {
    const o = {};
    for (const p of partsFmt.formatToParts(ms)) if (p.type !== 'literal') o[p.type] = Number(p.value);
    return o;
  }
  // The ET wall-clock reading of an instant, expressed as if it were UTC.
  function wallAsUtc(ms) {
    const p = etParts(ms);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  }
  // 'YYYY-MM-DD' + 'HH:MM' in Eastern Time -> epoch ms.
  function etToUtc(dateStr, timeStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [h, mi] = timeStr.split(':').map(Number);
    const guess = Date.UTC(y, m - 1, d, h, mi, 0);
    let t = guess - (wallAsUtc(guess) - guess);
    t = guess - (wallAsUtc(t) - t);
    return t;
  }
  function etDate(ms) {
    const p = etParts(ms);
    return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  }
  function etTimeInput(ms) {
    const p = etParts(ms);
    return `${pad(p.hour)}:${pad(p.minute)}`;
  }
  function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
  const excelSerial = (ms) => wallAsUtc(ms) / 86400000 + 25569;

  /* ---------- Durations ---------- */

  function fmtDuration(sec) {
    sec = Math.max(0, Math.floor(sec));
    return `${Math.floor(sec / 3600)}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`;
  }
  function parseDuration(input) {
    const s = String(input).trim().toLowerCase();
    if (!s) return NaN;
    if (s.includes(':')) {
      const a = s.split(':').map(Number);
      if (a.length > 3 || a.some((n) => isNaN(n) || n < 0)) return NaN;
      return Math.round(a[0] * 3600 + (a[1] || 0) * 60 + (a[2] || 0));
    }
    const m = s.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?)?\s*(?:(\d+)\s*s(?:ec(?:ond)?s?)?)?$/);
    if (m && (m[1] || m[2] || m[3])) return Math.round((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0));
    const n = Number(s);
    return isNaN(n) || n < 0 ? NaN : Math.round(n * 3600);
  }

  /* ---------- State ---------- */

  function defaultState() {
    const companyId = uid();
    return {
      companies: [{ id: companyId, name: 'My First Client' }],
      categories: ['Client work', 'Meetings', 'Admin'].map((name, i) => ({ id: uid(), name, color: COLORS[i] })),
      entries: [],
      activeCompanyId: companyId,
      timer: { status: 'idle', startedAt: null, lastResumeAt: null, accumulatedMs: 0, companyId: null, task: '', categoryId: '', notes: '' },
    };
  }

  function normalize(s) {
    const d = defaultState();
    if (!s || !Array.isArray(s.companies) || !s.companies.length) return d;
    s.categories = Array.isArray(s.categories) ? s.categories : [];
    s.categories.forEach((c) => {
      const i = OLD_COLORS.indexOf(String(c.color).toLowerCase());
      if (i >= 0) c.color = COLORS[i % COLORS.length];
    });
    s.entries = Array.isArray(s.entries) ? s.entries : [];
    s.timer = Object.assign(d.timer, s.timer || {});
    if (!s.companies.some((c) => c.id === s.activeCompanyId)) s.activeCompanyId = s.companies[0].id;
    return s;
  }

  let state;
  try { state = normalize(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch { state = defaultState(); }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { toast('Could not save — browser storage is full or blocked.'); }
  }

  const company = (id) => state.companies.find((c) => c.id === id);
  const category = (id) => state.categories.find((c) => c.id === id);
  const activeCompany = () => company(state.activeCompanyId);

  /* ---------- Toast ---------- */

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }

  /* ---------- Selects ---------- */

  const MANAGE = '__manage__';

  function fillCompanySelect(sel, value, withManage) {
    sel.innerHTML = state.companies.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('') +
      (withManage ? `<option disabled>──────────</option><option value="${MANAGE}">Add or edit companies…</option>` : '');
    sel.value = value;
  }
  function fillCategorySelect(sel, value, withManage) {
    sel.innerHTML = '<option value="">Uncategorized</option>' +
      state.categories.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('') +
      (withManage ? `<option disabled>──────────</option><option value="${MANAGE}">Add or edit categories…</option>` : '');
    sel.value = category(value) ? value : '';
  }

  /* ---------- Timer ---------- */

  function elapsedMs() {
    const t = state.timer;
    return t.accumulatedMs + (t.status === 'running' ? Date.now() - t.lastResumeAt : 0);
  }

  function startTimer() {
    const t = state.timer;
    const now = Date.now();
    if (t.status === 'idle') {
      t.startedAt = now;
      t.accumulatedMs = 0;
      t.companyId = state.activeCompanyId;
    }
    if (t.status !== 'running') {
      t.lastResumeAt = now;
      t.status = 'running';
    }
    save(); renderTimer();
  }

  function pauseTimer() {
    const t = state.timer;
    if (t.status !== 'running') return;
    t.accumulatedMs += Date.now() - t.lastResumeAt;
    t.status = 'paused';
    save(); renderTimer();
  }

  function clearTimer(keepFields) {
    const t = state.timer;
    Object.assign(t, { status: 'idle', startedAt: null, lastResumeAt: null, accumulatedMs: 0, companyId: null });
    if (!keepFields) { t.task = ''; t.notes = ''; }
  }

  function stopTimer() {
    const t = state.timer;
    if (t.status === 'idle') return;
    const duration = Math.round(elapsedMs() / 1000);
    if (duration < 1) { clearTimer(true); save(); renderTimer(); return; }
    const co = company(t.companyId) || activeCompany();
    state.entries.push({
      id: uid(), companyId: co.id, categoryId: category(t.categoryId) ? t.categoryId : '',
      task: t.task.trim() || 'Untitled task', notes: t.notes.trim(), start: t.startedAt, duration,
    });
    clearTimer(false);
    save(); renderAll();
    toast(`Saved ${fmtDuration(duration)} to ${co.name}`);
  }

  function resetTimer() {
    if (state.timer.status === 'idle') return;
    if (elapsedMs() >= 60000 && !confirm('Reset the timer? The time on the clock will be discarded.')) return;
    clearTimer(true);
    save(); renderTimer();
  }

  function renderTimer() {
    const t = state.timer;
    const idle = t.status === 'idle';
    $('#startBtn').textContent = t.status === 'paused' ? 'Resume' : 'Start';
    $('#startBtn').disabled = t.status === 'running';
    $('#pauseBtn').disabled = t.status !== 'running';
    $('#stopBtn').disabled = idle;
    $('#resetBtn').disabled = idle;
    document.body.dataset.timer = t.status;

    const co = company(t.companyId);
    let status = 'Ready';
    if (!idle && co) {
      status = `${t.status === 'running' ? 'Running' : 'Paused'} · started ${timeFmt.format(t.startedAt)} for ${co.name}`;
    }
    $('#timerStatus').textContent = status;
    tick();
  }

  function tick() {
    const text = fmtDuration(elapsedMs() / 1000);
    $('#timerDisplay').textContent = text;
    document.title = state.timer.status === 'idle' ? 'Timely' : `${state.timer.status === 'paused' ? '❚❚ ' : ''}${text} · Timely`;
    $('#clock').textContent = clockFmt.format(Date.now());
  }

  /* ---------- Date range ---------- */

  function currentRange() {
    const today = etDate(Date.now());
    const [y, m, d] = today.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // week starts Sunday
    const monthEnd = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
    switch ($('#rangeSelect').value) {
      case 'today': return { from: today, to: today };
      case 'week': return { from: addDays(today, -dow), to: addDays(today, 6 - dow) };
      case 'lastWeek': return { from: addDays(today, -dow - 7), to: addDays(today, -dow - 1) };
      case 'month': return { from: `${y}-${pad(m)}-01`, to: monthEnd(y, m) };
      case 'lastMonth': {
        const first = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
        return { from: first, to: monthEnd(y, m - 1) };
      }
      case 'custom': return { from: $('#fromDate').value || '0000-01-01', to: $('#toDate').value || '9999-12-31' };
      default: return { from: '0000-01-01', to: '9999-12-31' };
    }
  }

  function entriesInRange(companyId) {
    const { from, to } = currentRange();
    return state.entries
      .filter((e) => e.companyId === companyId)
      .filter((e) => { const d = etDate(e.start); return d >= from && d <= to; })
      .sort((a, b) => a.start - b.start);
  }

  /* ---------- Log ---------- */

  function renderLog() {
    const co = activeCompany();
    $('#logCompany').textContent = `· ${co.name}`;
    const list = entriesInRange(co.id);
    const total = list.reduce((n, e) => n + e.duration, 0);
    $('#rangeTotal').innerHTML = list.length
      ? `<strong>${fmtDuration(total)}</strong> <span class="muted">(${(total / 3600).toFixed(2)} h) across ${list.length} ${list.length === 1 ? 'entry' : 'entries'}</span>`
      : '';

    if (!list.length) {
      $('#entries').innerHTML = '<p class="empty">No time logged for this period yet. Start the timer or add an entry manually.</p>';
      return;
    }

    const days = new Map();
    for (const e of list) {
      const d = etDate(e.start);
      if (!days.has(d)) days.set(d, []);
      days.get(d).push(e);
    }
    const html = [...days.keys()].sort().reverse().map((d) => {
      const items = days.get(d).slice().reverse();
      const dayTotal = items.reduce((n, e) => n + e.duration, 0);
      return `<div class="day">
        <div class="day-head"><span>${esc(dayFmt.format(new Date(d + 'T12:00:00Z')))}</span><span>${fmtDuration(dayTotal)}</span></div>
        ${items.map((e) => {
          const cat = category(e.categoryId);
          return `<div class="entry" data-id="${esc(e.id)}">
            <div class="entry-time">${esc(timeFmt.format(e.start))}</div>
            <div class="entry-main">
              <div class="entry-task">${esc(e.task)}</div>
              <div class="entry-meta">
                <span class="chip"><i style="background:${esc(cat ? cat.color : '#9ca3af')}"></i>${esc(cat ? cat.name : 'Uncategorized')}</span>
                ${e.notes ? `<span class="entry-notes">${esc(e.notes)}</span>` : ''}
              </div>
            </div>
            <div class="entry-duration">${fmtDuration(e.duration)}</div>
            <div class="entry-actions">
              <button class="btn small ghost" data-act="edit">Edit</button>
              <button class="btn small ghost danger" data-act="delete">Delete</button>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('');
    $('#entries').innerHTML = html;
  }

  /* ---------- Entry dialog (manual add / edit) ---------- */

  let editingId = null;

  function openEntryDialog(entry) {
    editingId = entry ? entry.id : null;
    $('#entryDlgTitle').textContent = entry ? 'Edit entry' : 'Add entry manually';
    const now = Date.now();
    fillCompanySelect($('#eCompany'), entry ? entry.companyId : state.activeCompanyId, false);
    fillCategorySelect($('#eCategory'), entry ? entry.categoryId : state.timer.categoryId, false);
    $('#eTask').value = entry ? entry.task : '';
    $('#eDate').value = etDate(entry ? entry.start : now);
    $('#eTime').value = etTimeInput(entry ? entry.start : now - 3600000);
    $('#eDuration').value = entry ? fmtDuration(entry.duration) : '';
    $('#eNotes').value = entry ? entry.notes : '';
    $('#eError').hidden = true;
    $('#entryDlg').showModal();
    $('#eTask').focus();
  }

  function submitEntry(ev) {
    ev.preventDefault();
    const duration = parseDuration($('#eDuration').value);
    const fail = (msg) => { $('#eError').textContent = msg; $('#eError').hidden = false; };
    if (!isFinite(duration) || duration < 1) return fail('Enter a duration such as 1:30, 0:45:00, 1.5 or 1h 30m.');
    if (duration > 24 * 3600) return fail('A single entry cannot be longer than 24 hours.');
    if (!$('#eDate').value || !$('#eTime').value) return fail('Enter the date and the time the task started.');
    const existing = editingId && state.entries.find((e) => e.id === editingId);
    let start = etToUtc($('#eDate').value, $('#eTime').value);
    // Keep the original seconds when the date and minute were left untouched.
    if (existing && etDate(existing.start) === $('#eDate').value && etTimeInput(existing.start) === $('#eTime').value) start = existing.start;
    const data = {
      companyId: $('#eCompany').value, categoryId: $('#eCategory').value,
      task: $('#eTask').value.trim() || 'Untitled task', notes: $('#eNotes').value.trim(), start, duration,
    };
    if (existing) Object.assign(existing, data);
    else state.entries.push({ id: uid(), ...data });
    save();
    $('#entryDlg').close();
    renderLog();
    toast(existing ? 'Entry updated' : `Added ${fmtDuration(duration)} to ${company(data.companyId).name}`);
  }

  /* ---------- Manage companies / categories ---------- */

  let listKind = 'companies';

  function openListDialog(kind) {
    listKind = kind;
    $('#listDlgTitle').textContent = kind === 'companies' ? 'Companies' : 'Categories';
    $('#listNewName').placeholder = kind === 'companies' ? 'New company name' : 'New category name';
    $('#listNewName').value = '';
    renderListItems();
    $('#listDlg').showModal();
    $('#listNewName').focus();
  }

  function renderListItems() {
    const items = state[listKind];
    $('#listItems').innerHTML = items.map((it) => `<div class="list-item" data-id="${esc(it.id)}">
      ${listKind === 'categories' ? `<input type="color" value="${esc(it.color)}" aria-label="Color for ${esc(it.name)}">` : ''}
      <input type="text" value="${esc(it.name)}" aria-label="Name">
      <button type="button" class="btn small ghost danger" data-act="remove">Delete</button>
    </div>`).join('') || '<p class="empty">None yet.</p>';
  }

  function addListItem() {
    const name = $('#listNewName').value.trim();
    if (!name) return;
    if (state[listKind].some((it) => it.name.toLowerCase() === name.toLowerCase())) return toast(`"${name}" already exists`);
    if (listKind === 'companies') {
      const id = uid();
      state.companies.push({ id, name });
      if (state.timer.status === 'idle') state.activeCompanyId = id;
    } else {
      state.categories.push({ id: uid(), name, color: COLORS[state.categories.length % COLORS.length] });
    }
    $('#listNewName').value = '';
    save(); renderListItems(); renderAll();
    $('#listNewName').focus();
  }

  function removeListItem(id) {
    if (listKind === 'companies') {
      if (state.companies.length === 1) return toast('You need at least one company.');
      if (state.timer.companyId === id) return toast('Stop or reset the timer for this company first.');
      const co = company(id);
      const count = state.entries.filter((e) => e.companyId === id).length;
      if (!confirm(count ? `Delete "${co.name}" and its ${count} logged ${count === 1 ? 'entry' : 'entries'}? This cannot be undone.` : `Delete "${co.name}"?`)) return;
      state.companies = state.companies.filter((c) => c.id !== id);
      state.entries = state.entries.filter((e) => e.companyId !== id);
      if (state.activeCompanyId === id) state.activeCompanyId = state.companies[0].id;
    } else {
      const cat = category(id);
      const count = state.entries.filter((e) => e.categoryId === id).length;
      if (count && !confirm(`Delete "${cat.name}"? ${count} ${count === 1 ? 'entry' : 'entries'} will become Uncategorized.`)) return;
      state.categories = state.categories.filter((c) => c.id !== id);
      state.entries.forEach((e) => { if (e.categoryId === id) e.categoryId = ''; });
      if (state.timer.categoryId === id) state.timer.categoryId = '';
    }
    save(); renderListItems(); renderAll();
  }

  /* ---------- Excel export ---------- */

  const COLUMNS = [
    { header: 'Date', width: 12, type: 'date' },
    { header: 'Time Started (ET)', width: 18, type: 'time' },
    { header: 'Duration (h:mm:ss)', width: 18, type: 'duration' },
    { header: 'Hours (decimal)', width: 15, type: 'number' },
    { header: 'Company', width: 22, type: 'text' },
    { header: 'Category', width: 18, type: 'text' },
    { header: 'Task Details', width: 44, type: 'wrap' },
    { header: 'Notes / Comments', width: 44, type: 'wrap' },
  ];

  function sheetFor(co) {
    const rows = entriesInRange(co.id).map((e) => {
      const serial = excelSerial(e.start);
      const cat = category(e.categoryId);
      return [
        Math.floor(serial), serial - Math.floor(serial), e.duration / 86400, Math.round(e.duration / 36) / 100,
        co.name, cat ? cat.name : 'Uncategorized', e.task, e.notes,
      ];
    });
    return { name: co.name, columns: COLUMNS, rows, totals: { label: 'Total', sumColumns: [2, 3] } };
  }

  function rangeLabel() {
    const sel = $('#rangeSelect');
    const { from, to } = currentRange();
    if (sel.value === 'all') return { text: 'all time', file: 'all-time' };
    if (from === to) return { text: from, file: from };
    const lo = from.startsWith('0000') ? 'start' : from, hi = to.startsWith('9999') ? 'today' : to;
    return { text: `${lo} to ${hi}`, file: `${lo}_to_${hi}` };
  }

  function openExportDialog() {
    const co = activeCompany();
    const n = entriesInRange(co.id).length;
    const all = state.companies.reduce((sum, c) => sum + entriesInRange(c.id).length, 0);
    $('#exportSummary').textContent = `Period: ${rangeLabel().text}. Times are in US Eastern Time.`;
    $('#exportCurrentLabel').textContent = `${co.name} only (${n} ${n === 1 ? 'entry' : 'entries'})`;
    const allRadio = document.querySelector('input[name="scope"][value="all"]');
    allRadio.closest('label').hidden = state.companies.length < 2;
    allRadio.nextElementSibling.textContent = `All companies, one sheet each (${all} ${all === 1 ? 'entry' : 'entries'})`;
    document.querySelector('input[name="scope"][value="current"]').checked = true;
    $('#exportDlg').showModal();
  }

  function download(bytes, filename, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function doExport(ev) {
    ev.preventDefault();
    const all = document.querySelector('input[name="scope"]:checked').value === 'all';
    const cos = all ? state.companies : [activeCompany()];
    const sheets = cos.map(sheetFor);
    if (!sheets.some((s) => s.rows.length)) { $('#exportDlg').close(); return toast('Nothing to export for this period.'); }
    const safe = (s) => s.replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '') || 'export';
    const filename = `Timely_${all ? 'All-Companies' : safe(cos[0].name)}_${rangeLabel().file}.xlsx`;
    download(buildXlsx(sheets), filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    $('#exportDlg').close();
    toast(`Exported ${filename}`);
  }

  /* ---------- Backup / restore ---------- */

  function backup() {
    download(new TextEncoder().encode(JSON.stringify(state, null, 2)), `timely-backup-${etDate(Date.now())}.json`, 'application/json');
  }

  async function restore(file) {
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.companies) || !data.companies.length || !Array.isArray(data.entries)) throw new Error('bad file');
      if (!confirm(`Replace everything in Timely with this backup (${data.entries.length} entries, ${data.companies.length} companies)?`)) return;
      state = normalize(data);
      save(); renderAll();
      toast('Backup restored');
    } catch {
      toast('That file is not a Timely backup.');
    }
  }

  /* ---------- Rendering & events ---------- */

  function renderAll() {
    fillCompanySelect($('#companySelect'), state.activeCompanyId, true);
    fillCategorySelect($('#timerCategory'), state.timer.categoryId, true);
    $('#timerTask').value = state.timer.task;
    $('#timerNotes').value = state.timer.notes;
    renderTimer();
    renderLog();
  }

  $('#startBtn').addEventListener('click', startTimer);
  $('#pauseBtn').addEventListener('click', pauseTimer);
  $('#stopBtn').addEventListener('click', stopTimer);
  $('#resetBtn').addEventListener('click', resetTimer);

  $('#timerTask').addEventListener('input', (e) => { state.timer.task = e.target.value; save(); });
  $('#timerNotes').addEventListener('input', (e) => { state.timer.notes = e.target.value; save(); });
  $('#timerTask').addEventListener('keydown', (e) => { if (e.key === 'Enter' && state.timer.status === 'idle') startTimer(); });

  $('#timerCategory').addEventListener('change', (e) => {
    if (e.target.value === MANAGE) { e.target.value = state.timer.categoryId; return openListDialog('categories'); }
    state.timer.categoryId = e.target.value; save();
  });
  $('#companySelect').addEventListener('change', (e) => {
    if (e.target.value === MANAGE) { e.target.value = state.activeCompanyId; return openListDialog('companies'); }
    state.activeCompanyId = e.target.value;
    save(); renderLog();
  });

  $('#rangeSelect').addEventListener('change', () => {
    const custom = $('#rangeSelect').value === 'custom';
    document.querySelectorAll('.custom-range').forEach((el) => { el.hidden = !custom; });
    if (custom && !$('#fromDate').value) {
      const today = etDate(Date.now());
      $('#fromDate').value = today.slice(0, 8) + '01';
      $('#toDate').value = today;
    }
    renderLog();
  });
  $('#fromDate').addEventListener('change', renderLog);
  $('#toDate').addEventListener('change', renderLog);

  $('#addEntryBtn').addEventListener('click', () => openEntryDialog(null));
  $('#entryForm').addEventListener('submit', submitEntry);
  $('#entries').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const entry = state.entries.find((x) => x.id === btn.closest('.entry').dataset.id);
    if (!entry) return;
    if (btn.dataset.act === 'edit') return openEntryDialog(entry);
    if (confirm(`Delete "${entry.task}" (${fmtDuration(entry.duration)})?`)) {
      state.entries = state.entries.filter((x) => x !== entry);
      save(); renderLog();
    }
  });

  $('#listAddBtn').addEventListener('click', addListItem);
  $('#listNewName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addListItem(); } });
  $('#listItems').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act="remove"]');
    if (btn) removeListItem(btn.closest('.list-item').dataset.id);
  });
  $('#listItems').addEventListener('change', (e) => {
    const row = e.target.closest('.list-item');
    const item = row && state[listKind].find((it) => it.id === row.dataset.id);
    if (!item) return;
    if (e.target.type === 'color') item.color = e.target.value;
    else if (e.target.value.trim()) item.name = e.target.value.trim();
    else e.target.value = item.name;
    save(); renderAll();
  });
  // Enter inside a name field should commit the rename, not close the dialog.
  $('#listItems').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });

  $('#exportBtn').addEventListener('click', openExportDialog);
  $('#exportForm').addEventListener('submit', doExport);

  $('#backupBtn').addEventListener('click', backup);
  $('#restoreBtn').addEventListener('click', () => $('#restoreFile').click());
  $('#restoreFile').addEventListener('change', (e) => { if (e.target.files[0]) restore(e.target.files[0]); e.target.value = ''; });

  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

  // Keep several open windows in sync.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try { state = normalize(JSON.parse(e.newValue)); renderAll(); } catch { /* ignore */ }
  });

  renderAll();
  setInterval(tick, 250);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
