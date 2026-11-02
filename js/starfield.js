/**
 * Céu estrelado de fundo: estrelas que cintilam, leve paralaxe ao rolar
 * e uma estrela cadente de vez em quando.
 */
(function () {
  "use strict";

  const canvas = document.getElementById("starfield");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const COLORS = ["244,233,247", "226,169,241", "218,196,224", "255,255,255"];
  let stars = [];
  let shooting = null;
  let nextShootAt = performance.now() + 4000;
  let w = 0, h = 0, dpr = 1;
  let scrollY = window.scrollY;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const count = Math.round(Math.min(220, (w * h) / 6500));
    stars = Array.from({ length: count }, () => {
      const depth = Math.random();
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.3 + depth * 1.3,
        depth,                                   // estrelas "próximas" se movem mais
        color: COLORS[(Math.random() * COLORS.length) | 0],
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 1.6,
        sparkle: depth > 0.93,                   // algumas viram estrelinhas de 4 pontas
      };
    });
    if (reduced) draw(0);
  }

  function drawSparkle(x, y, size, alpha, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = `rgba(${color},${alpha})`;
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.quadraticCurveTo(0, 0, size, 0);
    ctx.quadraticCurveTo(0, 0, 0, size);
    ctx.quadraticCurveTo(0, 0, -size, 0);
    ctx.quadraticCurveTo(0, 0, 0, -size);
    ctx.fill();
    ctx.restore();
  }

  function spawnShootingStar() {
    const fromLeft = Math.random() < 0.5;
    shooting = {
      x: fromLeft ? Math.random() * w * 0.5 : w * 0.5 + Math.random() * w * 0.5,
      y: Math.random() * h * 0.4,
      vx: (fromLeft ? 1 : -1) * (7 + Math.random() * 4),
      vy: 3 + Math.random() * 2,
      life: 0,
      max: 55 + Math.random() * 25,
    };
  }

  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    const time = t / 1000;

    for (const s of stars) {
      const tw = reduced ? 0.8 : 0.55 + 0.45 * Math.sin(time * s.speed + s.phase);
      // paralaxe: quanto mais "perto", mais a estrela acompanha a rolagem
      let y = (s.y - scrollY * (0.03 + s.depth * 0.12)) % h;
      if (y < 0) y += h;

      if (s.sparkle) {
        drawSparkle(s.x, y, s.r * 3.4 * (0.8 + tw * 0.4), tw, s.color);
      } else {
        ctx.beginPath();
        ctx.arc(s.x, y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${s.color},${tw * (0.35 + s.depth * 0.6)})`;
        ctx.fill();
      }
    }

    if (shooting) {
      const p = shooting;
      p.x += p.vx;
      p.y += p.vy;
      p.life++;
      const fade = Math.sin((p.life / p.max) * Math.PI);
      const tail = 14;
      const grad = ctx.createLinearGradient(p.x, p.y, p.x - p.vx * tail, p.y - p.vy * tail);
      grad.addColorStop(0, `rgba(244,233,247,${fade})`);
      grad.addColorStop(1, "rgba(226,169,241,0)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * tail, p.y - p.vy * tail);
      ctx.stroke();
      if (p.life >= p.max) shooting = null;
    } else if (!reduced && t > nextShootAt) {
      spawnShootingStar();
      nextShootAt = t + 7000 + Math.random() * 9000;
    }
  }

  let raf = 0;
  function loop(t) {
    draw(t);
    raf = requestAnimationFrame(loop);
  }

  window.addEventListener("resize", resize);
  window.addEventListener("scroll", () => {
    scrollY = window.scrollY;
    if (reduced) draw(0);
  }, { passive: true });

  // economiza bateria quando a aba não está visível
  document.addEventListener("visibilitychange", () => {
    if (reduced) return;
    if (document.hidden) cancelAnimationFrame(raf);
    else raf = requestAnimationFrame(loop);
  });

  resize();
  if (!reduced) raf = requestAnimationFrame(loop);
})();
