/**
 * dronAGV — Sonidos agroindustriales (Web Audio, sin archivos externos)
 */
(function () {
  let ctx = null;
  let enabled = true;
  let unlocked = false;

  function getCtx() {
    if (!ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
    }
    return ctx;
  }

  function unlock() {
    const ac = getCtx();
    if (!ac || unlocked) return;
    if (ac.state === 'suspended') ac.resume();
    const o = ac.createOscillator();
    const g = ac.createGain();
    g.gain.value = 0.0001;
    o.connect(g);
    g.connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + 0.02);
    unlocked = true;
  }

  function tone(freq, dur, type, vol, when, ramp) {
    const ac = getCtx();
    if (!ac || !enabled) return;
    const t0 = when ?? ac.currentTime;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    if (ramp) g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    else g.gain.setValueAtTime(vol * 0.4, t0 + dur * 0.6);
    o.connect(g);
    g.connect(ac.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function noiseBurst(dur, vol) {
    const ac = getCtx();
    if (!ac || !enabled) return;
    const len = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const g = ac.createGain();
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(ac.destination);
    src.start();
  }

  const PRESETS = {
    tap() {
      tone(520, 0.06, 'triangle', 0.12, null, true);
    },
    click() {
      tone(380, 0.05, 'square', 0.08, null, true);
    },
    save() {
      const ac = getCtx();
      if (!ac) return;
      const t = ac.currentTime;
      tone(196, 0.12, 'sine', 0.18, t, true);
      tone(262, 0.12, 'sine', 0.16, t + 0.1, true);
      tone(330, 0.18, 'sine', 0.2, t + 0.2, true);
      tone(392, 0.22, 'triangle', 0.14, t + 0.34, true);
    },
    success() {
      const ac = getCtx();
      if (!ac) return;
      const t = ac.currentTime;
      tone(440, 0.1, 'sine', 0.14, t, true);
      tone(554, 0.14, 'sine', 0.16, t + 0.08, true);
    },
    warning() {
      tone(180, 0.2, 'sawtooth', 0.1, null, true);
      tone(140, 0.25, 'sawtooth', 0.08, null, true);
    },
    error() {
      tone(120, 0.35, 'square', 0.12, null, true);
      noiseBurst(0.08, 0.06);
    },
    online() {
      const ac = getCtx();
      if (!ac) return;
      const t = ac.currentTime;
      tone(330, 0.1, 'sine', 0.15, t, true);
      tone(440, 0.1, 'sine', 0.15, t + 0.09, true);
      tone(554, 0.16, 'sine', 0.18, t + 0.18, true);
    },
    offline() {
      tone(220, 0.22, 'triangle', 0.12, null, true);
      tone(165, 0.28, 'triangle', 0.1, null, true);
    },
    drone() {
      tone(90, 0.4, 'sine', 0.06, null, true);
      noiseBurst(0.15, 0.04);
    },
    page() {
      tone(300, 0.07, 'triangle', 0.1, null, true);
    },
  };

  function play(name) {
    unlock();
    const fn = PRESETS[name];
    if (fn) fn();
  }

  window.DronSounds = {
    play,
    unlock,
    setEnabled(v) {
      enabled = !!v;
      try {
        localStorage.setItem('dronAGV_sounds', enabled ? '1' : '0');
      } catch {
        /* ignore */
      }
    },
    isEnabled() {
      return enabled;
    },
  };

  try {
    const s = localStorage.getItem('dronAGV_sounds');
    if (s === '0') enabled = false;
  } catch {
    /* ignore */
  }

  ['click', 'touchstart', 'keydown'].forEach((ev) => {
    document.addEventListener(ev, unlock, { once: true, passive: true });
  });
})();
