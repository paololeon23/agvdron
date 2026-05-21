/**
 * dronAGV — Inspección telemetría (HTML + CSS + JS)
 */
(function () {
  const STORAGE_KEY = 'dronAGV_inspecciones_v3';
  const SESSION_KEY = 'dronAGV_session_v1';
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

  function swalToast(title, icon = 'success', options = {}) {
    if (options.sound !== false) {
      if (icon === 'success') window.DronSounds?.play('success');
      else if (icon === 'warning' || icon === 'error') window.DronSounds?.play('warning');
    }
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
  let pdfRecord = null;
  let pdfBlob = null;
  let pdfBlobUrl = null;
  let pdfPreviewDoc = null;
  let pdfPreviewRender = null;
  let pdfPreviewFitScale = 1;
  let pdfPreviewScale = 1;
  let terrainBounds = null;
  let patrolActive = false;
  let hudDebounce = null;
  let sessionSaveTimer = null;

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
    const cw = Math.min(232, vw - 36);
    const ch = Math.min(118, cw / ratio, vh - 36);
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
    const lines = 9;
    const pad = 6;
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

  function saveSession() {
    clearTimeout(sessionSaveTimer);
    sessionSaveTimer = setTimeout(() => {
      const draft = {};
      Object.keys(inp).forEach((k) => {
        if (inp[k]) draft[k] = inp[k].value;
      });
      try {
        localStorage.setItem(
          SESSION_KEY,
          JSON.stringify({
            draft,
            recordsPage,
            scrollY: window.scrollY || 0,
            at: Date.now(),
          })
        );
      } catch {
        /* almacenamiento lleno */
      }
    }, 300);
  }

  function restoreSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.draft) {
        Object.keys(inp).forEach((k) => {
          if (inp[k] && s.draft[k] != null) inp[k].value = String(s.draft[k]);
        });
      }
      if (s.recordsPage >= 1) recordsPage = s.recordsPage;
      const scrollY = Number(s.scrollY);
      if (Number.isFinite(scrollY) && scrollY > 0) {
        requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'auto' }));
      }
    } catch {
      /* ignore */
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
    window.DronSounds?.play('drone');
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
    window.DronSounds?.play('tap');
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
    if (!$('pdfModal')?.classList.contains('open')) {
      document.body.style.overflow = '';
    }
    modalRecordId = null;
  }

  function pdfFilename(r) {
    const safeTime = (r.time || '').replace(/:/g, '-');
    return `dronAGV_${r.date}_${safeTime}.pdf`;
  }

  function getPdfJs() {
    return window.pdfjsLib || window['pdfjs-dist/build/pdf'];
  }

  function setupPdfJsWorker() {
    const lib = getPdfJs();
    if (!lib) return false;
    if (!lib.GlobalWorkerOptions.workerSrc) {
      lib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    }
    return true;
  }

  async function destroyPdfPreview() {
    if (pdfPreviewRender) {
      try {
        await pdfPreviewRender.cancel();
      } catch {
        /* ignore */
      }
      pdfPreviewRender = null;
    }
    if (pdfPreviewDoc) {
      try {
        await pdfPreviewDoc.destroy();
      } catch {
        /* ignore */
      }
      pdfPreviewDoc = null;
    }
    const canvas = $('pdfCanvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  async function paintPdfPage(page, canvas, scale) {
    const viewport = page.getViewport({ scale });
    const ctx = canvas.getContext('2d');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    if (pdfPreviewRender) {
      try {
        await pdfPreviewRender.cancel();
      } catch {
        /* ignore */
      }
    }
    pdfPreviewRender = page.render({ canvasContext: ctx, viewport });
    await pdfPreviewRender.promise;
  }

  async function renderPdfPreview(blob) {
    const lib = getPdfJs();
    const scroller = $('pdfCanvasScroller');
    const canvas = $('pdfCanvas');
    if (!lib || !setupPdfJsWorker() || !scroller || !canvas) return false;

    await destroyPdfPreview();

    if (pdfBlobUrl) {
      URL.revokeObjectURL(pdfBlobUrl);
      pdfBlobUrl = null;
    }

    pdfBlobUrl = URL.createObjectURL(blob);
    try {
      pdfPreviewDoc = await lib.getDocument(pdfBlobUrl).promise;
      const page = await pdfPreviewDoc.getPage(1);
      const total = pdfPreviewDoc.numPages;
      const info = $('pdfPageInfo');
      if (info) info.textContent = `1 de ${total}`;

      const rect = scroller.getBoundingClientRect();
      const pad = 14;
      const vp1 = page.getViewport({ scale: 1 });
      pdfPreviewFitScale = Math.min(
        (rect.width - pad) / vp1.width,
        (rect.height - pad) / vp1.height
      );
      if (!Number.isFinite(pdfPreviewFitScale) || pdfPreviewFitScale <= 0) {
        pdfPreviewFitScale = 0.85;
      }
      pdfPreviewScale = pdfPreviewFitScale;
      await paintPdfPage(page, canvas, pdfPreviewScale);
      scroller.scrollTop = 0;
      scroller.scrollLeft = 0;
      return true;
    } catch (err) {
      console.error('dronAGV PDF preview:', err);
      return false;
    }
  }

  async function pdfZoomBy(factor) {
    if (!pdfPreviewDoc) return;
    const page = await pdfPreviewDoc.getPage(1);
    pdfPreviewScale = Math.max(0.4, Math.min(2.8, pdfPreviewScale * factor));
    await paintPdfPage(page, $('pdfCanvas'), pdfPreviewScale);
  }

  async function pdfZoomFit() {
    if (!pdfPreviewDoc) return;
    const page = await pdfPreviewDoc.getPage(1);
    const scroller = $('pdfCanvasScroller');
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    const pad = 14;
    const vp1 = page.getViewport({ scale: 1 });
    pdfPreviewFitScale = Math.min(
      (rect.width - pad) / vp1.width,
      (rect.height - pad) / vp1.height
    );
    pdfPreviewScale = pdfPreviewFitScale;
    await paintPdfPage(page, $('pdfCanvas'), pdfPreviewScale);
    scroller.scrollTop = 0;
    scroller.scrollLeft = 0;
  }

  function revokePdfBlob() {
    destroyPdfPreview();
    if (pdfBlobUrl) {
      URL.revokeObjectURL(pdfBlobUrl);
      pdfBlobUrl = null;
    }
    pdfBlob = null;
  }

  const PDF = {
    green: [134, 239, 172],
    greenDark: [34, 197, 94],
    headBg: [12, 24, 36],
    ink: [15, 23, 42],
    muted: [100, 116, 139],
    measure: [220, 38, 38],
    plotFill: [236, 253, 245],
    plotStroke: [34, 197, 94],
  };

  function getJsPDF() {
    const j = window.jspdf;
    if (j?.jsPDF) return j.jsPDF;
    if (typeof window.jsPDF === 'function') return window.jsPDF;
    return null;
  }

  /** Helvetica PDF solo Latin-1; evita fallos con tildes y simbolos */
  function pdfSafe(str) {
    return String(str ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\u00B7/g, ' - ')
      .replace(/[\u2013\u2014]/g, '-');
  }

  function pdfFill(doc, rgb) {
    doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  }

  function pdfDraw(doc, rgb) {
    doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
  }

  function pdfTxt(doc, rgb) {
    doc.setTextColor(rgb[0], rgb[1], rgb[2]);
  }

  function drawPdfPageFrame(doc, fx, fy, fw, fh) {
    pdfDraw(doc, PDF.green);
    doc.setLineWidth(0.5);
    doc.roundedRect(fx, fy, fw, fh, 3, 3, 'S');
    pdfDraw(doc, PDF.greenDark);
    doc.setLineWidth(0.3);
    doc.roundedRect(fx + 1.5, fy + 1.5, fw - 3, fh - 3, 2, 2, 'S');
  }

  function pdfResetDash(doc) {
    if (typeof doc.setLineDashPattern === 'function') doc.setLineDashPattern([], 0);
  }

  function pdfDashLine(doc, x1, y1, x2, y2, rgb) {
    pdfDraw(doc, rgb);
    doc.setLineWidth(0.2);
    if (typeof doc.setLineDashPattern === 'function') {
      doc.setLineDashPattern([4, 2], 0);
    }
    doc.line(x1, y1, x2, y2);
    pdfResetDash(doc);
  }

  function drawPdfPlotPerimeter(doc, x, y, boxW, boxH, r, inset) {
    const route = r.routeMeters > 0 ? r.routeMeters : 100;
    const lateral = r.lateralMeters > 0 ? r.lateralMeters : 50;
    const ratio = Math.max(1.2, Math.min(3.8, route / lateral));
    const innerW = boxW - inset * 2;
    const innerH = boxH - inset * 2;
    let plotW = innerW * 0.9;
    let plotH = plotW / ratio;
    if (plotH > innerH * 0.78) {
      plotH = innerH * 0.78;
      plotW = plotH * ratio;
    }
    const px = x + (boxW - plotW) / 2;
    const py = y + (boxH - plotH) / 2;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    pdfTxt(doc, PDF.measure);
    doc.text(pdfSafe(`${formatES(route, 1)} m`), px + plotW / 2, py - 3, { align: 'center' });
    doc.setFontSize(9);
    doc.text(pdfSafe(`${formatES(lateral, 0)} m`), px - 4, py + plotH / 2, { align: 'right' });
    doc.text(pdfSafe(`${formatES(lateral, 0)} m`), px + plotW + 4, py + plotH / 2, { align: 'left' });

    pdfDraw(doc, PDF.plotStroke);
    doc.setLineWidth(0.95);
    pdfFill(doc, PDF.plotFill);
    doc.roundedRect(px, py, plotW, plotH, 1.5, 1.5, 'FD');

    [[0, 0], [plotW, 0], [plotW, plotH], [0, plotH]].forEach(([cxp, cyp]) => {
      doc.setFillColor(255, 255, 255);
      doc.circle(px + cxp, py + cyp, 1.8, 'F');
      pdfDraw(doc, PDF.plotStroke);
      doc.setLineWidth(0.55);
      doc.circle(px + cxp, py + cyp, 1.8, 'S');
    });

    const pathPad = 2;
    const rows = 8;
    const pathRgb = [74, 222, 128];
    for (let i = 0; i < rows; i++) {
      const ly = py + pathPad + (i / (rows - 1)) * (plotH - pathPad * 2);
      const xL = px + pathPad;
      const xR = px + plotW - pathPad;
      if (i % 2 === 0) pdfDashLine(doc, xL, ly, xR, ly, pathRgb);
      else pdfDashLine(doc, xR, ly, xL, ly, pathRgb);
    }

    return y + boxH;
  }

  function drawPdfKpiRow(doc, x, y, cw, r) {
    const blocks = [];
    if (r.hectares != null) {
      blocks.push({ label: 'AREA', value: pdfSafe(`${formatES(r.hectares, 2)} ha`) });
    }
    if (r.liters != null) {
      blocks.push({ label: 'LIQUIDO', value: pdfSafe(`${formatES(r.liters, 1)} L`) });
    }
    if (r.routeMeters != null) {
      blocks.push({ label: 'RUTA', value: pdfSafe(`${formatES(r.routeMeters, 1)} m`) });
    }
    if (!blocks.length) return y;

    const gap = 5;
    const n = blocks.length;
    const boxW = (cw - gap * (n - 1)) / n;
    const rowH = 13;

    blocks.forEach((b, i) => {
      const bx = x + i * (boxW + gap);
      pdfFill(doc, PDF.headBg);
      doc.roundedRect(bx, y, boxW, rowH, 1.5, 1.5, 'F');
      pdfFill(doc, PDF.greenDark);
      doc.rect(bx, y, boxW, 3, 'F');
      doc.setFontSize(6);
      doc.setTextColor(148, 163, 184);
      doc.text(b.label, bx + boxW / 2, y + 6, { align: 'center' });
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      pdfTxt(doc, PDF.green);
      doc.text(b.value, bx + boxW / 2, y + 10.5, { align: 'center' });
    });

    return y + rowH;
  }

  function drawPdfRtkEquipPanel(doc, bx, by, bw, bh, rtk) {
    const cx = bx + bw / 2;
    const pad = 6;
    const bottom = by + bh - pad;

    doc.setFillColor(236, 253, 245);
    pdfDraw(doc, PDF.green);
    doc.setLineWidth(0.45);
    doc.roundedRect(bx, by, bw, bh, 2, 2, 'FD');
    pdfFill(doc, PDF.greenDark);
    doc.rect(bx, by, bw, 3.5, 'F');

    let ty = by + pad + 3;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(100, 116, 139);
    doc.text('Vista del lote obtenida con', cx, ty, { align: 'center' });
    ty += 5.5;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(22, 163, 74);
    doc.text('EQUIPO / RTK', cx, ty, { align: 'center' });
    ty += 7.5;

    doc.setFontSize(17);
    pdfTxt(doc, PDF.ink);
    doc.text(pdfSafe(String(rtk)), cx, ty + 1, { align: 'center' });
    ty += 11;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.3);
    doc.setTextColor(100, 116, 139);
    const note = doc.splitTextToSize(
      'Perimetro y rutas de esta inspeccion segun el controlador indicado.',
      bw - pad * 2 - 2
    );
    const lineH = 2.5;
    let ny = ty + 2;
    note.forEach((line) => {
      if (ny + lineH > bottom) return;
      doc.text(line, cx, ny, { align: 'center' });
      ny += lineH;
    });
  }

  function drawPdfLotSection(doc, x, y, cw, r) {
    const plotBoxH = 46;
    const gap = 7;
    const hasRtk = !!r.rtk;
    const halfW = hasRtk ? (cw - gap) / 2 : cw;
    const plotZoneW = halfW;
    const equipW = halfW;
    const equipX = x + plotZoneW + gap;

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, y, plotZoneW, plotBoxH, 2, 2, 'FD');
    drawPdfPlotPerimeter(doc, x, y, plotZoneW, plotBoxH, r, 3);

    if (hasRtk) {
      drawPdfRtkEquipPanel(doc, equipX, y, equipW, plotBoxH, r.rtk);
    }

    return y + plotBoxH;
  }

  function drawPdfTelemetryTable(doc, x, startY, width, rows, cellPad) {
    const rowH = 7.5;
    const headH = 9;
    const tableTop = startY;
    let y = startY;
    const pad = cellPad;

    pdfFill(doc, PDF.green);
    pdfDraw(doc, PDF.greenDark);
    doc.setLineWidth(0.35);
    doc.rect(x, y, width, headH, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(5, 46, 22);
    doc.text('PARAMETRO', x + pad, y + 6);
    doc.text('VALOR', x + width - pad, y + 6, { align: 'right' });
    y += headH;

    rows.forEach((row, i) => {
      const bg = i % 2 === 0 ? [255, 255, 255] : [248, 250, 252];
      doc.setFillColor(bg[0], bg[1], bg[2]);
      doc.setDrawColor(226, 232, 240);
      doc.rect(x, y, width, rowH, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      pdfTxt(doc, PDF.muted);
      doc.text(doc.splitTextToSize(pdfSafe(row.label), width * 0.52), x + pad, y + 5.2);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      pdfTxt(doc, PDF.ink);
      doc.text(pdfSafe(row.value), x + width - pad, y + 5.4, { align: 'right' });
      y += rowH;
    });

    pdfDraw(doc, PDF.greenDark);
    doc.setLineWidth(0.45);
    doc.rect(x, tableTop, width, y - tableTop, 'S');
    return y + 6;
  }

  function buildInspectionPdfBlob(r) {
    const JsPDF = getJsPDF();
    if (!JsPDF) throw new Error('jsPDF no disponible');
    const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const PW = doc.internal.pageSize.getWidth();
    const PH = doc.internal.pageSize.getHeight();

    const PAGE_M = 16;
    const PAD = 14;
    const GAP = 9;
    const GAP_L = 11;
    const CELL_PAD = 10;
    const TXT = PAD;

    const FX = PAGE_M;
    const FY = PAGE_M;
    const FW = PW - PAGE_M * 2;
    const FH = PH - PAGE_M * 2;
    const X = FX + PAD;
    const CW = FW - PAD * 2;
    const FOOT_Y = FY + FH - 10;

    const generatedAt = new Date().toLocaleString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    drawPdfPageFrame(doc, FX, FY, FW, FH);

    let y = FY + PAD;

    const headH = 26;
    pdfFill(doc, PDF.headBg);
    doc.roundedRect(X, y, CW, headH, 2, 2, 'F');
    pdfFill(doc, PDF.green);
    doc.rect(X, y, CW, 4.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    pdfTxt(doc, PDF.green);
    doc.text('dronAGV', X + TXT, y + 15);
    doc.setFontSize(9);
    doc.setTextColor(248, 250, 252);
    doc.text('INFORME DE INSPECCION AGRICOLA', X + TXT, y + 21);
    doc.setFontSize(11);
    doc.setTextColor(248, 250, 252);
    doc.text(pdfSafe(formatDateLabel(r.date, r.time)), X + CW - TXT, y + 15, { align: 'right' });
    doc.setFontSize(8.5);
    doc.setTextColor(148, 163, 184);
    doc.text(pdfSafe(generatedAt), X + CW - TXT, y + 21, { align: 'right' });
    y += headH + GAP;

    y = drawPdfKpiRow(doc, X, y, CW, r);
    y += 7;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(22, 163, 74);
    doc.text('VISTA DEL LOTE - PERIMETRO', X + TXT, y + 2);
    y += 6;
    y = drawPdfLotSection(doc, X, y, CW, r);
    y += 8;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(22, 163, 74);
    doc.text('TELEMETRIA COMPLETA', X + TXT, y + 2);
    y += 8;

    const tableRows = NUM_FIELDS.filter((f) => r[f.key] != null).map((f) => ({
      label: pdfSafe(`${f.label} (${f.unit})`),
      value: pdfSafe(formatES(r[f.key], f.dec)),
    }));

    if (tableRows.length) {
      y = drawPdfTelemetryTable(doc, X, y, CW, tableRows, CELL_PAD);
    }

    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    pdfTxt(doc, PDF.muted);
    doc.text(
      'dronAGV - Telemetria controlador agricola - Documento generado automaticamente',
      PW / 2,
      FOOT_Y,
      { align: 'center' }
    );

    return doc.output('blob');
  }

  async function openPdfModal(r) {
    if (!getJsPDF()) {
      if (window.DronNetwork) window.DronNetwork.requireLib(['pdf'], 'generar PDF');
      else {
        await swalWarn('PDF no disponible', 'No se cargo la libreria PDF local.');
      }
      return;
    }
    pdfRecord = r;
    revokePdfBlob();
    try {
      pdfBlob = buildInspectionPdfBlob(r);
      if (!pdfBlob || !(pdfBlob instanceof Blob)) {
        throw new Error('PDF vacio');
      }
    } catch (err) {
      console.error('dronAGV PDF:', err);
      await swalWarn('Error', 'No se pudo crear el PDF. Recarga la pagina e intenta de nuevo.');
      return;
    }
    const title = $('pdfModalTitle');
    const sub = $('pdfModalSubtitle');
    if (title) title.textContent = formatDateLabel(r.date, r.time);
    if (sub) sub.textContent = r.rtk || 'Controlador agrícola';
    const modal = $('pdfModal');
    modal?.classList.add('open');
    modal?.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const ok = await renderPdfPreview(pdfBlob);
    if (!ok) {
      await swalWarn('Vista PDF', 'No se pudo mostrar la vista previa. Puedes descargar el PDF igualmente.');
    }
  }

  function closePdfModal() {
    const modal = $('pdfModal');
    modal?.classList.remove('open');
    modal?.setAttribute('aria-hidden', 'true');
    if (!$('detailModal')?.classList.contains('open')) {
      document.body.style.overflow = '';
    }
    pdfRecord = null;
    revokePdfBlob();
  }

  function downloadInspectionPdf() {
    if (!pdfBlob || !pdfRecord) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(pdfBlob);
    a.download = pdfFilename(pdfRecord);
    a.click();
    URL.revokeObjectURL(a.href);
    swalToast('PDF descargado', 'success');
  }

  async function shareInspectionWhatsApp() {
    if (!pdfBlob || !pdfRecord) return;
    if (window.DronNetwork && !window.DronNetwork.requireOnline('enviar por WhatsApp')) return;
    const file = new File([pdfBlob], pdfFilename(pdfRecord), {
      type: 'application/pdf',
    });
    const shareData = {
      title: `Inspección dronAGV ${formatDateLabel(pdfRecord.date, pdfRecord.time)}`,
      text: `Inspección dronAGV · ${formatDateLabel(pdfRecord.date, pdfRecord.time)}`,
      files: [file],
    };
    try {
      if (navigator.share && navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
        swalToast('PDF listo para enviar');
        return;
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
    downloadInspectionPdf();
    await swalInfo(
      'Enviar PDF por WhatsApp',
      'En este dispositivo abre WhatsApp, adjunta el PDF que acabas de descargar y envíalo. En móvil suele funcionar el botón Enviar PDF directo.'
    );
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
    saveSession();
    window.DronSounds?.play('page');
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
      const chip = document.createElement('div');
      chip.className = 'inspect-chip';
      if (r.id === highlightId) chip.style.animationDelay = '0s';
      chip.dataset.id = r.id;

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'inspect-chip-open';
      openBtn.innerHTML = `
        <span class="chip-icon" aria-hidden="true"></span>
        <span class="chip-body">
          <p class="chip-title">${escapeHtml(formatDateLabel(r.date, r.time))}</p>
          <p class="chip-meta">${escapeHtml(r.rtk || 'RTK')}</p>
          <p class="chip-preview">${escapeHtml(chipPreview(r))}</p>
        </span>
        <span class="chip-arrow" aria-hidden="true">›</span>
      `;
      openBtn.addEventListener('click', () => openModal(r));

      const pdfBtn = document.createElement('button');
      pdfBtn.type = 'button';
      pdfBtn.className = 'chip-pdf-btn';
      pdfBtn.setAttribute('aria-label', 'Ver PDF de inspección');
      pdfBtn.textContent = 'PDF';
      pdfBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openPdfModal(r);
      });

      chip.appendChild(openBtn);
      chip.appendChild(pdfBtn);
      list.appendChild(chip);
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
    window.DronSounds?.play('save');
    swalToast('Inspección guardada', 'success', { sound: false });
    saveSession();
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
    if (window.DronNetwork && !window.DronNetwork.requireLib(['xlsx'], 'exportar Excel')) {
      return;
    }
    if (typeof XLSX === 'undefined' || !XLSX.utils?.book_new) {
      await swalWarn(
        'Excel no disponible',
        'No se cargo xlsx.bundle.js desde vendor/. Recarga la pagina.'
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

  function initPdfModal() {
    document.querySelectorAll('[data-pdf-close]').forEach((el) => {
      el.addEventListener('click', closePdfModal);
    });
    $('pdfBtnDownload')?.addEventListener('click', downloadInspectionPdf);
    $('pdfBtnWhatsApp')?.addEventListener('click', shareInspectionWhatsApp);
    $('pdfZoomIn')?.addEventListener('click', () => pdfZoomBy(1.18));
    $('pdfZoomOut')?.addEventListener('click', () => pdfZoomBy(1 / 1.18));
    $('pdfZoomFit')?.addEventListener('click', () => pdfZoomFit());
    let resizeTimer;
    window.addEventListener('resize', () => {
      if (!$('pdfModal')?.classList.contains('open')) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => pdfZoomFit(), 180);
    });
  }

  function initModal() {
    document.querySelectorAll('#detailModal [data-close]').forEach((el) => {
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
      if (e.key !== 'Escape') return;
      if ($('pdfModal')?.classList.contains('open')) closePdfModal();
      else if ($('detailModal')?.classList.contains('open')) closeModal();
    });
  }

  function startApp() {
    loadStorage();
    restoreSession();
    updateHud();
    updateDailySummary();
    renderRecords();
    initModal();
    initPdfModal();
    initRecordsPagination();

    $('inspectForm')?.addEventListener('submit', onSubmit);
    $('btnClear')?.addEventListener('click', clearForm);
    $('btnExport')?.addEventListener('click', exportExcel);
    $('btnReset')?.addEventListener('click', resetDay);
    Object.values(inp).forEach((el) => {
      el?.addEventListener('input', scheduleHudUpdate, { passive: true });
      el?.addEventListener('input', saveSession, { passive: true });
    });
    let scrollSaveTimer;
    window.addEventListener(
      'scroll',
      () => {
        clearTimeout(scrollSaveTimer);
        scrollSaveTimer = setTimeout(saveSession, 200);
      },
      { passive: true }
    );
    window.addEventListener('pagehide', saveSession);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) saveSession();
      else if (patrolActive) requestAnimationFrame(animateDronePatrol);
    });
    document.addEventListener(
      'click',
      (e) => {
        window.DronSounds?.unlock();
        const t = e.target;
        if (
          t.closest?.('.btn-main, .btn-chip, .chip-pdf-btn, .inspect-chip-open, .page-btn, .page-num')
        ) {
          window.DronSounds?.play('click');
        }
      },
      { passive: true }
    );
    startDronePatrol();
    saveSession();
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
