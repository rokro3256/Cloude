/* =========================================================
 * 녹화 모드
 * 전투를 화면에 보여주지 않고 모의로 끝까지 계산하면서, 프레임마다 그림을 그려
 * 바로 영상 파일(1080x1920 MP4)로 만듭니다. 실시간을 기다리지 않습니다.
 * 버튼, 명단 같은 화면 UI는 영상에 들어가지 않습니다.
 *
 * 브라우저가 WebCodecs(VideoEncoder)를 지원하지 않으면
 * 실시간 녹화(MediaRecorder)로 대신합니다.
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
  const BITRATE = 8000000;
  const DISPLAY = '"Black Han Sans", "Noto Sans KR", sans-serif';
  const BODY = '"Noto Sans KR", system-ui, sans-serif';
  const $ = (id) => document.getElementById(id);
  const nativeRandom = Math.random;

  let defs = [], blob = null, ext = 'mp4', job = 0;
  let liveRec = null, liveGame = null;

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
  const nextTick = () => new Promise((r) => setTimeout(r, 0));

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
  function skillState(g, sk) {
    const d = sk.def;
    const cd = d.cooldown || 0;
    const flash = sk.lastCast != null && g.time - sk.lastCast < 0.6;
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
  function drawFrame(g, outroT) {
    const cv = $('recCanvas');
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#0f1118';
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'middle';

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

    // 시간
    ctx.font = `400 38px ${DISPLAY}`;
    ctx.fillStyle = g.suddenDeath ? '#ff5d5d' : '#8f97ad';
    ctx.fillText(g.suddenDeath ? `서든데스  ${g.time.toFixed(1)}` : g.time.toFixed(1), W / 2, 238);

    // 경기장
    ctx.drawImage(g.canvas, ARENA.x, ARENA.y, ARENA.size, ARENA.size);
    ctx.strokeStyle = g.suddenDeath ? '#ff5a5a' : '#3a4462';
    ctx.lineWidth = 4;
    roundRect(ctx, ARENA.x, ARENA.y, ARENA.size, ARENA.size, 16); ctx.stroke();

    drawCards(ctx, g, ARENA.y + ARENA.size + 28, 1700);
    drawLog(ctx, g, 1716, H - 24);

    if (outroT >= 0) drawWinner(ctx, g, outroT);
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
        const st = skillState(g, sk);
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
      ctx.fillStyle = '#fff'; ctx.font = `400 ${Math.round(r * 0.95)}px ${DISPLAY}`;
      ctx.fillText(w.icon, W / 2, cy - 36);
    }
    ctx.fillStyle = '#eef0f7'; ctx.font = `400 96px ${DISPLAY}`;
    const name = w ? (winners.length > 1 ? winners.map((x) => x.name).join(', ') : w.name) : '무승부';
    ctx.fillText(fit(ctx, name, W - 120), W / 2, cy + 170);
    ctx.fillStyle = '#8f97ad'; ctx.font = `700 36px ${BODY}`;
    ctx.fillText(`${g.time.toFixed(1)}초`, W / 2, cy + 260);
    ctx.globalAlpha = 1;
  }

  /* ---------- 모의 전투 ---------- */
  function newGame(rng, canvas) {
    return seeded(rng, () => {
      const g = new BallBattle.Game(canvas, defs, {});
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
  function estimateFrames(seed) {
    const rng = mulberry32(seed);
    const g = newGame(rng, document.createElement('canvas'));
    let f = 0;
    while (!g.ended) { stepFrame(g, rng); f++; }
    return f + OUTRO * FPS;
  }

  /* ---------- 인코딩 ---------- */
  function webCodecsReady() {
    return !!(window.VideoEncoder && window.VideoFrame && window.Mp4Muxer);
  }

  async function pickEncoder() {
    const base = { width: W, height: H, bitrate: BITRATE, framerate: FPS };
    const avc = ['avc1.640028', 'avc1.4d0028', 'avc1.420028', 'avc1.640032', 'avc1.42e032'];
    for (const codec of avc) {
      const cfg = Object.assign({ codec, avc: { format: 'avc' } }, base);
      try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { cfg, mux: 'avc' }; } catch (e) { /* 다음 */ }
    }
    for (const codec of ['vp09.00.40.08', 'vp09.00.41.08']) {
      const cfg = Object.assign({ codec }, base);
      try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { cfg, mux: 'vp9' }; } catch (e) { /* 다음 */ }
    }
    return null;
  }

  async function renderVideo(myJob) {
    const enc = await pickEncoder();
    if (!enc) return false;
    if (myJob !== job) return true;

    const seed = (nativeRandom() * 2 ** 32) >>> 0;
    const estimate = estimateFrames(seed);

    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxer = new Mp4Muxer.Muxer({
      target,
      video: { codec: enc.mux, width: W, height: H, frameRate: FPS },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });
    let encErr = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => { encErr = e; },
    });
    encoder.configure(enc.cfg);

    const rng = mulberry32(seed);
    const arena = document.createElement('canvas');
    arena.width = ARENA.size; arena.height = ARENA.size;
    const g = newGame(rng, arena);
    g.banner = { str: 'FIGHT!', life: 1.2, max: 1.2 };
    let endFrame = -1;
    const frameDur = 1e6 / FPS;

    for (let f = 0; ; f++) {
      if (myJob !== job) { try { encoder.close(); } catch (e) { /* 이미 닫힘 */ } return true; }
      if (encErr) throw encErr;
      if (f > 0) stepFrame(g, rng);
      if (g.ended && endFrame < 0) endFrame = f;
      g.render();
      drawFrame(g, endFrame >= 0 ? (f - endFrame) / FPS : -1);
      const frame = new VideoFrame($('recCanvas'), { timestamp: Math.round(f * frameDur), duration: Math.round(frameDur) });
      encoder.encode(frame, { keyFrame: f % (FPS * 2) === 0 });
      frame.close();
      if (endFrame >= 0 && f - endFrame >= OUTRO * FPS) break;

      while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 2));
      if (f % 3 === 0) {
        setProgress(Math.min(0.99, f / estimate), g.time);
        await nextTick();
      }
    }
    await encoder.flush();
    encoder.close();
    if (encErr) throw encErr;
    muxer.finalize();
    if (myJob !== job) return true;
    ext = 'mp4';
    blob = new Blob([target.buffer], { type: 'video/mp4' });
    setProgress(1, g.time);
    showSave();
    return true;
  }

  function setProgress(p, t) {
    $('recBar').style.width = (p * 100).toFixed(1) + '%';
    $('recPct').textContent = `영상 만드는 중 ${Math.floor(p * 100)}%`;
  }

  /* ---------- 실시간 녹화 (WebCodecs 미지원 브라우저용) ---------- */
  function pickMime() {
    const list = ['video/mp4;codecs=avc1.42E01F', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (const m of list) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* 다음 */ }
    }
    return '';
  }

  function renderLive(myJob) {
    if (!(window.MediaRecorder && $('recCanvas').captureStream)) return false;
    $('recPct').textContent = '이 브라우저는 실시간으로 녹화해요';
    $('recBar').style.width = '0%';
    const arena = document.createElement('canvas');
    arena.width = ARENA.size; arena.height = ARENA.size;
    let endAt = -1, finishing = false;
    const chunks = [];
    liveGame = new BallBattle.Game(arena, defs, {
      onEnd: () => { endAt = performance.now(); },
      onFrame: (g) => {
        const t = endAt >= 0 ? (performance.now() - endAt) / 1000 : -1;
        drawFrame(g, t);
        if (t >= OUTRO && !finishing) {
          finishing = true;
          stopLive();
        }
      },
    });
    liveGame.banner = { str: 'FIGHT!', life: 1.2, max: 1.2 };
    const mime = pickMime();
    const stream = $('recCanvas').captureStream(FPS);
    const opts = { videoBitsPerSecond: BITRATE };
    if (mime) opts.mimeType = mime;
    try { liveRec = new MediaRecorder(stream, opts); } catch (e) { liveRec = new MediaRecorder(stream); }
    const type = liveRec.mimeType || mime || 'video/webm';
    liveRec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    liveRec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (myJob !== job) return;
      ext = type.includes('mp4') ? 'mp4' : 'webm';
      blob = new Blob(chunks, { type: type.split(';')[0] });
      showSave();
    };
    drawFrame(liveGame, -1);
    liveRec.start(1000);
    liveGame.start();
    return true;
  }

  function stopLive() {
    if (liveGame) { liveGame.stop(); liveGame = null; }
    if (liveRec && liveRec.state !== 'inactive') liveRec.stop();
    liveRec = null;
  }

  /* ---------- 화면 흐름 ---------- */
  async function start(picks) {
    defs = picks;
    blob = null;
    const myJob = ++job;
    $('select').hidden = true;
    $('battle').hidden = true;
    $('recSave').hidden = true;
    $('record').hidden = false;
    setProgress(0, 0);
    fitView();
    await nextTick();
    try {
      let ok = false;
      if (webCodecsReady()) ok = await renderVideo(myJob);
      if (!ok && myJob === job) ok = renderLive(myJob);
      if (!ok && myJob === job) showMsg('이 브라우저는 영상 만들기를 지원하지 않아요. 크롬이나 사파리 최신 버전에서 열어 주세요.');
    } catch (e) {
      console.error('[녹화 오류]', e);
      if (myJob === job) {
        // 인코더가 실패하면 실시간 녹화로 한 번 더 시도
        if (!renderLive(myJob)) showMsg('영상을 만들지 못했어요: ' + (e && e.message ? e.message : e));
      }
    }
  }

  function cancel() {
    job++;
    stopLive();
    close();
  }

  function close() {
    job++;
    stopLive();
    const v = $('recVideo');
    if (v.src) { URL.revokeObjectURL(v.src); v.removeAttribute('src'); v.load(); }
    $('record').hidden = true;
    $('recSave').hidden = true;
    $('select').hidden = false;
  }

  function fitView() {
    const box = $('record');
    const prog = box.querySelector('.recprog');
    const availH = box.clientHeight - (prog ? prog.offsetHeight + 36 : 0);
    const s = Math.max(0.05, Math.min((box.clientWidth - 32) / W, availH / H));
    const c = $('recCanvas');
    c.style.width = Math.floor(W * s) + 'px';
    c.style.height = Math.floor(H * s) + 'px';
  }
  window.addEventListener('resize', () => { if (!$('record').hidden) fitView(); });

  function fileName() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `ball-battle-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
  }

  function showSave() {
    $('record').hidden = true;
    $('recSave').hidden = false;
    ['recVideo', 'btnRecSave', 'btnRecAgain'].forEach((id) => { $(id).hidden = false; });
    const v = $('recVideo');
    if (v.src) URL.revokeObjectURL(v.src);
    v.src = URL.createObjectURL(blob);
    v.play().catch(() => {});
    $('recInfo').textContent = `${ext.toUpperCase()} · ${(blob.size / 1048576).toFixed(1)}MB`;
    $('recStatus').textContent = '';
    const file = new File([blob], fileName(), { type: blob.type });
    $('btnRecShare').hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
  }

  async function save() {
    if (!blob) return;
    const name = fileName();
    const status = $('recStatus');
    // Claude 링크 안에서 열었을 때
    if (window.claude && typeof window.claude.use === 'function') {
      status.textContent = '저장 창을 여는 중…';
      try {
        const dl = await window.claude.use('downloads');
        if (dl) {
          try {
            await dl.save({ filename: name, data: blob });
            status.textContent = '저장했어요.';
          } catch (e) {
            const code = e && e.code;
            status.textContent = code === 'declined' ? '저장을 취소했어요.'
              : code === 'rate_limited' ? '저장 창이 이미 열려 있어요. 잠시 뒤 다시 눌러 주세요.'
              : '여기서는 저장할 수 없어요. 공유 버튼을 써 보세요.';
          }
          return;
        }
      } catch (e) { /* 일반 다운로드로 */ }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    status.textContent = '다운로드를 시작했어요.';
  }

  async function share() {
    if (!blob) return;
    const file = new File([blob], fileName(), { type: blob.type });
    try {
      await navigator.share({ files: [file], title: 'Ball Battle' });
    } catch (e) {
      if (e && e.name !== 'AbortError') $('recStatus').textContent = '공유할 수 없어요. 저장 버튼을 써 보세요.';
    }
  }

  function showMsg(msg) {
    $('record').hidden = true;
    $('recSave').hidden = false;
    $('recVideo').hidden = true;
    $('recInfo').textContent = msg;
    $('recStatus').textContent = '';
    $('btnRecSave').hidden = true;
    $('btnRecShare').hidden = true;
    $('btnRecAgain').hidden = true;
  }

  $('btnRecCancel').addEventListener('click', cancel);
  $('btnRecSave').addEventListener('click', save);
  $('btnRecShare').addEventListener('click', share);
  $('btnRecAgain').addEventListener('click', () => start(defs));
  $('btnRecClose').addEventListener('click', close);

  window.Recorder = { start };
})();
