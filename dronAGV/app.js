/**
 * dronAGV — Inspección telemetría (HTML + CSS + JS)
 */
(function () {
  const STORAGE_KEY = 'dronAGV_inspecciones_v3';
  const RING_R = 52;
  const RING_C = 2 * Math.PI * RING_R;
  const FIELD_COUNT = 9;
  const RECORDS_PAGE_SIZE = 10;
  const EM = '\u2014';

  const META_FIELDS = [{ key: 'rtk', label: 'Equipo / RTK' }];

  const NUM_FIELDS = [
    { key: 'hectares', label: 'Área operada', unit: 'ha', dec: 2 },
    { key: 'liters', label: 'Líquido aplicado', unit: 'L', dec: 1 },
    { key: 'altitude', label: 'Altitud', unit: 'm', dec: 1 },
    { key: 'flowRate', label: 'Tasa de flujo', unit: 'L/min', dec: 2 },
    { key: 'speed', label: 'Velocidad', unit: 'm/s', dec: 1 },
    { key: 'distance', label: 'Distancia', unit: 'm', dec: 0 },
    { key: 'routeMeters', label: 'Medida visible terreno/ruta', unit: 'm', dec: 1 },
    { key: 'lateralMeters', label: 'Valor lateral', unit: 'm', dec: 0 },
  ];

  const $ = (id) => document.getElementById(id);

  const SWAL_THEME = {
    background: '#0c1824',
    color: '#f4f7fb',
    confirmButtonColor: '#22c55e',
    cancelButtonColor: '#475569',
    customClass: {
      popup: 'swal-dron-popup',
      confirmButton: 'swal-dron-confirm',
      cancelButton: 'swal-dron-cancel',
    },
    showClass: { popup: 'swal-dron-show' },
    hideClass: { popup: 'swal-dron-hide' },
  };

  function swalWarn(title, text) {
    if (typeof Swal === 'undefined') {
      alert(text || title);
      return Promise.resolve();
    }
    return Swal.fire({
      ...SWAL_THEME,
      icon: 'warning',
      title,
      text,
      confirmButtonText: 'Entendido',
    });
  }

  function swalInfo(title, text) {
    if (typeof Swal === 'undefined') {
      alert(text || title);
      return Promise.resolve();
    }
    return Swal.fire({
      ...SWAL_THEME,
      icon: 'info',
      title,
      text,
      confirmButtonText: 'OK',
    });
  }

  function swalConfirm(title, text, confirmText = 'Sí, continuar') {
    if (typeof Swal === 'undefined') {
      return Promise.resolve({ isConfirmed: confirm(text || title) });
    }
    return Swal.fire({
      ...SWAL_THEME,
      icon: 'question',
      title,
      text,
      showCancelButton: true,
      confirmButtonText: confirmText,
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
    });
  }

  function swalToast(title, icon = 'success') {
    if (typeof Swal === 'undefined') return;
    Swal.fire({
      toast: true,
      position: 'top',
      icon,
      title,
      timer: 2400,
      timerProgressBar: true,
      showConfirmButton: false,
      background: '#0c1824',
      color: '#f4f7fb',
      customClass: { popup: 'swal-dron-toast' },
    });
  }

  let records = [];
  let recordsPage = 1;
  let modalRecordId = null;
  let terrainBounds = null;
  let patrolActive = false;
  let hudDebounce = null;

  const inp = {
    rtk: $('inpRtk'),
    hectares: $('inpHectares'),
    liters: $('inpLiters'),
    altitude: $('inpAltitude'),
    flowRate: $('inpFlowRate'),
    speed: $('inpSpeed'),
    distance: $('inpDistance'),
    routeMeters: $('inpRouteMeters'),
    lateralMeters: $('inpLateralMeters'),
  };

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function formatDateLabel(dateStr, timeStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const day = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    return `Inspección · ${day} · ${timeStr}`;
  }

  function cleanNumber(raw) {
    if (raw == null || raw === '') return null;
    let s = String(raw).replace(/[^\d,.-]/g, '');
    const lc = s.lastIndexOf(',');
    const ld = s.lastIndexOf('.');
    if (lc > ld) s = s.replace(/\./g, '').replace(',', '.');
    else if (ld > lc) s = s.replace(/,/g, '');
    else s = s.replace(/,/g, '.');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  function formatES(n, dec = 2) {
    if (n == null || Number.isNaN(n)) return EM;
    return n.toLocaleString('es-ES', {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
    });
  }

  function readForm() {
    return {
      rtk: inp.rtk?.value?.trim() || '',
      hectares: cleanNumber(inp.hectares?.value),
      liters: cleanNumber(inp.liters?.value),
      altitude: cleanNumber(inp.altitude?.value),
      flowRate: cleanNumber(inp.flowRate?.value),
      speed: cleanNumber(inp.speed?.value),
      distance: cleanNumber(inp.distance?.value),
      routeMeters: cleanNumber(inp.routeMeters?.value),
      lateralMeters: cleanNumber(inp.lateralMeters?.value),
    };
  }

  function countFilled(t) {
    let n = 0;
    if (t.rtk) n += 1;
    n += NUM_FIELDS.filter((f) => t[f.key] != null).length;
    return n;
  }

  function countNumeric(t) {
    return NUM_FIELDS.filter((f) => t[f.key] != null).length;
  }

  function setRingProgress(el, pct) {
    if (!el) return;
    const clamped = Math.max(0, Math.min(100, pct));
    el.style.strokeDasharray = `${RING_C}`;
    el.style.strokeDashoffset = `${RING_C * (1 - clamped / 100)}`;
  }

  function drawTerrain(t) {
    const g = $('terrainPaths');
    const poly = $('terrainPoly');
    if (!g || !poly) return;

    const route = t.routeMeters > 0 ? t.routeMeters : 723.6;
    const lateral = t.lateralMeters > 0 ? t.lateralMeters : 219;
    const ratio = Math.max(1.2, Math.min(4.5, route / lateral));

    const vw = 300;
    const vh = 180;
    const cw = Math.min(210, vw - 48);
    const ch = Math.min(100, cw / ratio, vh - 44);
    const x0 = (vw - cw) / 2;
    const y0 = (vh - ch) / 2;
    const x1 = x0 + cw;
    const y1 = y0 + ch;

    const ptsStr = `${x0},${y0} ${x1},${y0} ${x1},${y1} ${x0},${y1}`;
    poly.setAttribute('points', ptsStr);
    const glow = $('terrainGlow');
    if (glow) glow.setAttribute('points', ptsStr);

    const corners = document.querySelectorAll('.terrain-corners circle');
    const pts = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    corners.forEach((c, i) => {
      if (pts[i]) {
        c.setAttribute('cx', pts[i][0]);
        c.setAttribute('cy', pts[i][1]);
      }
    });

    g.innerHTML = '';
    const lines = 8;
    const pad = 14;
    const innerH = ch - pad * 2;
    for (let i = 0; i < lines; i++) {
      const y = y0 + pad + (i / (lines - 1)) * innerH;
      const left = x0 + pad;
      const right = x1 - pad;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const d =
        i % 2 === 0
          ? `M ${left} ${y} L ${right} ${y}`
          : `M ${right} ${y} L ${left} ${y}`;
      path.setAttribute('d', d);
      path.setAttribute('class', 'path-line');
      g.appendChild(path);
    }

    terrainBounds = { x0, y0, x1, y1, pad, innerH, vw, vh };

    const mapWrap = $('terrainMapWrap');
    if (mapWrap) {
      const pctX = (n) => `${(n / vw) * 100}%`;
      const pctY = (n) => `${(n / vh) * 100}%`;
      mapWrap.style.setProperty('--plot-left', pctX(x0));
      mapWrap.style.setProperty('--plot-top', pctY(y0));
      mapWrap.style.setProperty('--plot-width', pctX(x1 - x0));
      mapWrap.style.setProperty('--plot-height', pctY(y1 - y0));
      const mapH = mapWrap.offsetHeight || mapWrap.getBoundingClientRect().height;
      const beamPx = mapH > 0 ? (ch / vh) * mapH + 40 : 120;
      mapWrap.style.setProperty('--beam-length', `${beamPx}px`);
    }
  }

  function animateDronePatrol() {
    if (!patrolActive || document.hidden) {
      if (patrolActive) requestAnimationFrame(animateDronePatrol);
      return;
    }
    const unit = $('flightUnit');
    if (unit && terrainBounds) {
      const phase = (Date.now() % 10000) / 10000;
      const { x0, x1, pad } = terrainBounds;
      const plotW = x1 - x0;
      const innerW = plotW - pad * 2;
      const travel = Math.max(0, innerW - 34);
      const x = pad + travel * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
      unit.style.left = `${(x / plotW) * 100}%`;

      const glow = $('terrainGlow');
      if (glow) {
        glow.style.opacity = String(0.4 + 0.3 * Math.sin(phase * Math.PI * 2));
      }
    }
    requestAnimationFrame(animateDronePatrol);
  }

  function startDronePatrol() {
    if (patrolActive) return;
    patrolActive = true;
    requestAnimationFrame(animateDronePatrol);
  }

  function scheduleHudUpdate() {
    if (hudDebounce) clearTimeout(hudDebounce);
    hudDebounce = setTimeout(() => {
      hudDebounce = null;
      updateHud();
    }, 60);
  }

  function chipPreview(t) {
    const parts = [];
    if (t.hectares != null) parts.push(`${formatES(t.hectares, 2)} ha`);
    if (t.liters != null) parts.push(`${formatES(t.liters, 1)} L`);
    if (t.routeMeters != null) parts.push(`Ruta ${formatES(t.routeMeters, 1)} m`);
    return parts.length ? parts.join(' · ') : 'Ver detalles';
  }

  function updateHud() {
    const t = readForm();
    const routeTxt =
      t.routeMeters != null ? `${formatES(t.routeMeters, 1)} m` : `${EM} m`;
    const latTxt =
      t.lateralMeters != null ? `${formatES(t.lateralMeters, 0)} m` : `${EM} m`;
    const haTxt =
      t.hectares != null ? `${formatES(t.hectares, 2)} ha` : `${EM} ha`;

    $('hudRoute').textContent = routeTxt;
    $('hudLateral').textContent = latTxt;
    $('hudHa').textContent = haTxt;

    const mRouteB = $('hudMeasureRouteBottom');
    const mLatL = $('hudMeasureLateralLeft');
    const mLatR = $('hudMeasureLateral');
    if (mRouteB) mRouteB.textContent = routeTxt;
    [mLatL, mLatR].forEach((el) => {
      if (el) el.textContent = latTxt;
    });

    if ($('heroRtk')) {
      $('heroRtk').textContent = t.rtk || `RTK ${EM}`;
    }
    if ($('heroHa')) $('heroHa').textContent = haTxt;
    if ($('heroL')) {
      $('heroL').textContent =
        t.liters != null ? `${formatES(t.liters, 1)} L` : `${EM} L`;
    }
    if ($('heroRoute')) $('heroRoute').textContent = routeTxt;

    drawTerrain(t);
  }

  function updateDailySummary() {
    const today = todayKey();
    const dayRecords = records.filter((r) => r.date === today);
    let totalHa = 0;
    let totalL = 0;
    for (const r of dayRecords) {
      if (r.hectares != null) totalHa += r.hectares;
      if (r.liters != null) totalL += r.liters;
    }
    $('totalHa').textContent = formatES(totalHa, 2);
    $('totalL').textContent = formatES(totalL, 1);
    $('flightCount').textContent = String(dayRecords.length);
    $('summaryDate').textContent = new Date().toLocaleDateString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }

  function saveStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  function loadStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      records = raw ? JSON.parse(raw) : [];
    } catch {
      records = [];
    }
  }

  function showSaveOverlay(show) {
    const el = $('saveOverlay');
    if (!el) return;
    el.classList.toggle('show', show);
    el.setAttribute('aria-hidden', show ? 'false' : 'true');
    document.body.style.overflow = show ? 'hidden' : '';
  }

  async function runSaveAnimation() {
    const ring = $('saveRingProgress');
    const title = $('saveOverlayTitle');
    const sub = $('saveOverlaySub');
    const steps = [
      { p: 20, t: 'Guardando inspección', s: 'Leyendo telemetría…' },
      { p: 55, t: 'Guardando inspección', s: 'Validando ruta y área…' },
      { p: 85, t: 'Guardando inspección', s: 'Registrando en bitácora…' },
      { p: 100, t: 'Listo', s: 'Inspección guardada' },
    ];
    showSaveOverlay(true);
    for (const step of steps) {
      if (title) title.textContent = step.t;
      if (sub) sub.textContent = step.s;
      setRingProgress(ring, step.p);
      await new Promise((r) => setTimeout(r, step.p === 100 ? 450 : 400));
    }
    await new Promise((r) => setTimeout(r, 400));
    showSaveOverlay(false);
    setRingProgress(ring, 0);
    if (title) title.textContent = 'Guardando inspección';
    if (sub) sub.textContent = 'Sincronizando telemetría…';
  }

  function openModal(record) {
    modalRecordId = record.id;
    $('modalTitle').textContent = formatDateLabel(record.date, record.time);
    $('modalSubtitle').textContent = record.rtk || 'Controlador agrícola';
    const body = $('modalBody');
    let html = '';
    for (const { key, label } of META_FIELDS) {
      if (record[key]) {
        html += `<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-val">${escapeHtml(record[key])}</span></div>`;
      }
    }
    html += '<p class="detail-section">Telemetría</p>';
    for (const { key, label, unit, dec } of NUM_FIELDS) {
      if (record[key] != null) {
        html += `<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-val">${formatES(record[key], dec)} ${unit}</span></div>`;
      }
    }
    body.innerHTML = html || '<p class="detail-label">Sin datos numéricos.</p>';
    $('detailModal').classList.add('open');
    $('detailModal').setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    $('detailModal').classList.remove('open');
    $('detailModal').setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    modalRecordId = null;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getTodayRecords() {
    return records.filter((r) => r.date === todayKey());
  }

  function getRecordsTotalPages(total) {
    return Math.max(1, Math.ceil(total / RECORDS_PAGE_SIZE));
  }

  function clampRecordsPage(total) {
    const totalPages = getRecordsTotalPages(total);
    if (recordsPage > totalPages) recordsPage = totalPages;
    if (recordsPage < 1) recordsPage = 1;
    return totalPages;
  }

  function goToRecordsPage(page) {
    const total = getTodayRecords().length;
    const totalPages = getRecordsTotalPages(total);
    recordsPage = Math.max(1, Math.min(totalPages, page));
    renderRecords();
  }

  function buildPageList(totalPages, current) {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages = new Set([1, totalPages, current, current - 1, current + 1]);
    const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push('…');
      out.push(sorted[i]);
    }
    return out;
  }

  function renderRecordsPagination(total) {
    const nav = $('recordsPagination');
    const info = $('recordsPageInfo');
    const nums = $('recordsPageNums');
    const prev = $('recordsPagePrev');
    const next = $('recordsPageNext');
    if (!nav || !nums) return;

    if (total === 0) {
      nav.hidden = true;
      if (info) info.hidden = true;
      return;
    }

    const totalPages = clampRecordsPage(total);
    const start = (recordsPage - 1) * RECORDS_PAGE_SIZE + 1;
    const end = Math.min(recordsPage * RECORDS_PAGE_SIZE, total);

    nav.hidden = false;
    if (info) {
      info.hidden = false;
      info.textContent = `Mostrando ${start}–${end} de ${total} · Página ${recordsPage} de ${totalPages}`;
    }

    if (prev) prev.disabled = recordsPage <= 1;
    if (next) next.disabled = recordsPage >= totalPages;

    nums.innerHTML = '';
    for (const item of buildPageList(totalPages, recordsPage)) {
      if (item === '…') {
        const span = document.createElement('span');
        span.className = 'page-ellipsis';
        span.textContent = '…';
        span.setAttribute('aria-hidden', 'true');
        nums.appendChild(span);
        continue;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'page-num' + (item === recordsPage ? ' active' : '');
      b.textContent = String(item);
      b.setAttribute('aria-label', `Página ${item}`);
      b.setAttribute('aria-current', item === recordsPage ? 'page' : 'false');
      b.addEventListener('click', () => goToRecordsPage(item));
      nums.appendChild(b);
    }
  }

  function renderRecords(highlightId) {
    const list = $('recordsList');
    const empty = $('recordsEmpty');
    const dayRecords = getTodayRecords();

    list.innerHTML = '';
    if (!dayRecords.length) {
      empty.hidden = false;
      renderRecordsPagination(0);
      return;
    }
    empty.hidden = true;

    const total = dayRecords.length;
    clampRecordsPage(total);
    const start = (recordsPage - 1) * RECORDS_PAGE_SIZE;
    const pageRecords = dayRecords.slice(start, start + RECORDS_PAGE_SIZE);

    pageRecords.forEach((r) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'inspect-chip';
      if (r.id === highlightId) btn.style.animationDelay = '0s';
      btn.dataset.id = r.id;
      btn.innerHTML = `
        <span class="chip-icon" aria-hidden="true"></span>
        <span class="chip-body">
          <p class="chip-title">${escapeHtml(formatDateLabel(r.date, r.time))}</p>
          <p class="chip-meta">${escapeHtml(r.rtk || 'RTK')}</p>
          <p class="chip-preview">${escapeHtml(chipPreview(r))}</p>
        </span>
        <span class="chip-arrow" aria-hidden="true">›</span>
      `;
      btn.addEventListener('click', () => openModal(r));
      list.appendChild(btn);
    });

    renderRecordsPagination(total);
  }

  function initRecordsPagination() {
    $('recordsPagePrev')?.addEventListener('click', () => goToRecordsPage(recordsPage - 1));
    $('recordsPageNext')?.addEventListener('click', () => goToRecordsPage(recordsPage + 1));
  }

  async function onSubmit(e) {
    e.preventDefault();
    const data = readForm();
    if (countFilled(data) === 0) {
      await swalWarn(
        'Sin datos',
        'Ingresa al menos un dato: equipo RTK o cualquier valor numérico.'
      );
      return;
    }
    await runSaveAnimation();
    const record = {
      id: `r_${Date.now()}`,
      date: todayKey(),
      time: new Date().toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      ...data,
    };
    records.unshift(record);
    saveStorage();
    recordsPage = 1;
    renderRecords(record.id);
    updateDailySummary();
    const listEl = $('recordsList');
    if (listEl?.firstChild) {
      listEl.firstChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    swalToast('Inspección guardada');
  }

  async function clearForm() {
    const t = readForm();
    if (countFilled(t) === 0) {
      updateHud();
      return;
    }
    const res = await swalConfirm(
      'Limpiar campos',
      'Se borrarán los valores del formulario. ¿Continuar?',
      'Sí, limpiar'
    );
    if (!res.isConfirmed) return;
    Object.values(inp).forEach((el) => {
      if (el) el.value = '';
    });
    updateHud();
  }

  function exportColumns() {
    return [
      { key: 'date', label: 'Fecha', width: 12 },
      { key: 'time', label: 'Hora', width: 9 },
      ...META_FIELDS.map((f) => ({ key: f.key, label: f.label, width: 14 })),
      ...NUM_FIELDS.map((f) => ({
        key: f.key,
        label: `${f.label} (${f.unit})`,
        width: 16,
        dec: f.dec,
      })),
    ];
  }

  function recordToExportRow(r, cols) {
    return cols.map((col) => {
      if (col.key === 'date') return r.date || '';
      if (col.key === 'time') return r.time || '';
      if (col.dec != null) {
        const v = r[col.key];
        return v != null ? formatES(v, col.dec) : '';
      }
      return r[col.key] != null ? String(r[col.key]) : '';
    });
  }

  function applySheetStyle(ws, row, col, style) {
    const addr = XLSX.utils.encode_cell({ r: row, c: col });
    if (!ws[addr]) ws[addr] = { t: 's', v: '' };
    ws[addr].s = style;
  }

  function styleRow(ws, row, colCount, style) {
    for (let c = 0; c < colCount; c++) applySheetStyle(ws, row, c, style);
  }

  async function exportExcel() {
    const today = todayKey();
    const dayRecords = records.filter((r) => r.date === today);
    if (!dayRecords.length) {
      await swalInfo(
        'Sin exportación',
        'No hay inspecciones de hoy para generar el Excel.'
      );
      return;
    }
    if (typeof XLSX === 'undefined' || !XLSX.utils?.book_new) {
      await swalWarn(
        'Excel no disponible',
        'No se cargó la librería. Comprueba tu conexión a internet.'
      );
      return;
    }

    const cols = exportColumns();
    const colCount = cols.length;
    const exportedAt = new Date().toLocaleString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const aoa = [
      ['dronAGV — Bitácora de inspecciones'],
      ['Exportado:', exportedAt, 'Registros del día:', String(dayRecords.length)],
      [],
      cols.map((c) => c.label),
      ...dayRecords.map((r) => recordToExportRow(r, cols)),
    ];

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const headerRow = 3;
    const dataStart = 4;

    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } }];
    ws['!cols'] = cols.map((c) => ({ wch: c.width }));
    ws['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 8 }, { hpt: 36 }];

    const styleTitle = {
      font: { bold: true, sz: 14, color: { rgb: '86EFAC' } },
      fill: { fgColor: { rgb: '0C1824' } },
      alignment: { horizontal: 'center', vertical: 'center' },
    };
    const styleMeta = {
      font: { bold: true, sz: 10, color: { rgb: '334155' } },
      fill: { fgColor: { rgb: 'E2E8F0' } },
      alignment: { vertical: 'center' },
    };
    const styleMetaVal = {
      font: { sz: 10, color: { rgb: '0F172A' } },
      fill: { fgColor: { rgb: 'F1F5F9' } },
      alignment: { vertical: 'center' },
    };
    const styleHeader = {
      font: { bold: true, sz: 10, color: { rgb: '052E16' } },
      fill: { fgColor: { rgb: '86EFAC' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: {
        top: { style: 'thin', color: { rgb: '22C55E' } },
        bottom: { style: 'medium', color: { rgb: '16A34A' } },
        left: { style: 'thin', color: { rgb: '22C55E' } },
        right: { style: 'thin', color: { rgb: '22C55E' } },
      },
    };
    const styleCell = {
      font: { sz: 10, color: { rgb: '1E293B' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: {
        top: { style: 'thin', color: { rgb: 'CBD5E1' } },
        bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
        left: { style: 'thin', color: { rgb: 'E2E8F0' } },
        right: { style: 'thin', color: { rgb: 'E2E8F0' } },
      },
    };
    const styleCellAlt = {
      ...styleCell,
      fill: { fgColor: { rgb: 'F8FAFC' } },
    };

    styleRow(ws, 0, colCount, styleTitle);
    for (let c = 0; c < colCount; c++) {
      applySheetStyle(ws, 1, c, c % 2 === 0 ? styleMeta : styleMetaVal);
    }
    styleRow(ws, headerRow, colCount, styleHeader);

    for (let i = 0; i < dayRecords.length; i++) {
      const style = i % 2 === 0 ? styleCell : styleCellAlt;
      styleRow(ws, dataStart + i, colCount, style);
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inspecciones');
    XLSX.writeFile(wb, `dronAGV_${today}.xlsx`, { cellStyles: true });
    swalToast('Excel descargado', 'success');
  }

  async function resetDay() {
    const today = todayKey();
    const n = records.filter((r) => r.date === today).length;
    if (!n) {
      await swalInfo('Nada que reiniciar', 'No hay inspecciones registradas hoy.');
      return;
    }
    const res = await swalConfirm(
      'Reiniciar día',
      `Se eliminarán ${n} inspección${n === 1 ? '' : 'es'} de hoy. Esta acción no se puede deshacer.`,
      'Sí, borrar todo'
    );
    if (!res.isConfirmed) return;
    records = records.filter((r) => r.date !== today);
    saveStorage();
    recordsPage = 1;
    renderRecords();
    updateDailySummary();
    closeModal();
    swalToast('Día reiniciado');
  }

  function initModal() {
    document.querySelectorAll('[data-close]').forEach((el) => {
      el.addEventListener('click', closeModal);
    });
    $('modalDelete')?.addEventListener('click', async () => {
      if (!modalRecordId) return;
      const res = await swalConfirm(
        'Eliminar inspección',
        '¿Quitar este registro de la bitácora de hoy?',
        'Sí, eliminar'
      );
      if (!res.isConfirmed) return;
      records = records.filter((r) => r.id !== modalRecordId);
      saveStorage();
      renderRecords();
      updateDailySummary();
      closeModal();
      swalToast('Inspección eliminada');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  }

  function startApp() {
    loadStorage();
    updateHud();
    updateDailySummary();
    renderRecords();
    initModal();
    initRecordsPagination();

    $('inspectForm')?.addEventListener('submit', onSubmit);
    $('btnClear')?.addEventListener('click', clearForm);
    $('btnExport')?.addEventListener('click', exportExcel);
    $('btnReset')?.addEventListener('click', resetDay);
    Object.values(inp).forEach((el) =>
      el?.addEventListener('input', scheduleHudUpdate, { passive: true })
    );
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && patrolActive) requestAnimationFrame(animateDronePatrol);
    });
    startDronePatrol();
  }

  function init() {
    startApp();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
