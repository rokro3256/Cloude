/* =========================================================
 * 영상 공통 코드 (페이지와 Web Worker 양쪽에서 사용)
 * - 고정 시드 모의 전투
 * - 영상 한 프레임 그리기 (경기장, 체력, 스킬 쿨타임, 스킬 기록, 승자 화면)
 * ========================================================= */
(function () {
  'use strict';
  const W = 1080, H = 1920;
  const ARENA = { x: 40, y: 290, size: 1000 };
  const FPS = 30;
  const STEP = 1 / 120;
  const STEPS_PER_FRAME = Math.round(1 / FPS / STEP); // 4
  const OUTRO = 3;          // 승자 화면 유지 시간(초)
  const MAX_TIME = 240;     // 모의 전투 최대 길이(초)
  const DISPLAY = '"Black Han Sans", "Noto Sans KR", sans-serif';
  const BODY = '"Noto Sans KR", system-ui, sans-serif';
  const nativeRandom = Math.random;

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /* ---------- 공통 유틸 ---------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // 전투 계산은 고정된 난수로, 그리기 효과는 일반 난수로
  function seeded(rng, fn) {
    Math.random = rng;
    try { return fn(); } finally { Math.random = nativeRandom; }
  }

  function fit(ctx, str, maxW) {
    if (ctx.measureText(str).width <= maxW) return str;
    let s = str;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------- 스킬 상태 ---------- */
  function skillState(g, sk, b) {
    const d = sk.def;
    const cd = d.cooldown || 0;
    const flash = sk.lastCast != null && g.time - sk.lastCast < 0.6;
    if (d.display) {
      // 스킬이 직접 보여줄 내용을 정함 (예: 브레인 악셀의 현재 속도)
      const v = d.display(b) || {};
      return { text: String(v.text != null ? v.text : ''), ratio: Math.max(0, Math.min(1, v.ratio || 0)), ready: true, flash };
    }
    if (sk.trigger === 'cooldown' || cd > 0) {
      if (sk.timer > 0 && cd > 0) {
        return { text: sk.timer.toFixed(1) + 's', ratio: 1 - sk.timer / cd, ready: false, flash };
      }
      return { text: sk.trigger === 'cooldown' ? '준비' : '패시브', ratio: 1, ready: true, flash };
    }
    if (sk.trigger === 'lowHp' || sk.trigger === 'onDeath' || sk.trigger === 'start') {
      return sk.used ? { text: '사용함', ratio: 0, ready: false, used: true, flash } : { text: '대기', ratio: 1, ready: true, flash };
    }
    return { text: '패시브', ratio: 1, ready: true, passive: true, flash };
  }

  /* ---------- 영상 한 프레임 그리기 ---------- */
  function drawFrame(g, outroT, cv) {
    const ctx = cv.getContext('2d');
    const k = cv.width / W;
    ctx.globalAlpha = 1;

    // 바뀌지 않는 배경(바탕, 제목, 대진, 경기장 바닥과 테두리)은 한 번만 그려 두고 통째로 옮김
    const bgKey = cv.width + (g.suddenDeath ? 'sd' : '') + (g.view ? 'v' : '');
    if (g._bgKey !== bgKey) {
      const bc = makeCanvas(cv.width, cv.height);
      const bx = bc.getContext('2d');
      bx.setTransform(k, 0, 0, k, 0, 0);
      bx.fillStyle = '#0f1118';
      bx.fillRect(0, 0, W, H);
      bx.textBaseline = 'middle';
      drawHeader(bx, g);
      if (g.view) {
        const v = g.view;
        bx.setTransform(1, 0, 0, 1, 0, 0);
        bx.drawImage(g.floorImage(Math.round(v.size)), v.x, v.y, v.size, v.size);
        bx.setTransform(k, 0, 0, k, 0, 0);
      }
      bx.strokeStyle = g.suddenDeath ? '#ff5a5a' : '#3a4462';
      bx.lineWidth = 4;
      roundRect(bx, ARENA.x, ARENA.y, ARENA.size, ARENA.size, 16); bx.stroke();
      g._bg = bc; g._bgKey = bgKey;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(g._bg, 0, 0);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    // 시간
    ctx.font = `400 38px ${DISPLAY}`;
    ctx.fillStyle = g.suddenDeath ? '#ff5d5d' : '#8f97ad';
    ctx.fillText(g.suddenDeath ? `서든데스  ${g.time.toFixed(1)}` : g.time.toFixed(1), W / 2, 238);

    // 경기장: 영상 캔버스에 직접 그리거나(g.view), 따로 그린 그림을 옮김
    if (g.view) {
      g.render();
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.globalAlpha = 1;
      ctx.textBaseline = 'middle';
    } else {
      ctx.drawImage(g.canvas, ARENA.x, ARENA.y, ARENA.size, ARENA.size);
      ctx.strokeStyle = g.suddenDeath ? '#ff5a5a' : '#3a4462';
      ctx.lineWidth = 4;
      roundRect(ctx, ARENA.x, ARENA.y, ARENA.size, ARENA.size, 16); ctx.stroke();
    }

    drawCards(ctx, g, ARENA.y + ARENA.size + 28, 1700);
    drawLog(ctx, g, 1716, H - 24);

    if (outroT >= 0) drawWinner(ctx, g, outroT);
  }

  function drawHeader(ctx, g) {
    // 제목
    ctx.font = `400 54px ${DISPLAY}`;
    const t1 = 'BALL ', t2 = 'BATTLE';
    const w1 = ctx.measureText(t1).width, w2 = ctx.measureText(t2).width;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#eef0f7'; ctx.fillText(t1, W / 2 - (w1 + w2) / 2, 70);
    ctx.fillStyle = '#ffc83d'; ctx.fillText(t2, W / 2 - (w1 + w2) / 2 + w1, 70);
    ctx.textAlign = 'center';

    // 대진
    if (g.balls.length === 2) {
      const [a, b] = g.balls;
      ctx.font = `400 66px ${DISPLAY}`;
      ctx.fillStyle = a.color; ctx.textAlign = 'right'; ctx.fillText(fit(ctx, a.name, 400), W / 2 - 70, 160);
      ctx.fillStyle = b.color; ctx.textAlign = 'left'; ctx.fillText(fit(ctx, b.name, 400), W / 2 + 70, 160);
      ctx.textAlign = 'center'; ctx.fillStyle = '#8f97ad'; ctx.font = `400 44px ${DISPLAY}`;
      ctx.fillText('VS', W / 2, 163);
    } else {
      ctx.font = `400 66px ${DISPLAY}`;
      ctx.fillStyle = '#eef0f7';
      ctx.fillText(`${g.balls.length}인 난투`, W / 2, 160);
    }

  }

  // 캐릭터별 체력 + 스킬 쿨타임
  function drawCards(ctx, g, top, bottom) {
    const n = g.balls.length;
    const cols = n <= 4 ? 2 : n <= 9 ? 3 : 4;
    const rows = Math.ceil(n / cols);
    const gap = 16;
    const cardW = (W - 80 - gap * (cols - 1)) / cols;
    const cardH = (bottom - top - gap * (rows - 1)) / rows;
    const pad = Math.min(22, cardW * 0.06);

    g.balls.forEach((b, i) => {
      const x = 40 + (i % cols) * (cardW + gap);
      const y = top + Math.floor(i / cols) * (cardH + gap);
      ctx.globalAlpha = b.alive ? 1 : 0.35;
      ctx.fillStyle = '#181c27';
      roundRect(ctx, x, y, cardW, cardH, 14); ctx.fill();

      // 이름 줄
      const headH = Math.min(58, cardH * 0.3);
      const fs = Math.min(34, headH * 0.62, cardW * 0.1);
      const midY = y + pad * 0.6 + headH / 2;
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(x + pad + fs * 0.4, midY, fs * 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.textAlign = 'right'; ctx.fillStyle = '#8f97ad'; ctx.font = `700 ${fs * 0.82}px ${BODY}`;
      const hpText = b.alive ? String(Math.ceil(b.hp)) : '탈락';
      ctx.fillText(hpText, x + cardW - pad, midY);
      const hpW = ctx.measureText(hpText).width;
      ctx.textAlign = 'left'; ctx.fillStyle = '#eef0f7'; ctx.font = `800 ${fs}px ${BODY}`;
      ctx.fillText(fit(ctx, b.name, cardW - pad * 2 - fs - 12 - hpW - 10), x + pad + fs + 10, midY);

      // 체력 바
      const by = y + pad * 0.6 + headH + 2, bw = cardW - pad * 2, bh = Math.max(6, Math.min(12, cardH * 0.05));
      const ratio = Math.max(0, b.hp / b.maxHp);
      ctx.fillStyle = '#2c3349'; roundRect(ctx, x + pad, by, bw, bh, bh / 2); ctx.fill();
      ctx.fillStyle = ratio > 0.5 ? '#5ee07a' : ratio > 0.25 ? '#ffc23d' : '#ff5252';
      if (ratio > 0) { roundRect(ctx, x + pad, by, Math.max(bh, bw * ratio), bh, bh / 2); ctx.fill(); }
      if (b.status.shield) {
        ctx.fillStyle = '#7fe3ff';
        roundRect(ctx, x + pad, by - 5, bw * Math.min(1, b.status.shield.amount / b.maxHp), 3, 1.5); ctx.fill();
      }

      // 스킬 목록
      const skills = b.skills;
      if (!skills.length) {
        ctx.fillStyle = '#5d6580'; ctx.font = `500 ${Math.min(26, fs * 0.75)}px ${BODY}`;
        ctx.fillText('스킬 없음', x + pad, by + bh + Math.min(40, (cardH - headH) * 0.3));
        ctx.globalAlpha = 1;
        return;
      }
      const areaTop = by + bh + 12;
      const areaH = y + cardH - pad * 0.6 - areaTop;
      const lh = Math.min(72, areaH / skills.length);
      skills.forEach((sk, k) => {
        const st = skillState(g, sk, b);
        const ly = areaTop + k * lh;
        const col = sk.def.color || '#ffd23f';
        if (lh >= 26) {
          const sfs = Math.min(32, lh * 0.46, cardW * 0.075);
          const ty = ly + lh * 0.36;
          if (st.flash) {
            ctx.fillStyle = col; ctx.globalAlpha = (b.alive ? 1 : 0.35) * 0.18;
            roundRect(ctx, x + pad - 8, ly - 2, cardW - pad * 2 + 16, lh - 2, 8); ctx.fill();
            ctx.globalAlpha = b.alive ? 1 : 0.35;
          }
          ctx.textAlign = 'right';
          ctx.font = `700 ${sfs * 0.9}px ${BODY}`;
          ctx.fillStyle = st.used ? '#5d6580' : st.passive ? '#8f97ad' : st.ready ? '#6dff9c' : '#c6cbe0';
          ctx.fillText(st.text, x + cardW - pad, ty);
          const stW = ctx.measureText(st.text).width;
          ctx.textAlign = 'left';
          ctx.font = `${st.flash ? 900 : 700} ${sfs}px ${BODY}`;
          ctx.fillStyle = st.used ? '#5d6580' : st.flash ? col : '#eef0f7';
          ctx.fillText(fit(ctx, sk.def.name || '스킬', cardW - pad * 2 - stW - 10), x + pad, ty);
          // 쿨타임 바
          if (!st.passive) {
            const cy = ly + lh * 0.7, ch = Math.max(3, Math.min(6, lh * 0.1));
            ctx.fillStyle = '#2c3349'; roundRect(ctx, x + pad, cy, bw, ch, ch / 2); ctx.fill();
            if (st.ratio > 0) {
              ctx.fillStyle = st.ready ? col : '#5b6688';
              roundRect(ctx, x + pad, cy, Math.max(ch, bw * st.ratio), ch, ch / 2); ctx.fill();
            }
          }
        } else {
          // 칸이 좁으면 쿨타임 바만
          const cy = ly + lh * 0.3, ch = Math.max(3, lh * 0.4);
          ctx.fillStyle = '#2c3349'; roundRect(ctx, x + pad, cy, bw, ch, ch / 2); ctx.fill();
          ctx.fillStyle = st.ready ? col : '#5b6688';
          if (st.ratio > 0) { roundRect(ctx, x + pad, cy, Math.max(ch, bw * st.ratio), ch, ch / 2); ctx.fill(); }
        }
      });
      ctx.globalAlpha = 1;
    });
    ctx.textAlign = 'center';
  }

  // 최근 발동한 스킬 기록
  function drawLog(ctx, g, top, bottom) {
    const lines = 4;
    const lh = (bottom - top) / lines;
    const list = g.castLog.slice(-lines).reverse();
    ctx.textAlign = 'left';
    list.forEach((e, i) => {
      const y = top + lh * i + lh / 2;
      const age = g.time - e.t;
      ctx.globalAlpha = i === 0 ? 1 : Math.max(0.35, 0.85 - i * 0.18);
      ctx.font = `700 26px ${BODY}`;
      ctx.fillStyle = '#5d6580';
      ctx.fillText(e.t.toFixed(1).padStart(5, ' ') + 's', 48, y);
      ctx.fillStyle = e.ball.color;
      ctx.beginPath(); ctx.arc(170, y, 10, 0, Math.PI * 2); ctx.fill();
      ctx.font = `800 30px ${BODY}`;
      ctx.fillStyle = '#eef0f7';
      const nm = fit(ctx, e.ball.name, 300);
      ctx.fillText(nm, 192, y);
      const nw = ctx.measureText(nm).width;
      ctx.fillStyle = '#8f97ad'; ctx.font = `700 26px ${BODY}`;
      ctx.fillText('▸', 192 + nw + 14, y);
      ctx.fillStyle = i === 0 && age < 0.6 ? (e.color || '#ffd23f') : '#c6cbe0';
      ctx.font = `800 30px ${BODY}`;
      ctx.fillText(fit(ctx, e.name, W - 80 - (192 + nw + 46)), 192 + nw + 46, y);
    });
    if (!list.length) {
      ctx.globalAlpha = 0.6; ctx.fillStyle = '#5d6580'; ctx.font = `700 26px ${BODY}`;
      ctx.fillText('스킬 기록', 48, top + lh / 2);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
  }

  function drawWinner(ctx, g, t) {
    const winners = g.living();
    const k = Math.min(1, t / 0.4);
    ctx.globalAlpha = 0.74 * k;
    ctx.fillStyle = '#08090e';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = k;
    ctx.textAlign = 'center';
    const w = winners[0];
    const cy = ARENA.y + ARENA.size / 2;
    ctx.font = `800 40px ${BODY}`;
    ctx.fillStyle = '#ffc83d';
    ctx.fillText('W I N N E R', W / 2, cy - 230);
    if (w) {
      const r = 120 * (0.6 + 0.4 * k);
      const grd = ctx.createRadialGradient(W / 2 - r * 0.35, cy - 40 - r * 0.4, r * 0.1, W / 2, cy - 40, r);
      grd.addColorStop(0, BallBattle.util.shade(w.color, 0.35));
      grd.addColorStop(1, BallBattle.util.shade(w.color, -0.25));
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(W / 2, cy - 40, r, 0, Math.PI * 2); ctx.fill();
      const img = w.def.image ? BallBattle.images.get(w.def.image) : null;
      if (img) {
        ctx.save();
        ctx.beginPath(); ctx.arc(W / 2, cy - 40, r - 5, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(img, W / 2 - r + 5, cy - 40 - r + 5, (r - 5) * 2, (r - 5) * 2);
        ctx.restore();
      } else {
        ctx.fillStyle = '#fff'; ctx.font = `400 ${Math.round(r * 0.95)}px ${DISPLAY}`;
        ctx.fillText(w.icon, W / 2, cy - 36);
      }
    }
    ctx.fillStyle = '#eef0f7'; ctx.font = `400 96px ${DISPLAY}`;
    const name = w ? (winners.length > 1 ? winners.map((x) => x.name).join(', ') : w.name) : '무승부';
    ctx.fillText(fit(ctx, name, W - 120), W / 2, cy + 170);
    ctx.fillStyle = '#8f97ad'; ctx.font = `700 36px ${BODY}`;
    ctx.fillText(`${g.time.toFixed(1)}초`, W / 2, cy + 260);
    ctx.globalAlpha = 1;
  }

  /* ---------- 모의 전투 ---------- */
  // view를 주면 canvas(영상 화면)의 경기장 자리에 바로 그림
  function newGame(defs, rng, canvas, view, onSound) {
    return seeded(rng, () => {
      const g = new BallBattle.Game(canvas, defs, { onSound });
      if (view) { g.view = view; g.fastFx = true; g.skipFloor = true; }
      g.balls.forEach((b) => g.fire(b, 'start', {}));
      return g;
    });
  }

  function stepFrame(g, rng) {
    seeded(rng, () => {
      for (let i = 0; i < STEPS_PER_FRAME && !g.ended; i++) {
        if (g.time >= MAX_TIME) { g.ended = true; break; }
        g.update(STEP);
      }
    });
  }

  // 1차: 그림 없이 끝까지 계산해서 길이를 알아냄
  // 1차: 그림 없이 끝까지 계산해서 영상 길이와 효과음 시각을 알아냄
  function countFrames(defs, seed) {
    const rng = mulberry32(seed);
    const events = [];
    const g = newGame(defs, rng, makeCanvas(4, 4), null, (name, t, o) => events.push({ name, t, o }));
    let f = 0;
    while (!g.ended) { stepFrame(g, rng); f++; }
    return { total: f + OUTRO * FPS + 1, endFrame: f, events };
  }


  self.VideoCore = {
    W, H, ARENA, FPS, OUTRO,
    mulberry32, newGame, stepFrame, countFrames, drawFrame, makeCanvas,
  };
})();
