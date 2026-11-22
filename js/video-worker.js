/* =========================================================
 * 영상 구간 작업자 (Web Worker)
 * 페이지가 맡긴 프레임 구간을 그리고 인코딩해서 돌려줍니다.
 * 작업자 여러 개가 같은 시드로 같은 전투를 계산하고, 각자 다른 구간을 맡습니다.
 * ========================================================= */
self.window = self;
importScripts('engine.js', 'skills.js', 'characters.js', 'video-core.js');

let cancelled = false;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'cancel') cancelled = true;
  if (m.type === 'go') run(m).catch((err) => {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  });
};

// 페이지에서 쓰는 웹폰트를 작업자에서도 불러옴 (실패하면 기본 글꼴로 그림)
async function loadFonts(rules, text) {
  if (!rules || !rules.length || !self.fonts || typeof FontFace === 'undefined') return;
  for (const r of rules) {
    try {
      const desc = {};
      if (r.weight) desc.weight = r.weight;
      if (r.style) desc.style = r.style;
      if (r.unicodeRange) desc.unicodeRange = r.unicodeRange;
      self.fonts.add(new FontFace(r.family, r.src, desc));
    } catch (e) { /* 이 글꼴은 건너뜀 */ }
  }
  const specs = ['400 40px "Black Han Sans"', '500 40px "Noto Sans KR"', '700 40px "Noto Sans KR"', '800 40px "Noto Sans KR"', '900 40px "Noto Sans KR"'];
  const loading = Promise.all(specs.map((s) => self.fonts.load(s, text).catch(() => null)));
  await Promise.race([loading, new Promise((r) => setTimeout(r, 1500))]);
}

async function run(m) {
  const C = self.VideoCore;
  await loadFonts(m.fonts, m.text);
  if (cancelled) return;

  const defs = m.picks.map((i) => self.CHARACTERS[i]);
  const rng = C.mulberry32(m.seed);
  const canvas = new OffscreenCanvas(m.width, m.height);
  const g = C.newGame(defs, rng, canvas, m.view);
  g.banner = { str: 'FIGHT!', life: 1.2, max: 1.2 };
  let endFrame = -1;
  for (let f = 1; f <= m.start; f++) {
    C.stepFrame(g, rng);
    if (g.ended && endFrame < 0) endFrame = f;
  }

  const chunks = [];
  const transfer = [];
  let encErr = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new ArrayBuffer(chunk.byteLength);
      chunk.copyTo(data);
      transfer.push(data);
      let decoderConfig = null;
      if (meta && meta.decoderConfig) {
        const dc = meta.decoderConfig;
        decoderConfig = { codec: dc.codec, codedWidth: dc.codedWidth, codedHeight: dc.codedHeight };
        if (dc.description) {
          const d = dc.description;
          const buf = d instanceof ArrayBuffer ? d.slice(0) : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
          decoderConfig.description = buf;
        }
        if (dc.colorSpace) {
          const cs = dc.colorSpace;
          decoderConfig.colorSpace = { primaries: cs.primaries, transfer: cs.transfer, matrix: cs.matrix, fullRange: cs.fullRange };
        }
      }
      chunks.push({ type: chunk.type, timestamp: chunk.timestamp, duration: chunk.duration, data, decoderConfig });
    },
    error: (e) => { encErr = e; },
  });
  encoder.configure(m.cfg);

  const frameDur = 1e6 / C.FPS;
  let sent = 0;
  for (let f = m.start; f < m.end; f++) {
    if (cancelled) { encoder.close(); return; }
    if (encErr) throw encErr;
    if (f > m.start) C.stepFrame(g, rng);
    if (g.ended && endFrame < 0) endFrame = f;
    C.drawFrame(g, endFrame >= 0 ? (f - endFrame) / C.FPS : -1, canvas);
    // 캔버스 내용을 복사하지 않고 넘김 (다음 프레임은 배경부터 다시 그림)
    const bmp = canvas.transferToImageBitmap();
    const frame = new VideoFrame(bmp, { timestamp: Math.round(f * frameDur), duration: Math.round(frameDur) });
    bmp.close();
    encoder.encode(frame, { keyFrame: f === m.start || (f - m.start) % (C.FPS * 2) === 0 });
    frame.close();
    while (encoder.encodeQueueSize > 3) await new Promise((r) => setTimeout(r, 0));
    const done = f - m.start + 1;
    if (done - sent >= 10) {
      self.postMessage({ type: 'progress', n: done - sent });
      sent = done;
    }
    if (m.preview && done % 20 === 0) {
      try {
        const bmp = await createImageBitmap(canvas);
        self.postMessage({ type: 'preview', bmp }, [bmp]);
      } catch (e) { /* 미리보기 생략 */ }
    }
  }
  await encoder.flush();
  encoder.close();
  if (encErr) throw encErr;
  self.postMessage({ type: 'progress', n: (m.end - m.start) - sent });
  self.postMessage({ type: 'done', chunks }, transfer);
}
