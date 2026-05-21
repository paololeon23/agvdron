/**
 * dronAGV — Red / WiFi / modo offline (librerias locales en vendor/)
 */
(function () {
  const listeners = new Set();
  let online = navigator.onLine;

  function hasJsPDF() {
    return !!(window.jspdf?.jsPDF || typeof window.jsPDF === 'function');
  }

  function notify() {
    listeners.forEach((fn) => {
      try {
        fn(online);
      } catch {
        /* ignore */
      }
    });
    updateUi();
  }

  function setOnline(value) {
    if (online === value) return;
    online = value;
    notify();
    if (online) window.DronSounds?.play('online');
    else window.DronSounds?.play('offline');
  }

  function updateUi() {
    const banner = document.getElementById('networkBanner');
    const text = document.getElementById('networkBannerText');
    const pill = document.getElementById('networkStatus');
    const dot = document.getElementById('networkStatusDot');

    if (banner) {
      banner.hidden = online;
      banner.classList.toggle('is-offline', !online);
    }
    document.body.classList.toggle('has-offline-banner', !online);
    if (text) {
      text.textContent = online
        ? ''
        : 'Sin conexion - modo local activo. Tus inspecciones se guardan en el dispositivo.';
    }
    if (pill) {
      pill.classList.toggle('is-online', online);
      pill.classList.toggle('is-offline', !online);
      pill.setAttribute('aria-label', online ? 'Conectado' : 'Sin conexion, modo local');
    }
    if (dot) dot.setAttribute('aria-hidden', online ? 'false' : 'true');
    const label = document.getElementById('networkStatusLabel');
    if (label) label.textContent = online ? 'EN LINEA' : 'MODO LOCAL';
  }

  function refreshStatus() {
    setOnline(navigator.onLine);
    return online;
  }

  function libsReady() {
    return {
      swal: typeof window.Swal !== 'undefined',
      xlsx: typeof window.XLSX !== 'undefined' && !!window.XLSX?.utils?.book_new,
      pdf: hasJsPDF(),
    };
  }

  function missingLibs() {
    return Object.entries(libsReady())
      .filter(([, ok]) => !ok)
      .map(([k]) => k);
  }

  function onStatusChange(cb) {
    listeners.add(cb);
    cb(online);
    return () => listeners.delete(cb);
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./service-worker.js', { scope: './' })
        .catch(() => {});
    });
  }

  window.addEventListener('online', () => refreshStatus());
  window.addEventListener('offline', () => setOnline(false));

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshStatus();
  });

  window.DronNetwork = {
    isOnline: () => online,
    onStatusChange,
    refreshStatus,
    libsReady,
    missingLibs,
    requireLib(which, featureLabel) {
      const need = Array.isArray(which) ? which : [which];
      const missing = missingLibs().filter((k) => need.includes(k));
      if (!missing.length) return true;
      const msg = `No se encontro ${missing.join(', ')} en vendor/. Recarga la pagina.`;
      if (typeof window.Swal !== 'undefined') {
        window.Swal.fire({
          icon: 'warning',
          title: 'Libreria no lista',
          text: `${featureLabel}: ${msg}`,
          confirmButtonText: 'Entendido',
          background: '#0c1824',
          color: '#f4f7fb',
          confirmButtonColor: '#22c55e',
        });
      } else {
        alert(msg);
      }
      window.DronSounds?.play('error');
      return false;
    },
    requireOnline(featureLabel) {
      if (online) return true;
      const msg = `No hay conexion. No se puede ${featureLabel} sin WiFi o datos.`;
      if (typeof window.Swal !== 'undefined') {
        window.Swal.fire({
          icon: 'warning',
          title: 'Sin conexion',
          text: msg,
          confirmButtonText: 'Entendido',
          background: '#0c1824',
          color: '#f4f7fb',
          confirmButtonColor: '#22c55e',
        });
      } else {
        alert(msg);
      }
      window.DronSounds?.play('error');
      return false;
    },
  };

  registerServiceWorker();
  updateUi();
  refreshStatus();

  window.addEventListener('load', () => {
    const miss = missingLibs();
    if (miss.length) console.warn('dronAGV: faltan librerias locales:', miss.join(', '));
  });
})();
