// Bhoomi means earth: a round earth cut into soil layers like a lino print, breathing slowly.
// Draws one still frame under reduced motion, stops off screen, and has a pause button.
(() => {
  const box = document.querySelector('.earth');
  const canvas = box && box.querySelector('canvas');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const btn = box.querySelector('.earth-toggle');
  const css = getComputedStyle(document.documentElement);
  const tok = (n) => css.getPropertyValue(n).trim();
  const INK = tok('--color-ink'), PAPER = tok('--color-paper-2');
  // Top to bottom: sage topsoil, moss, copper clay, loam, deep clay, moss, pale bedrock
  const BANDS = [tok('--color-ink-2'), tok('--color-muted'), tok('--color-accent'), tok('--color-rule-2'), tok('--color-accent-2'), tok('--color-muted'), INK];
  const BREATH = 9; // seconds per breath

  const rnd = (i, k) => { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
  const wave = (x, t, s) => Math.sin(x * 1.7 + t + s) * 0.5 + Math.sin(x * 3.1 - t * 0.7 + s * 2) * 0.3 + Math.sin(x * 5.3 + t * 0.4 + s * 3) * 0.2;

  let size = 0, t = 0, running = false, paused = false, last = 0, visible = true;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    size = canvas.clientWidth;
    canvas.width = canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function draw() {
    if (!size) return;
    ctx.clearRect(0, 0, size, size);
    const breath = Math.sin((t / BREATH) * Math.PI * 2); // -1..1
    const cx = size / 2, cy = size / 2, R = size * 0.42 * (1 + breath * 0.012);
    const drift = t * 0.18, swell = 1 + breath * 0.25; // layers rise and settle with the breath

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    for (let b = 0; b < BANDS.length; b++) {
      const top = cy - R + (2 * R * b) / BANDS.length;
      ctx.globalAlpha = 0.88; ctx.fillStyle = BANDS[b]; ctx.beginPath();
      for (let i = 0; i <= 64; i++) {
        const x = cx - R + (2 * R * i) / 64;
        const y = b ? top + wave(i / 9, drift, b) * size * 0.022 * swell : top - size;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.lineTo(cx + R, cy + R); ctx.lineTo(cx - R, cy + R); ctx.closePath(); ctx.fill();
    }
    // Grain: flecks where the ink did not take, fixed to the print
    ctx.fillStyle = PAPER; ctx.globalAlpha = 0.5;
    for (let i = 0; i < 1100; i++) ctx.fillRect(cx - R + rnd(i, 1) * 2 * R, cy - R + rnd(i, 2) * 2 * R, 1 + rnd(i, 3) * 1.5, 1);
    ctx.restore();

    // Outline drawn twice, like a pen going round
    for (const [ph, al] of [[0, 0.95], [2.4, 0.35]]) {
      ctx.globalAlpha = al; ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let i = 0; i <= 128; i++) {
        const a = (i / 128) * Math.PI * 2, rr = R + 2 + Math.sin(a * 4 + ph) * 1.5;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    if (!running) return;
    if (last) t += Math.min((now - last) / 1000, 0.1);
    last = now;
    draw();
    requestAnimationFrame(frame);
  }
  function update() {
    const should = !paused && visible && !reduce.matches && !document.hidden;
    if (should && !running) { running = true; last = 0; requestAnimationFrame(frame); }
    if (!should) running = false;
    btn.hidden = reduce.matches;
  }

  btn.addEventListener('click', () => {
    paused = !paused;
    btn.setAttribute('aria-pressed', String(paused));
    btn.textContent = paused ? 'Play' : 'Pause';
    update();
  });
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; update(); }).observe(canvas);
  new ResizeObserver(resize).observe(canvas);
  reduce.addEventListener('change', () => { update(); draw(); });
  document.addEventListener('visibilitychange', update);
  update();
})();
