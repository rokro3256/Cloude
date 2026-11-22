/* =========================================================
 * 녹화 모드
 * 버튼, 명단 같은 화면 UI 없이 세로 영상(1080x1920)만 그려서 녹화합니다.
 * 대결이 자동으로 진행되고, 끝나면 승자 화면을 잠깐 보여준 뒤 녹화를 멈춥니다.
 * ========================================================= */
(function () {
  'use strict';
  const W = 1080, H = 1920;
  const ARENA = { x: 40, y: 420, size: 1000 };
  const FPS = 30;
  const OUTRO = 3; // 승자 화면 유지 시간(초)
  const DISPLAY = '"Black Han Sans", "Noto Sans KR", sans-serif';
  const BODY = '"Noto Sans KR", system-ui, sans-serif';
  const $ = (id) => document.getElementById(id);

  let game = null, recorder = null, chunks = [], defs = [], blob = null, ext = 'webm';
  let endAt = 0, winners = null, cancelled = false, finishing = false;

  function pickMime() {
    if (!window.MediaRecorder) return null;
    const list = [
      'video/mp4;codecs=avc1.42E01F', 'video/mp4;codecs=avc1', 'video/mp4',
      'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
    ];
    for (const m of list) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* 다음 후보 */ }
    }
    return '';
  }

  function supported() {
    const c = document.createElement('canvas');
    return !!(window.MediaRecorder && c.captureStream);
  }

  /* ---------- 영상 프레임 그리기 ---------- */
  function drawFrame() {
    const cv = $('recCanvas');
    const ctx = cv.getContext('2d');
    const g = game;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0f1118';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 제목
    ctx.font = `400 64px ${DISPLAY}`;
    const t1 = 'BALL ', t2 = 'BATTLE';
    const w1 = ctx.measureText(t1).width, w2 = ctx.measureText(t2).width;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#eef0f7'; ctx.fillText(t1, W / 2 - (w1 + w2) / 2, 120);
    ctx.fillStyle = '#ffc83d'; ctx.fillText(t2, W / 2 - (w1 + w2) / 2 + w1, 120);
    ctx.textAlign = 'center';

    // 대진
    if (g.balls.length === 2) {
      const [a, b] = g.balls;
      ctx.font = `400 76px ${DISPLAY}`;
      ctx.fillStyle = a.color; ctx.textAlign = 'right'; ctx.fillText(fit(ctx, a.name, 400), W / 2 - 80, 245);
      ctx.fillStyle = b.color; ctx.textAlign = 'left'; ctx.fillText(fit(ctx, b.name, 400), W / 2 + 80, 245);
      ctx.textAlign = 'center'; ctx.fillStyle = '#8f97ad'; ctx.font = `400 52px ${DISPLAY}`;
      ctx.fillText('VS', W / 2, 248);
    } else {
      ctx.font = `400 76px ${DISPLAY}`;
      ctx.fillStyle = '#eef0f7';
      ctx.fillText(`${g.balls.length}인 난투`, W / 2, 245);
    }

    // 시간
    ctx.font = `400 44px ${DISPLAY}`;
    ctx.fillStyle = g.suddenDeath ? '#ff5d5d' : '#8f97ad';
    ctx.fillText(g.suddenDeath ? `서든데스 ${g.time.toFixed(1)}` : g.time.toFixed(1), W / 2, 345);

    // 경기장
    ctx.drawImage(g.canvas, ARENA.x, ARENA.y, ARENA.size, ARENA.size);
    ctx.strokeStyle = g.suddenDeath ? '#ff5a5a' : '#3a4462';
    ctx.lineWidth = 4;
    roundRect(ctx, ARENA.x, ARENA.y, ARENA.size, ARENA.size, 16); ctx.stroke();

    // 체력 명단
    const n = g.balls.length;
    const cols = 2;
    const rows = Math.ceil(n / cols);
    const top = ARENA.y + ARENA.size + 40;
    const avail = H - top - 60;
    const cellH = Math.min(120, avail / rows);
    const gap = 20;
    const cellW = (W - 80 - gap) / cols;
    g.balls.forEach((b, i) => {
      const cx = 40 + (i % cols) * (cellW + gap);
      const cy = top + Math.floor(i / cols) * cellH;
      const h = cellH - 14;
      ctx.globalAlpha = b.alive ? 1 : 0.35;
      ctx.fillStyle = '#181c27';
      roundRect(ctx, cx, cy, cellW, h, 14); ctx.fill();
      const fs = Math.min(36, h * 0.36);
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(cx + 34, cy + h * 0.38, fs * 0.38, 0, Math.PI * 2); ctx.fill();
      ctx.textAlign = 'left'; ctx.fillStyle = '#eef0f7'; ctx.font = `800 ${fs}px ${BODY}`;
      ctx.fillText(fit(ctx, b.name, cellW - 190), cx + 62, cy + h * 0.38);
      ctx.textAlign = 'right'; ctx.fillStyle = '#8f97ad'; ctx.font = `700 ${fs * 0.85}px ${BODY}`;
      ctx.fillText(b.alive ? String(Math.ceil(b.hp)) : '탈락', cx + cellW - 22, cy + h * 0.38);
      const ratio = Math.max(0, b.hp / b.maxHp);
      const bx = cx + 22, by = cy + h * 0.72, bw = cellW - 44, bh = Math.max(8, h * 0.12);
      ctx.fillStyle = '#2c3349'; roundRect(ctx, bx, by, bw, bh, bh / 2); ctx.fill();
      ctx.fillStyle = ratio > 0.5 ? '#5ee07a' : ratio > 0.25 ? '#ffc23d' : '#ff5252';
      if (ratio > 0) { roundRect(ctx, bx, by, Math.max(bh, bw * ratio), bh, bh / 2); ctx.fill(); }
      ctx.globalAlpha = 1;
    });
    ctx.textAlign = 'center';

    // 승자 화면
    if (winners) {
      const k = Math.min(1, (performance.now() - endAt) / 400);
      ctx.globalAlpha = 0.72 * k;
      ctx.fillStyle = '#08090e';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = k;
      const w = winners[0];
      const cy = ARENA.y + ARENA.size / 2;
      ctx.font = `800 40px ${BODY}`;
      ctx.fillStyle = '#ffc83d';
      ctx.fillText('W I N N E R', W / 2, cy - 230);
      if (w) {
        const r = 120;
        const grd = ctx.createRadialGradient(W / 2 - r * 0.35, cy - 40 - r * 0.4, r * 0.1, W / 2, cy - 40, r);
        grd.addColorStop(0, BallBattle.util.shade(w.color, 0.35));
        grd.addColorStop(1, BallBattle.util.shade(w.color, -0.25));
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(W / 2, cy - 40, r * (0.6 + 0.4 * k), 0, Math.PI * 2); ctx.fill();
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
  }

  function fit(ctx, str, maxW) {
    if (ctx.measureText(str).width <= maxW) return str;
    let s = str;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------- 녹화 흐름 ---------- */
  function start(picks) {
    if (!supported()) {
      showMsg('이 브라우저는 영상 녹화를 지원하지 않아요. 크롬이나 사파리 최신 버전에서 열어 주세요.');
      return;
    }
    defs = picks;
    cancelled = false; finishing = false; winners = null; blob = null; chunks = [];
    $('select').hidden = true;
    $('battle').hidden = true;
    $('recSave').hidden = true;
    $('record').hidden = false;
    fitView();

    const arena = document.createElement('canvas');
    arena.width = ARENA.size; arena.height = ARENA.size;
    game = new BallBattle.Game(arena, defs, {
      onEnd: (ws) => { winners = ws; endAt = performance.now(); },
      onFrame: () => {
        drawFrame();
        if (winners && !finishing && performance.now() - endAt >= OUTRO * 1000) finish();
      },
    });
    game.banner = { str: 'FIGHT!', life: 1.2, max: 1.2 };

    const mime = pickMime();
    const stream = $('recCanvas').captureStream(FPS);
    const opts = { videoBitsPerSecond: 8000000 };
    if (mime) opts.mimeType = mime;
    try {
      recorder = new MediaRecorder(stream, opts);
    } catch (e) {
      recorder = new MediaRecorder(stream);
    }
    const type = recorder.mimeType || mime || 'video/webm';
    ext = type.includes('mp4') ? 'mp4' : 'webm';
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (cancelled) return;
      blob = new Blob(chunks, { type: type.split(';')[0] });
      showSave();
    };
    drawFrame();
    recorder.start(1000);
    game.start();
  }

  function finish() {
    finishing = true;
    if (game) { game.stop(); game = null; }
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  function cancel() {
    cancelled = true;
    finish();
    close();
  }

  function close() {
    const v = $('recVideo');
    if (v.src) { URL.revokeObjectURL(v.src); v.removeAttribute('src'); v.load(); }
    $('record').hidden = true;
    $('recSave').hidden = true;
    $('select').hidden = false;
  }

  function fitView() {
    const box = $('record');
    const s = Math.min(box.clientWidth / W, box.clientHeight / H);
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
    v.src = URL.createObjectURL(blob);
    v.play().catch(() => {});
    const mb = (blob.size / 1048576).toFixed(1);
    $('recInfo').textContent = `${ext.toUpperCase()} · ${mb}MB`;
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
    // 일반 브라우저
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
    $('recSave').hidden = false;
    $('recVideo').hidden = true;
    $('recInfo').textContent = msg;
    $('btnRecSave').hidden = true;
    $('btnRecShare').hidden = true;
    $('btnRecAgain').hidden = true;
  }

  $('btnRecCancel').addEventListener('click', cancel);
  $('btnRecSave').addEventListener('click', save);
  $('btnRecShare').addEventListener('click', share);
  $('btnRecAgain').addEventListener('click', () => { const v = $('recVideo'); if (v.src) URL.revokeObjectURL(v.src); start(defs); });
  $('btnRecClose').addEventListener('click', close);

  window.Recorder = { start, supported };
})();
