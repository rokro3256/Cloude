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
  const C = window.VideoCore;
  const { W, H, ARENA, FPS, OUTRO } = C;
  const BITRATE = 8000000;
  const OUT_SCALE = 2 / 3;  // 출력 크기 배율 (1 = 1080x1920, 2/3 = 720x1280)
  const OW = Math.round(W * OUT_SCALE), OH = Math.round(H * OUT_SCALE);
  const MAX_WORKERS = 6;    // 동시에 영상을 만드는 작업자 수 상한
  const $ = (id) => document.getElementById(id);

  let defs = [], blob = null, ext = 'mp4', job = 0, noAudio = false;
  let liveRec = null, liveGame = null;

  const nextTick = () => new Promise((r) => setTimeout(r, 0));

  /* ---------- 인코딩 ---------- */
  function webCodecsReady() {
    return !!(window.VideoEncoder && window.VideoFrame && window.Mp4Muxer);
  }

  async function pickEncoder() {
    const base = { width: OW, height: OH, bitrate: Math.round(BITRATE * OUT_SCALE * OUT_SCALE), framerate: FPS, latencyMode: 'realtime' };
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

  // 메인 스레드가 잠깐 쉬어서 화면(진행률)이 갱신되게 함. setTimeout보다 지연이 적음
  const yieldChannel = new MessageChannel();
  const yieldQueue = [];
  yieldChannel.port1.onmessage = () => { const r = yieldQueue.shift(); if (r) r(); };
  const yieldNow = () => new Promise((r) => { yieldQueue.push(r); yieldChannel.port2.postMessage(0); });

  async function renderVideo(myJob) {
    const enc = await pickEncoder();
    if (!enc) return false;
    if (myJob !== job) return true;

    const seed = (Math.random() * 2 ** 32) >>> 0;
    const sim = C.countFrames(defs, seed); // {total, events, endFrame}
    const total = sim.total;
    const cores = navigator.hardwareConcurrency || 4;
    const k = Math.max(1, Math.min(MAX_WORKERS, cores, Math.ceil(total / (FPS * 2))));

    // 효과음은 영상과 동시에 따로 만듦
    const audioP = buildAudio(sim, total / FPS).catch((e) => { console.warn('[녹화] 효과음 실패', e); return null; });

    const encodeAll = async (n) => {
      if (workersReady()) {
        try {
          const r = await encodeWithWorkers(enc, seed, total, n, myJob);
          if (r) return r;
        } catch (e) {
          console.warn('[녹화] 작업자 사용 실패, 페이지에서 직접 만듦', e);
        }
      }
      if (myJob !== job) return null;
      return encodeOnPage(enc, seed, total, Math.min(4, n), myJob);
    };

    let segChunks = await encodeAll(k);
    if (!segChunks || myJob !== job) return true;
    const audio = await audioP;
    if (myJob !== job) return true;
    let buf = mux(enc, segChunks, audio);
    if (buf === 'mismatch') {
      segChunks = await encodeAll(1);
      if (!segChunks || myJob !== job) return true;
      buf = mux(enc, segChunks, audio);
    }
    if (myJob !== job || typeof buf === 'string') return true;

    ext = 'mp4';
    noAudio = !audio;
    blob = new Blob([buf], { type: 'video/mp4' });
    setProgress(1);
    showSave();
    return true;
  }

  /* ----- 효과음 트랙 ----- */
  const AUDIO_RATE = 48000;
  const AUDIO_BITRATE = 192000; // 음질 유지를 위해 높게

  async function pickAudioEncoder() {
    if (!window.AudioEncoder) return null;
    const base = { sampleRate: AUDIO_RATE, numberOfChannels: 2, bitrate: AUDIO_BITRATE };
    const tries = [
      { cfg: Object.assign({ codec: 'mp4a.40.2' }, base), mux: 'aac' },  // AAC: 가장 널리 재생됨
      { cfg: Object.assign({ codec: 'opus' }, base), mux: 'opus' },
    ];
    for (const t of tries) {
      try { if ((await AudioEncoder.isConfigSupported(t.cfg)).supported) return t; } catch (e) { /* 다음 */ }
    }
    return null;
  }

  async function buildAudio(sim, duration) {
    const ae = await pickAudioEncoder();
    if (!ae || !window.SFX) return null;
    const events = [{ name: 'fight', t: 0, o: {} }].concat(sim.events);
    events.push({ name: 'win', t: sim.endFrame / FPS + 0.15, o: {} });
    const buffer = await window.SFX.renderOffline(events, duration, AUDIO_RATE);
    if (!buffer) return null;

    const chunks = [];
    let err = null;
    const encoder = new AudioEncoder({
      output: (chunk, meta) => chunks.push({ chunk, meta }),
      error: (e) => { err = e; },
    });
    encoder.configure(ae.cfg);
    const L = buffer.getChannelData(0), R = buffer.getChannelData(1);
    const block = 4800; // 0.1초씩
    for (let i = 0; i < buffer.length; i += block) {
      const n = Math.min(block, buffer.length - i);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(i, i + n), 0);
      data.set(R.subarray(i, i + n), n);
      const ad = new AudioData({
        format: 'f32-planar', sampleRate: AUDIO_RATE, numberOfFrames: n, numberOfChannels: 2,
        timestamp: Math.round((i / AUDIO_RATE) * 1e6), data,
      });
      encoder.encode(ad);
      ad.close();
    }
    await encoder.flush();
    encoder.close();
    if (err) throw err;
    return { mux: ae.mux, chunks };
  }

  // 영상 화면 안에서 경기장이 들어갈 자리 (출력 픽셀 단위)
  function arenaView() {
    return { x: ARENA.x * OUT_SCALE, y: ARENA.y * OUT_SCALE, size: ARENA.size * OUT_SCALE };
  }

  function splitSegments(total, k) {
    const segLen = Math.ceil(total / k);
    const out = [];
    for (let i = 0; i < k; i++) {
      const start = i * segLen, end = Math.min(total, start + segLen);
      if (start < end) out.push({ start, end });
    }
    return out;
  }

  function decoderDescKey(chunks) {
    const c = chunks.find((o) => o.meta && o.meta.decoderConfig);
    const d = c && c.meta.decoderConfig.description;
    if (!d) return '';
    const u = d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
    return Array.from(u).join(',');
  }

  // 구간들을 순서대로 이어 붙여 MP4로 만듦. 구간마다 인코더 설정(SPS/PPS)이 같아야 함
  function mux(enc, segChunks, audio) {
    const k0 = decoderDescKey(segChunks[0]);
    if (segChunks.some((c) => decoderDescKey(c) !== k0)) return 'mismatch';
    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxer = new Mp4Muxer.Muxer({
      target,
      video: { codec: enc.mux, width: OW, height: OH, frameRate: FPS },
      audio: audio ? { codec: audio.mux, numberOfChannels: 2, sampleRate: AUDIO_RATE } : undefined,
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });
    for (const list of segChunks) for (const o of list) muxer.addVideoChunk(o.chunk, o.meta);
    if (audio) for (const o of audio.chunks) muxer.addAudioChunk(o.chunk, o.meta);
    muxer.finalize();
    return target.buffer;
  }

  /* ----- 방법 1: Web Worker 여러 개가 동시에 그리고 인코딩 ----- */
  function workersReady() {
    return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && location.protocol !== 'file:';
  }

  // 페이지에 불러온 웹폰트 정보를 작업자에게 넘김 (link에 crossorigin 필요)
  function fontRules() {
    const out = [];
    for (const sh of Array.from(document.styleSheets)) {
      let rules;
      try { rules = sh.cssRules; } catch (e) { continue; }
      if (!rules) continue;
      for (const r of Array.from(rules)) {
        if (r.type !== 5) continue; // CSSRule.FONT_FACE_RULE
        const st = r.style;
        out.push({
          family: st.getPropertyValue('font-family').replace(/["']/g, '').trim(),
          src: st.getPropertyValue('src'),
          weight: st.getPropertyValue('font-weight'),
          style: st.getPropertyValue('font-style'),
          unicodeRange: st.getPropertyValue('unicode-range'),
        });
      }
    }
    return out;
  }

  function fontSampleText() {
    const words = ['BALL BATTLE VS FIGHT! W I N N E R 0123456789.s…▸+', '인 난투 서든데스 준비 패시브 대기 사용함 스킬 없음 탈락 무승부 초 무적 막음'];
    defs.forEach((d) => {
      words.push(d.name || '', d.icon || '');
      (d.skills || []).forEach((sk) => words.push(sk.name || ''));
    });
    return Array.from(new Set(words.join('').split(''))).join('');
  }

  let activeWorkers = [];
  function stopWorkers() {
    activeWorkers.forEach((w) => { try { w.postMessage({ type: 'cancel' }); w.terminate(); } catch (e) { /* 무시 */ } });
    activeWorkers = [];
  }

  function encodeWithWorkers(enc, seed, total, k, myJob) {
    const picks = defs.map((d) => (window.CHARACTERS || []).indexOf(d));
    if (picks.some((i) => i < 0)) return Promise.resolve(null);
    const segs = splitSegments(total, k);
    const fonts = fontRules();
    const text = fontSampleText();
    const preview = $('recCanvas').getContext('2d');
    let done = 0;
    const workerUrl = new URL('js/video-worker.js', document.baseURI).href;

    return new Promise((resolve, reject) => {
      const results = new Array(segs.length);
      let finished = 0, failed = false;
      const fail = (err) => { if (failed) return; failed = true; stopWorkers(); reject(err); };
      segs.forEach((seg, i) => {
        let w;
        try { w = new Worker(workerUrl); } catch (e) { fail(e); return; }
        activeWorkers.push(w);
        w.onerror = (e) => fail(new Error(e.message || '작업자 오류'));
        w.onmessage = (e) => {
          const m = e.data;
          if (myJob !== job) { stopWorkers(); resolve(null); return; }
          if (m.type === 'progress') { done += m.n; setProgress(0.97 * done / total); }
          else if (m.type === 'preview') { preview.drawImage(m.bmp, 0, 0, W, H); m.bmp.close(); }
          else if (m.type === 'error') fail(new Error(m.message));
          else if (m.type === 'done') {
            results[i] = m.chunks.map((c) => ({
              chunk: new EncodedVideoChunk({ type: c.type, timestamp: c.timestamp, duration: c.duration, data: c.data }),
              meta: c.decoderConfig ? { decoderConfig: c.decoderConfig } : undefined,
            }));
            w.terminate();
            if (++finished === segs.length) {
              activeWorkers = [];
              resolve(results);
            }
          }
        };
        w.postMessage({
          type: 'go', seed, picks, start: seg.start, end: seg.end,
          cfg: enc.cfg, width: OW, height: OH, view: arenaView(),
          fonts, text, preview: i === 0, base: document.baseURI,
        });
      });
    });
  }

  /* ----- 방법 2: 페이지에서 직접 (작업자를 못 쓰는 환경) ----- */
  async function encodeOnPage(enc, seed, total, k, myJob) {
    const segs = splitSegments(total, k).map(({ start, end }) => {
      const rng = C.mulberry32(seed);
      const canvas = C.makeCanvas(OW, OH);
      const g = C.newGame(defs, rng, canvas, arenaView());
      g.banner = { str: 'FIGHT!', life: 1.2, max: 1.2 };
      let endFrame = -1;
      for (let f = 1; f <= start; f++) {
        C.stepFrame(g, rng);
        if (g.ended && endFrame < 0) endFrame = f;
      }
      const seg = { start, end, f: start, g, rng, endFrame, canvas, out: [], err: null };
      seg.encoder = new VideoEncoder({
        output: (chunk, meta) => seg.out.push({ chunk, meta }),
        error: (e) => { seg.err = e; },
      });
      seg.encoder.configure(enc.cfg);
      return seg;
    });

    const frameDur = 1e6 / FPS;
    const preview = $('recCanvas').getContext('2d');
    let done = 0, lastYield = performance.now();
    const cleanup = () => segs.forEach((s) => { try { s.encoder.close(); } catch (e) { /* 이미 닫힘 */ } });

    while (done < total) {
      if (myJob !== job) { cleanup(); return null; }
      let progressed = false;
      for (const seg of segs) {
        if (seg.err) { cleanup(); throw seg.err; }
        if (seg.f >= seg.end || seg.encoder.encodeQueueSize > 3) continue;
        const f = seg.f, g = seg.g;
        if (f > seg.start) C.stepFrame(g, seg.rng);
        if (g.ended && seg.endFrame < 0) seg.endFrame = f;
        C.drawFrame(g, seg.endFrame >= 0 ? (f - seg.endFrame) / FPS : -1, seg.canvas);
        const frame = new VideoFrame(seg.canvas, { timestamp: Math.round(f * frameDur), duration: Math.round(frameDur) });
        seg.encoder.encode(frame, { keyFrame: f === seg.start || (f - seg.start) % (FPS * 2) === 0 });
        frame.close();
        seg.f++; done++; progressed = true;
      }
      const now = performance.now();
      if (!progressed || now - lastYield > 40) {
        if (now - lastYield > 40) {
          preview.drawImage(segs[0].f < segs[0].end ? segs[0].canvas : segs[segs.length - 1].canvas, 0, 0, W, H);
          setProgress(0.97 * done / total);
        }
        lastYield = now;
        await (progressed ? yieldNow() : new Promise((r) => setTimeout(r, 1)));
      }
    }
    await Promise.all(segs.map((s) => s.encoder.flush()));
    cleanup();
    for (const s of segs) if (s.err) throw s.err;
    if (myJob !== job) return null;
    return segs.map((s) => s.out);
  }

  function setProgress(p) {
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
    const sfx = window.SFX && window.SFX.live;
    const tap = sfx ? sfx.tapStream() : null;
    liveGame = new BallBattle.Game(arena, defs, {
      onSound: (name, t, o) => { if (sfx) sfx.play(name, o); },
      onEnd: () => { endAt = performance.now(); if (sfx) sfx.play('win'); },
      onFrame: (g) => {
        const t = endAt >= 0 ? (performance.now() - endAt) / 1000 : -1;
        C.drawFrame(g, t, $('recCanvas'));
        if (t >= OUTRO && !finishing) {
          finishing = true;
          stopLive();
        }
      },
    });
    liveGame.banner = { str: 'FIGHT!', life: 1.2, max: 1.2 };
    const mime = pickMime();
    const stream = $('recCanvas').captureStream(FPS);
    if (tap) tap.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const opts = { videoBitsPerSecond: BITRATE, audioBitsPerSecond: 192000 };
    if (mime) opts.mimeType = mime;
    try { liveRec = new MediaRecorder(stream, opts); } catch (e) { liveRec = new MediaRecorder(stream); }
    const type = liveRec.mimeType || mime || 'video/webm';
    liveRec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    liveRec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (tap) tap.close();
      noAudio = !tap;
      if (myJob !== job) return;
      ext = type.includes('mp4') ? 'mp4' : 'webm';
      blob = new Blob(chunks, { type: type.split(';')[0] });
      showSave();
    };
    C.drawFrame(liveGame, -1, $('recCanvas'));
    liveRec.start(1000);
    liveGame.start();
    if (sfx) sfx.play('fight');
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
    setProgress(0);
    fitView();
    await BallBattle.loadImages(defs);
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
    stopWorkers();
    stopLive();
    close();
  }

  function close() {
    job++;
    stopWorkers();
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
    v.muted = false;
    v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
    $('recInfo').textContent = `${ext.toUpperCase()} · ${(blob.size / 1048576).toFixed(1)}MB · `
      + (noAudio ? '효과음 없음 (이 브라우저는 소리를 영상에 넣지 못해요)' : '효과음 포함');
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
