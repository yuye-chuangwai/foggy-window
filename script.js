(() => {
  'use strict';

  const canvas = document.getElementById('glass');
  const ctx = canvas.getContext('2d');
  const fadeEl = document.getElementById('fade');
  const hintEl = document.getElementById('hint');
  const inner = document.querySelector('.window-inner');

  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, H = 0;

  const SCENE_IMG = { dusk: 'city-dusk.jpg', night: 'city-night.jpg' };
  const images = { dusk: null, night: null };

  let scene = 'dusk';
  let raining = false;

  let fogC, fogX, maskC, maskX, hazeC, hazeX;

  const droplets = [];
  const rain = [];
  const trail = [];
  const MAX_DROPLETS = 60;
  const BRUSH = 30;
  const REFOG = 0.00055;
  const FILTER_OK = 'filter' in ctx;

  let drawing = false;
  let lastPt = null;
  let pointerIn = false;
  let pointerPos = { x: 0, y: 0 };
  let lastT = 0;
  let lastGlassDrop = 0;
  let lastDrawDrop = 0;
  let hintHidden = false;

  /* ---------- 基础工具 ---------- */

  function makeLayer() {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W * DPR));
    c.height = Math.max(1, Math.round(H * DPR));
    const x = c.getContext('2d');
    x.setTransform(DPR, 0, 0, DPR, 0, 0);
    return [c, x];
  }

  function drawCover(c, img, blur) {
    const ir = img.width / img.height, r = W / H;
    let dw, dh;
    if (ir > r) { dh = H; dw = H * ir; } else { dw = W; dh = W / ir; }
    const dx = (W - dw) / 2, dy = (H - dh) / 2;
    if (blur && FILTER_OK) {
      c.save();
      c.filter = `blur(${blur}px)`;
      const m = blur * 2;
      c.drawImage(img, dx - m, dy - m, dw + m * 2, dh + m * 2);
      c.restore();
    } else if (blur) {
      c.save();
      c.globalAlpha = 0.12;
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        c.drawImage(img, dx + Math.cos(a) * 7, dy + Math.sin(a) * 7, dw, dh);
      }
      c.restore();
    } else {
      c.drawImage(img, dx, dy, dw, dh);
    }
  }

  /* ---------- 雾（透一点，能看到后面的城市） ---------- */

  function buildHaze() {
    [hazeC, hazeX] = makeLayer();
    // 半透明的水汽层，让后面模糊的城市透出来
    hazeX.fillStyle = 'rgba(200,210,218,0.50)';
    hazeX.fillRect(0, 0, W, H);
    // 不均匀的水汽斑块
    for (let i = 0; i < 200; i++) {
      const x = Math.random() * W, y = Math.random() * H;
      const r = 20 + Math.random() * 80;
      const g = hazeX.createRadialGradient(x, y, 0, x, y, r);
      if (Math.random() < 0.5) {
        g.addColorStop(0, `rgba(255,255,255,${0.02 + Math.random() * 0.05})`);
      } else {
        g.addColorStop(0, `rgba(170,185,198,${0.02 + Math.random() * 0.05})`);
      }
      g.addColorStop(1, 'rgba(255,255,255,0)');
      hazeX.fillStyle = g;
      hazeX.beginPath(); hazeX.arc(x, y, r, 0, Math.PI * 2); hazeX.fill();
    }
    // 底部略浓一点
    const vg = hazeX.createLinearGradient(0, 0, 0, H);
    vg.addColorStop(0, 'rgba(220,228,235,0)');
    vg.addColorStop(1, 'rgba(220,228,235,0.22)');
    hazeX.fillStyle = vg;
    hazeX.fillRect(0, 0, W, H);
  }

  function buildFog() {
    [fogC, fogX] = makeLayer();
    fogX.fillStyle = '#14181f';
    fogX.fillRect(0, 0, W, H);
    drawCover(fogX, images[scene], 14);
    fogX.drawImage(hazeC, 0, 0, W, H);
    applyMask();
  }

  function applyMask() {
    fogX.save();
    fogX.globalCompositeOperation = 'destination-out';
    fogX.drawImage(maskC, 0, 0, W, H);
    fogX.restore();
  }

  function eraseAt(x, y, r, alpha) {
    fogX.save();
    fogX.globalCompositeOperation = 'destination-out';
    let g = fogX.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${alpha})`);
    g.addColorStop(0.72, `rgba(0,0,0,${alpha * 0.85})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    fogX.fillStyle = g;
    fogX.beginPath(); fogX.arc(x, y, r, 0, Math.PI * 2); fogX.fill();
    fogX.restore();

    maskX.save();
    g = maskX.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${alpha})`);
    g.addColorStop(0.72, `rgba(255,255,255,${alpha * 0.85})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    maskX.fillStyle = g;
    maskX.beginPath(); maskX.arc(x, y, r, 0, Math.PI * 2); maskX.fill();
    maskX.restore();
  }

  function refog() {
    fogX.save();
    fogX.globalAlpha = REFOG;
    fogX.drawImage(hazeC, 0, 0, W, H);
    fogX.restore();
    maskX.save();
    maskX.globalCompositeOperation = 'destination-out';
    maskX.globalAlpha = REFOG;
    maskX.fillStyle = '#fff';
    maskX.fillRect(0, 0, W, H);
    maskX.restore();
  }

  /* ---------- 水珠（偶尔才有一滴） ---------- */

  function spawnDrop(x, y, r) {
    if (droplets.length >= MAX_DROPLETS) return;
    droplets.push({
      x, y,
      r: r || (0.9 + Math.random() * 1.8),
      vy: 0,
      seed: Math.random() * 100,
      stick: 0
    });
  }

  function stepDroplets(dt) {
    for (let i = droplets.length - 1; i >= 0; i--) {
      const d = droplets[i];
      if (d.stick > 0) {
        d.stick -= dt;
      } else {
        d.vy = Math.min(d.vy + 320 * dt * (d.r / 3), 80 + d.r * 40);
        d.y += d.vy * dt;
        d.x += Math.sin(d.y * 0.09 + d.seed) * 10 * dt;
        // 很淡很细的水痕，不是把雾完全擦掉
        eraseAt(d.x, d.y, d.r * 0.55, 0.12);
        if (Math.random() < dt * 0.8) d.stick = 0.2 + Math.random() * 0.6;
        d.r *= (1 - 0.02 * dt);
      }
      if (d.y > H + 10 || d.r < 0.45) droplets.splice(i, 1);
    }
  }

  function drawDroplet(d) {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.scale(0.92, 1.22);
    const g = ctx.createRadialGradient(-d.r * 0.35, -d.r * 0.45, d.r * 0.08, 0, 0, d.r);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.35, 'rgba(225,236,245,0.32)');
    g.addColorStop(1, 'rgba(150,170,190,0.26)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, d.r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // 画完后，边缘偶尔凝出一滴水
  function weep(now) {
    for (let i = trail.length - 1; i >= 0; i--) {
      const p = trail[i];
      if (now - p.t > 2500) { trail.splice(i, 1); continue; }
      if (Math.random() < 0.0004) {
        spawnDrop(p.x + (Math.random() - 0.5) * BRUSH * 0.6, p.y + BRUSH * (0.9 + Math.random() * 0.2));
      }
    }
  }

  /* ---------- 雨 ---------- */

  function stepRain(dt) {
    const want = Math.min(240, Math.floor(W * H / 7000));
    if (rain.length < want && Math.random() < 0.85) {
      for (let k = 0; k < 2; k++) {
        rain.push({
          x: Math.random() * (W + 120) - 60,
          y: -30,
          len: 10 + Math.random() * 16,
          sp: 580 + Math.random() * 480
        });
      }
    }
    for (let i = rain.length - 1; i >= 0; i--) {
      const r = rain[i];
      r.y += r.sp * dt;
      r.x += r.sp * 0.1 * dt;
      if (r.y > H + 30) rain.splice(i, 1);
    }
  }

  function drawRain(alpha) {
    ctx.save();
    ctx.strokeStyle = `rgba(185,205,225,${alpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const r of rain) {
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x - r.len * 0.1, r.y - r.len);
    }
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- 交互 ---------- */

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function hideHint() {
    if (!hintHidden) { hintHidden = true; hintEl.classList.add('hide'); }
  }

  canvas.addEventListener('pointerdown', e => {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    lastPt = p;
    eraseAt(p.x, p.y, BRUSH, 0.95);
    trail.push({ x: p.x, y: p.y, t: performance.now() });
    hideHint();
  });

  canvas.addEventListener('pointermove', e => {
    const p = pos(e);
    pointerPos = p;
    if (!drawing) return;
    const dx = p.x - lastPt.x, dy = p.y - lastPt.y;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.floor(dist / (BRUSH * 0.32)));
    for (let i = 1; i <= steps; i++) {
      const x = lastPt.x + dx * i / steps;
      const y = lastPt.y + dy * i / steps;
      eraseAt(x, y, BRUSH, 0.9);
      trail.push({ x, y, t: performance.now() });
    }
    if (trail.length > 120) trail.splice(0, trail.length - 120);

    // 画画时只偶尔凝出一滴水，不是一直流
    const now = performance.now();
    if (now - lastDrawDrop > 90 && Math.random() < 0.25) {
      lastDrawDrop = now;
      spawnDrop(p.x + (Math.random() - 0.5) * BRUSH * 0.6, p.y + BRUSH * (0.85 + Math.random() * 0.3));
    }
    lastPt = p;
  });

  const stop = () => { drawing = false; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('pointerenter', () => { pointerIn = true; });
  canvas.addEventListener('pointerleave', () => { pointerIn = false; stop(); });

  /* ---------- 主循环 ---------- */

  function frame(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
    lastT = t;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    drawCover(ctx, images[scene], 0);

    if (raining) {
      stepRain(dt);
      drawRain(0.3);
      if (t - lastGlassDrop > 700) {
        lastGlassDrop = t;
        spawnDrop(Math.random() * W, Math.random() * H * 0.5);
      }
    }

    refog();
    ctx.drawImage(fogC, 0, 0, W, H);
    if (raining) drawRain(0.05);

    weep(t);
    stepDroplets(dt);
    for (const d of droplets) drawDroplet(d);

    if (pointerIn && !drawing) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(pointerPos.x, pointerPos.y, BRUSH * 0.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    requestAnimationFrame(frame);
  }

  /* ---------- 控制 ---------- */

  function bindSeg(id, fn) {
    const seg = document.getElementById(id);
    seg.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn || btn.classList.contains('on')) return;
      seg.querySelectorAll('button').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      fn(btn.dataset.v);
    });
  }

  bindSeg('sceneSeg', v => {
    scene = v;
    fadeEl.classList.add('show');
    setTimeout(() => { buildFog(); fadeEl.classList.remove('show'); }, 300);
  });

  bindSeg('rainSeg', v => {
    raining = (v === 'rain');
    if (!raining) rain.length = 0;
  });

  document.getElementById('reset').addEventListener('click', () => {
    fadeEl.classList.add('show');
    setTimeout(() => {
      maskX.clearRect(0, 0, W, H);
      buildFog();
      droplets.length = 0;
      trail.length = 0;
      fadeEl.classList.remove('show');
    }, 300);
  });

  /* ---------- 尺寸 ---------- */

  function resize() {
    const r = inner.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildHaze();
    [maskC, maskX] = makeLayer();
    buildFog();
    droplets.length = 0;
    trail.length = 0;
    rain.length = 0;
  }

  let rsTimer;
  window.addEventListener('resize', () => {
    clearTimeout(rsTimer);
    rsTimer = setTimeout(resize, 220);
  });

  /* ---------- 启动 ---------- */

  function loadImg(src) {
    return new Promise(res => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => res(null);
      i.src = src;
    });
  }

  function fallbackCity(kind) {
    const c = document.createElement('canvas');
    c.width = 1600; c.height = 900;
    const g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 900);
    if (kind === 'dusk') {
      sky.addColorStop(0, '#4a3a63'); sky.addColorStop(0.5, '#c0716a');
      sky.addColorStop(0.8, '#f2a35e'); sky.addColorStop(1, '#f7c887');
    } else {
      sky.addColorStop(0, '#05070f'); sky.addColorStop(0.65, '#0c142e');
      sky.addColorStop(1, '#1b2c50');
    }
    g.fillStyle = sky; g.fillRect(0, 0, 1600, 900);
    if (kind === 'dusk') {
      const s = g.createRadialGradient(1050, 620, 10, 1050, 620, 420);
      s.addColorStop(0, 'rgba(255,216,150,0.85)');
      s.addColorStop(1, 'rgba(255,216,150,0)');
      g.fillStyle = s; g.fillRect(0, 0, 1600, 900);
    }
    const base = 900;
    const cols = kind === 'dusk' ? ['#5c4460', '#443252', '#2c2140'] : ['#0d1730', '#091122', '#050b1a'];
    const winP = kind === 'dusk' ? [0.04, 0.09, 0.16] : [0.10, 0.2, 0.3];
    for (let l = 0; l < 3; l++) {
      let x = -30;
      while (x < 1630) {
        const bw = 50 + Math.random() * 130;
        const bh = 90 + Math.random() * (300 - l * 60) + l * 60;
        g.fillStyle = cols[l];
        g.fillRect(x, base - bh, bw, bh);
        for (let wy = base - bh + 12; wy < base - 14; wy += 16) {
          for (let wx = x + 8; wx < x + bw - 8; wx += 14) {
            if (Math.random() < winP[l]) {
              g.fillStyle = `rgba(255,${185 + Math.random() * 40 | 0},110,${0.5 + Math.random() * 0.5})`;
              g.fillRect(wx, wy, 5, 7);
            }
          }
        }
        x += bw + 4 + Math.random() * 26;
      }
    }
    return c;
  }

  Promise.all([loadImg(SCENE_IMG.dusk), loadImg(SCENE_IMG.night)]).then(([a, b]) => {
    images.dusk = a || fallbackCity('dusk');
    images.night = b || fallbackCity('night');
    resize();
    requestAnimationFrame(frame);
  });
})();
