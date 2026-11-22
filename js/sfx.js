/* =========================================================
 * 효과음
 * 소리 파일 없이 Web Audio로 직접 합성합니다.
 * 같은 코드로 실시간 재생(AudioContext)과 영상용 렌더링(OfflineAudioContext)을 모두 합니다.
 *
 * 새 효과음 추가: 아래 VOICES에 이름: (ctx, out, t, o, r) => {...} 를 추가하고
 * 스킬에 sound: '이름' 을 적으면 됩니다.
 * ========================================================= */
(function () {
  'use strict';

  const noiseCache = new WeakMap();
  function noiseBuffer(ctx) {
    let b = noiseCache.get(ctx);
    if (b) return b;
    const len = Math.floor(ctx.sampleRate * 1.5);
    b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    let x = 0x12345678;
    for (let i = 0; i < len; i++) {
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      d[i] = ((x >>> 0) / 4294967296) * 2 - 1;
    }
    noiseCache.set(ctx, b);
    return b;
  }

  // 소리 하나 = 음원 → (필터) → 볼륨 곡선 → 출력
  function envGain(ctx, t, attack, peak, dur) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  function tone(ctx, out, t, o) {
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + (o.slide || o.dur));
    if (o.detune) osc.detune.setValueAtTime(o.detune, t);
    const g = envGain(ctx, t, o.attack || 0.004, o.gain, o.dur);
    let node = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter; f.frequency.value = o.ff || 2000; f.Q.value = o.q || 0.7;
      osc.connect(f); node = f;
    }
    node.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + o.dur + 0.05);
  }

  function noise(ctx, out, t, o) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'lowpass';
    f.frequency.setValueAtTime(o.f0 || 2000, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    f.Q.value = o.q || 0.7;
    const g = envGain(ctx, t, o.attack || 0.002, o.gain, o.dur);
    src.connect(f); f.connect(g); g.connect(out);
    const off = (o.offset || 0) % 1;
    src.start(t, off); src.stop(t + o.dur + 0.05);
  }

  // 금속성 울림 (배음이 정수배가 아님)
  function metal(ctx, out, t, base, dur, gain) {
    [1, 2.76, 5.4, 8.93].forEach((m, i) => {
      tone(ctx, out, t, { type: i ? 'sine' : 'triangle', f0: base * m, dur: dur / (1 + i * 0.6), gain: gain / (1 + i * 0.9), attack: 0.001 });
    });
  }

  const VOICES = {
    // 무기로 몸통 적중: 묵직한 타격 + 짧은 잡음
    hit(c, out, t, o, r) {
      const v = Math.min(1, 0.55 + (o.dmg || 8) / 25);
      tone(c, out, t, { f0: 170 * r, f1: 55, slide: 0.12, dur: 0.16, gain: 0.75 * v });
      noise(c, out, t, { filter: 'lowpass', f0: 3200, f1: 600, dur: 0.07, gain: 0.45 * v, offset: r });
    },
    // 투사체 적중
    phit(c, out, t, o, r) {
      tone(c, out, t, { f0: 260 * r, f1: 90, slide: 0.08, dur: 0.1, gain: 0.4 });
      noise(c, out, t, { filter: 'bandpass', f0: 1800 * r, q: 1.2, dur: 0.06, gain: 0.35, offset: r * 3 });
    },
    // 무기끼리 부딪힘
    clash(c, out, t, o, r) {
      metal(c, out, t, 1250 * r, 0.32, 0.22);
      noise(c, out, t, { filter: 'highpass', f0: 4000, dur: 0.03, gain: 0.25, offset: r * 5 });
    },
    // 무기로 투사체를 막음
    parry(c, out, t, o, r) {
      metal(c, out, t, 1900 * r, 0.18, 0.14);
    },
    // 보호막이 막음
    block(c, out, t, o, r) {
      tone(c, out, t, { type: 'triangle', f0: 900 * r, f1: 1400, dur: 0.12, gain: 0.16 });
      noise(c, out, t, { filter: 'bandpass', f0: 3000, q: 3, dur: 0.08, gain: 0.18, offset: r });
    },
    shoot(c, out, t, o, r) {
      tone(c, out, t, { type: 'triangle', f0: 950 * r, f1: 320, dur: 0.11, gain: 0.16 });
    },
    arrow(c, out, t, o, r) {
      noise(c, out, t, { filter: 'bandpass', f0: 2600 * r, f1: 900, q: 2, dur: 0.12, gain: 0.3, offset: r * 7 });
      tone(c, out, t, { type: 'sine', f0: 1400 * r, f1: 700, dur: 0.06, gain: 0.08 });
    },
    fire(c, out, t, o, r) {
      noise(c, out, t, { filter: 'lowpass', f0: 900 * r, f1: 2400, q: 1.5, dur: 0.22, gain: 0.35, attack: 0.03, offset: r * 2 });
      tone(c, out, t, { type: 'sine', f0: 180 * r, f1: 120, dur: 0.2, gain: 0.2 });
    },
    // 폭발
    boom(c, out, t, o, r) {
      const s = Math.max(0.6, Math.min(1.3, o.size || 1));
      noise(c, out, t, { filter: 'lowpass', f0: 2200, f1: 90, dur: 0.75 * s, gain: 0.75, offset: r * 4 });
      tone(c, out, t, { f0: 95 * r, f1: 32, slide: 0.45, dur: 0.6 * s, gain: 0.9 });
    },
    // 기본 스킬 발동음
    cast(c, out, t, o, r) {
      tone(c, out, t, { f0: 784 * r, dur: 0.3, gain: 0.14 });
      tone(c, out, t + 0.05, { f0: 1175 * r, dur: 0.35, gain: 0.12 });
      tone(c, out, t + 0.05, { type: 'triangle', f0: 1175 * r, dur: 0.15, gain: 0.05 });
    },
    heal(c, out, t, o, r) {
      [523, 659, 784, 1047].forEach((f, i) => tone(c, out, t + i * 0.055, { f0: f * r, dur: 0.32, gain: 0.12 }));
    },
    shield(c, out, t, o, r) {
      tone(c, out, t, { f0: 380 * r, f1: 900, dur: 0.28, gain: 0.16 });
      tone(c, out, t, { type: 'triangle', f0: 760 * r, f1: 1800, dur: 0.22, gain: 0.06 });
      noise(c, out, t, { filter: 'bandpass', f0: 1200, f1: 5000, q: 2, dur: 0.25, gain: 0.12, attack: 0.05, offset: r });
    },
    zap(c, out, t, o, r) {
      for (let i = 0; i < 6; i++) {
        const f = 180 + ((i * 7919 * r) % 1) * 900;
        tone(c, out, t + i * 0.035, { type: 'sawtooth', f0: f, f1: f * 0.5, dur: 0.05, gain: 0.1, filter: 'highpass', ff: 500 });
      }
      noise(c, out, t, { filter: 'highpass', f0: 3000, dur: 0.25, gain: 0.16, offset: r * 9 });
    },
    freeze(c, out, t, o, r) {
      [1568, 2093, 2637].forEach((f, i) => tone(c, out, t + i * 0.04, { f0: f * r, dur: 0.55, gain: 0.07 }));
      noise(c, out, t, { filter: 'highpass', f0: 6000, dur: 0.35, gain: 0.12, attack: 0.02, offset: r * 3 });
    },
    dash(c, out, t, o, r) {
      noise(c, out, t, { filter: 'bandpass', f0: 400 * r, f1: 2600, q: 1.4, dur: 0.26, gain: 0.4, attack: 0.03, offset: r * 6 });
    },
    teleport(c, out, t, o, r) {
      tone(c, out, t, { f0: 300 * r, f1: 1900, dur: 0.16, gain: 0.14 });
      tone(c, out, t + 0.1, { f0: 1900 * r, f1: 500, dur: 0.14, gain: 0.08 });
    },
    rage(c, out, t, o, r) {
      tone(c, out, t, { type: 'sawtooth', f0: 82 * r, dur: 0.55, gain: 0.22, filter: 'lowpass', ff: 700, attack: 0.03 });
      tone(c, out, t, { type: 'sawtooth', f0: 83.5 * r, dur: 0.55, gain: 0.22, filter: 'lowpass', ff: 700, attack: 0.03 });
    },
    revive(c, out, t, o, r) {
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(c, out, t + i * 0.06, { f0: f, dur: 0.5, gain: 0.11 }));
    },
    warn(c, out, t, o, r) {
      tone(c, out, t, { type: 'triangle', f0: 620, f1: 300, dur: 0.6, gain: 0.12 });
    },
    crit(c, out, t, o, r) {
      metal(c, out, t, 2200 * r, 0.16, 0.12);
      tone(c, out, t, { f0: 140, f1: 50, dur: 0.18, gain: 0.5 });
    },
    death(c, out, t, o, r) {
      tone(c, out, t, { type: 'triangle', f0: 520 * r, f1: 70, dur: 0.55, gain: 0.28 });
      noise(c, out, t, { filter: 'lowpass', f0: 1500, f1: 200, dur: 0.4, gain: 0.35, offset: r * 8 });
    },
    alarm(c, out, t) {
      for (let i = 0; i < 4; i++) {
        tone(c, out, t + i * 0.16, { type: 'square', f0: i % 2 ? 660 : 880, dur: 0.13, gain: 0.07, filter: 'lowpass', ff: 2500 });
      }
    },
    fight(c, out, t) {
      [110, 221, 331, 554].forEach((f, i) => tone(c, out, t, { f0: f, dur: 1.2 - i * 0.2, gain: 0.22 / (1 + i * 0.5), attack: 0.005 }));
      noise(c, out, t, { filter: 'bandpass', f0: 800, q: 1, dur: 0.12, gain: 0.25 });
    },
    win(c, out, t) {
      [523, 659, 784, 1047].forEach((f, i) => {
        tone(c, out, t + i * 0.12, { type: 'triangle', f0: f, dur: 0.24, gain: 0.13 });
        tone(c, out, t + i * 0.12, { f0: f * 2, dur: 0.18, gain: 0.04 });
      });
      [523, 659, 784, 1047].forEach((f) => tone(c, out, t + 0.52, { type: 'triangle', f0: f, dur: 1.3, gain: 0.08, attack: 0.02 }));
    },
  };

  // 같은 소리가 너무 촘촘하면 건너뜀 (소리가 뭉개지고 커지는 것을 막음)
  const MIN_GAP = { shoot: 0.06, arrow: 0.08, hit: 0.035, phit: 0.05, clash: 0.07, parry: 0.06, block: 0.08, boom: 0.06 };

  // 출력 단: 전체 볼륨 → 압축기(갑자기 커지는 소리를 눌러 줌)
  function createBus(ctx, destination, volume) {
    const input = ctx.createGain();
    input.gain.value = volume != null ? volume : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;
    input.connect(comp);
    comp.connect(destination);
    return input;
  }

  // 이벤트 목록 [{name, t, o}]을 정해진 시각에 예약
  function schedule(ctx, out, events, offset) {
    const last = {};
    let i = 0;
    for (const e of events) {
      const voice = VOICES[e.name] || VOICES.cast;
      const gap = MIN_GAP[e.name] || 0.02;
      if (last[e.name] != null && e.t - last[e.name] < gap) continue;
      last[e.name] = e.t;
      const r = 1 + ((((i++) * 0.6180339887) % 1) - 0.5) * 0.08; // 매번 음높이를 살짝 다르게
      voice(ctx, out, (offset || 0) + e.t, e.o || {}, r);
    }
  }

  /* ---------- 실시간 재생 (게임 화면) ---------- */
  const live = {
    ctx: null, bus: null, muted: false, last: {}, n: 0, taps: [],
    // 반드시 버튼을 누른 순간에 호출 (브라우저 자동재생 제한)
    unlock() {
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          this.ctx = new AC({ latencyHint: 'interactive' });
          this.bus = createBus(this.ctx, this.ctx.destination, 0.8);
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch (e) { this.ctx = null; }
    },
    play(name, o) {
      if (!this.ctx || this.ctx.state !== 'running') return;
      if (this.muted && !this.taps.length) return;
      const now = this.ctx.currentTime;
      const gap = MIN_GAP[name] || 0.02;
      if (this.last[name] != null && now - this.last[name] < gap) return;
      this.last[name] = now;
      const r = 1 + ((((this.n++) * 0.6180339887) % 1) - 0.5) * 0.08;
      const voice = VOICES[name] || VOICES.cast;
      if (!this.muted) voice(this.ctx, this.bus, now + 0.01, o || {}, r);
      for (const tap of this.taps) voice(this.ctx, tap, now + 0.01, o || {}, r);
    },
    // 녹화용 출력: 음소거와 관계없이 녹음되도록 별도 출력에도 같은 소리를 냄
    tapStream() {
      if (!this.ctx || !this.ctx.createMediaStreamDestination) return null;
      const dest = this.ctx.createMediaStreamDestination();
      const bus = createBus(this.ctx, dest, 0.8);
      this.taps.push(bus);
      return { stream: dest.stream, close: () => { this.taps = this.taps.filter((b) => b !== bus); try { bus.disconnect(); } catch (e) { /* 무시 */ } } };
    },
  };

  /* ---------- 영상용: 전체 효과음을 한 번에 렌더링 ---------- */
  async function renderOffline(events, duration, sampleRate) {
    const sr = sampleRate || 48000;
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return null;
    const len = Math.ceil((duration + 0.05) * sr);
    const ctx = new OAC(2, len, sr);
    const bus = createBus(ctx, ctx.destination, 0.8);
    schedule(ctx, bus, events, 0);
    const buf = await ctx.startRendering();
    // 마지막 안전장치: 최고 음량이 -1dB를 넘으면 전체를 줄여서 찢어지는 소리(클리핑)를 막음
    let peak = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
    }
    const limit = 0.891; // -1 dBFS
    if (peak > limit) {
      const k = limit / peak;
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < d.length; i++) d[i] *= k;
      }
    }
    return buf;
  }

  window.SFX = { live, renderOffline, VOICES, schedule, createBus };
})();
