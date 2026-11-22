/* =========================================================
 * Ball Battle 엔진
 * 물리(이동/충돌), 전투(무기/투사체/상태이상), 렌더링 담당.
 * 캐릭터/스킬을 추가할 때는 이 파일을 고칠 필요가 없습니다.
 *   - 캐릭터: js/characters.js
 *   - 스킬:   js/skills.js
 * ========================================================= */
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const STEP = 1 / 120; // 고정 시뮬레이션 간격(초)

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);

  function segPointDist(ax, ay, bx, by, px, py) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(ax + dx * t - px, ay + dy * t - py);
  }

  function segSegDist(a, b) {
    // a, b: [x1,y1,x2,y2]
    const d1x = a[2] - a[0], d1y = a[3] - a[1];
    const d2x = b[2] - b[0], d2y = b[3] - b[1];
    const den = d1x * d2y - d1y * d2x;
    if (den !== 0) {
      const t = ((b[0] - a[0]) * d2y - (b[1] - a[1]) * d2x) / den;
      const u = ((b[0] - a[0]) * d1y - (b[1] - a[1]) * d1x) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
    }
    return Math.min(
      segPointDist(a[0], a[1], a[2], a[3], b[0], b[1]),
      segPointDist(a[0], a[1], a[2], a[3], b[2], b[3]),
      segPointDist(b[0], b[1], b[2], b[3], a[0], a[1]),
      segPointDist(b[0], b[1], b[2], b[3], a[2], a[3])
    );
  }

  function shade(hex, amt) {
    // hex 색을 밝게(+) / 어둡게(-)
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map((x) => x + x).join('');
    const n = parseInt(c, 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = (v) => clamp(Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt), 0, 255);
    r = f(r); g = f(g); b = f(b);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  const WEAPON_DEFAULTS = {
    type: 'sword', length: 46, width: 8, damage: 8, spin: 4,
    knockback: 260, reverseOnHit: true, color: '#d9dde8',
  };

  /* ---------------- Ball ---------------- */
  class Ball {
    constructor(def, x, y, team) {
      this.def = def;
      this.name = def.name || '???';
      this.icon = def.icon || this.name.charAt(0);
      this.color = def.color || '#888888';
      this.r = def.radius || 26;
      this.maxHp = def.hp || 100;
      this.hp = this.maxHp;
      this.baseSpeed = def.speed != null ? def.speed : 200;
      this.x = x; this.y = y;
      const a = Math.random() * TAU;
      this.dx = Math.cos(a); this.dy = Math.sin(a); // 이동 방향(단위벡터)
      this.kx = 0; this.ky = 0; // 넉백/대시 속도
      this.team = team;
      this.alive = true;
      this.weapon = def.weapon && def.weapon.type !== 'none'
        ? Object.assign({}, WEAPON_DEFAULTS, def.weapon) : null;
      this.angle = Math.random() * TAU;
      this.spinDir = Math.random() < 0.5 ? 1 : -1;
      this.status = {};
      this.bonusDamage = 0;
      this.hitTimers = new Map();
      this.flash = 0;
      this.data = {}; // 커스텀 스킬이 자유롭게 쓰는 저장공간
      this.stats = { damageDealt: 0, kills: 0 };
      this.skills = (def.skills || []).map((s) => {
        const trig = s.trigger || 'cooldown';
        return {
          def: s,
          trigger: trig,
          timer: trig === 'cooldown'
            ? (s.firstDelay != null ? s.firstDelay : (s.cooldown || 3) * rand(0.35, 0.75))
            : 0,
          used: false,
        };
      });
    }

    get speed() {
      const st = this.status;
      if (st.stun) return 0;
      let s = this.baseSpeed;
      if (st.haste) s *= st.haste.mult;
      if (st.slow) s *= st.slow.factor;
      return s;
    }

    get damageMult() {
      return this.status.power ? this.status.power.mult : 1;
    }

    weaponSeg() {
      const w = this.weapon;
      const c = Math.cos(this.angle), s = Math.sin(this.angle);
      const r0 = this.r - 2, r1 = this.r + w.length;
      return [this.x + c * r0, this.y + s * r0, this.x + c * r1, this.y + s * r1];
    }
  }

  /* ---------------- Game ---------------- */
  class Game {
    constructor(canvas, defs, opts = {}) {
      this.cfg = Object.assign({
        arenaSize: 600, hitCooldown: 0.4, suddenDeathTime: 60, endDelay: 1.4, seek: 0.6,
      }, window.GAME_CONFIG || {}, opts.config || {});
      this.A = this.cfg.arenaSize;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.onEnd = opts.onEnd || (() => {});
      this.onFrame = opts.onFrame || null;
      this.speedMult = 1;
      this.paused = false;
      this.time = 0;
      this.globalMult = 1;
      this.suddenDeath = false;
      this.balls = [];
      this.projectiles = [];
      this.zones = [];
      this.timers = [];
      this.fx = { texts: [], parts: [], rings: [], bolts: [] };
      this.shakeAmt = 0;
      this.ended = false;
      this.endTimer = -1;
      this.banner = null;

      const n = defs.length;
      const A = this.A;
      const off = Math.random() * TAU;
      defs.forEach((def, i) => {
        const a = off + (i / n) * TAU;
        const rr = A * 0.32;
        const team = def.team != null ? def.team : i;
        this.balls.push(new Ball(def, A / 2 + Math.cos(a) * rr, A / 2 + Math.sin(a) * rr, team));
      });
      this._raf = null;
      this._last = 0;
      this._acc = 0;
    }

    /* ---------- 루프 ---------- */
    start() {
      this._stopped = false;
      this.balls.forEach((b) => this.fire(b, 'start', {}));
      this._last = performance.now();
      const loop = (now) => {
        let dt = (now - this._last) / 1000;
        this._last = now;
        if (dt > 0.1) dt = 0.1;
        if (!this.paused) {
          this._acc += dt * this.speedMult;
          let steps = 0;
          while (this._acc >= STEP && steps < 60) {
            this.update(STEP);
            this._acc -= STEP;
            steps++;
          }
          if (steps >= 60) this._acc = 0;
        }
        this.render();
        if (this.onFrame) this.onFrame(this);
        if (this._stopped) return;
        this._raf = requestAnimationFrame(loop);
      };
      this._raf = requestAnimationFrame(loop);
    }

    stop() {
      this._stopped = true;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
    }

    /* ---------- 스킬에서 쓰는 API ---------- */
    living() { return this.balls.filter((b) => b.alive); }
    enemiesOf(b) { return this.balls.filter((o) => o.alive && o.team !== b.team); }
    alliesOf(b) { return this.balls.filter((o) => o.alive && o.team === b.team && o !== b); }
    dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    nearestEnemy(b, from) {
      const p = from || b;
      let best = null, bd = Infinity;
      for (const o of this.enemiesOf(b)) {
        const d = Math.hypot(o.x - p.x, o.y - p.y);
        if (d < bd) { bd = d; best = o; }
      }
      return best;
    }
    randomEnemy(b) {
      const e = this.enemiesOf(b);
      return e.length ? e[(Math.random() * e.length) | 0] : null;
    }
    enemiesInRadius(b, x, y, radius) {
      return this.enemiesOf(b).filter((o) => Math.hypot(o.x - x, o.y - y) <= radius + o.r);
    }
    after(seconds, fn) { this.timers.push({ t: seconds, fn }); }

    damage(target, amount, source, opts = {}) {
      if (!target || !target.alive || amount <= 0) return 0;
      const kind = opts.kind || 'skill';
      let amt = amount * (source ? source.damageMult : 1) * this.globalMult;
      const st = target.status;
      if (st.invincible) {
        this.text(target.x, target.y - target.r - 10, '무적', '#ffe38a', 14);
        return 0;
      }
      if (st.shield) {
        const absorbed = Math.min(st.shield.amount, amt);
        st.shield.amount -= absorbed;
        amt -= absorbed;
        if (st.shield.amount <= 0) delete st.shield;
        if (absorbed > 0 && amt <= 0) {
          this.text(target.x, target.y - target.r - 10, '막음', '#7fe3ff', 14);
          return 0;
        }
      }
      amt = Math.round(amt * 10) / 10;
      target.hp -= amt;
      target.flash = 0.12;
      if (source) source.stats.damageDealt += amt;
      const shown = amt >= 10 ? Math.round(amt) : amt.toFixed(amt % 1 ? 1 : 0);
      this.text(target.x + rand(-10, 10), target.y - target.r - 6, shown,
        opts.color || (kind === 'burn' ? '#ff9b4a' : '#ffffff'), kind === 'burn' ? 13 : 15 + Math.min(amt, 30) * 0.35);
      if (kind !== 'burn') this.particles(target.x, target.y, target.color, 6, 160);

      const ctx = { target, source, amount: amt, kind };
      if (source && source !== target && (kind === 'weapon' || kind === 'projectile')) {
        this.fire(source, 'onHit', ctx);
      }
      if (kind !== 'burn' && kind !== 'thorns') this.fire(target, 'onDamaged', ctx);
      if (target.hp > 0) {
        for (const sk of target.skills) {
          if (sk.trigger === 'lowHp' && !sk.used && target.hp / target.maxHp <= (sk.def.hpBelow || 0.3)) {
            sk.used = true;
            this.cast(target, sk, ctx);
          }
        }
      } else {
        this.kill(target, source);
      }
      return amt;
    }

    heal(b, amount, quiet) {
      if (!b.alive) return 0;
      const h = Math.min(amount, b.maxHp - b.hp);
      if (h <= 0) return 0;
      b.hp += h;
      if (!quiet || h >= 3) this.text(b.x, b.y - b.r - 8, '+' + Math.round(h), '#6dff9c', 14);
      return h;
    }

    shoot(owner, o = {}) {
      let angle = o.angle;
      if (angle == null) {
        const t = o.target || this.nearestEnemy(owner);
        angle = t ? Math.atan2(t.y - owner.y, t.x - owner.x) : Math.random() * TAU;
      }
      const speed = o.speed || 400;
      const r = o.radius || 7;
      const p = {
        x: owner.x + Math.cos(angle) * (owner.r + r + 2),
        y: owner.y + Math.sin(angle) * (owner.r + r + 2),
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        speed, r, owner, team: owner.team,
        damage: o.damage != null ? o.damage : 6,
        color: o.color || owner.color,
        life: o.life || 3,
        pierce: !!o.pierce, bounce: o.bounce || 0, homing: o.homing || 0,
        blockable: o.blockable !== false,
        shape: o.shape || 'orb',
        onHit: o.onHit || null,
        hit: new Set(),
        trail: [],
      };
      this.projectiles.push(p);
      return p;
    }

    explode(x, y, radius, damage, owner, o = {}) {
      this.ring(x, y, radius, o.color || '#ffb347');
      this.particles(x, y, o.color || '#ffb347', 18, 300);
      this.shake(Math.min(10, radius / 15));
      const hits = owner ? this.enemiesInRadius(owner, x, y, radius)
        : this.living().filter((b) => Math.hypot(b.x - x, b.y - y) <= radius + b.r);
      for (const t of hits) {
        this.damage(t, damage, owner, { kind: o.kind || 'skill' });
        const d = Math.hypot(t.x - x, t.y - y) || 1;
        const kb = o.knockback != null ? o.knockback : 350;
        t.kx += ((t.x - x) / d) * kb;
        t.ky += ((t.y - y) / d) * kb;
        if (o.onHit) o.onHit(t);
      }
      return hits;
    }

    zone(o) {
      const z = Object.assign({ radius: 60, dps: 5, duration: 4, color: '#9dff5c', slow: 0 }, o);
      z.life = z.duration; z.tick = 0;
      this.zones.push(z);
      return z;
    }

    addStatus(b, name, props = {}) {
      const cur = b.status[name];
      if (name === 'shield' && cur) {
        cur.amount += props.amount || 0;
        cur.time = Math.max(cur.time, props.time || 0);
        return cur;
      }
      b.status[name] = Object.assign({ tick: 0 }, cur || {}, props);
      return b.status[name];
    }

    announce(b, label, color) {
      this.text(b.x, b.y - b.r - 28, label, color || '#ffd23f', 15, 1.1, true);
    }

    text(x, y, str, color, size = 15, life = 0.8, bold) {
      this.fx.texts.push({ x, y, str: String(str), color, size, life, max: life, bold });
    }

    particles(x, y, color, count = 8, speed = 200) {
      if (this.fx.parts.length > 700) return;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * TAU, s = Math.random() * speed;
        this.fx.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.25, 0.6), max: 0.6, color, size: rand(2, 4.5) });
      }
    }

    ring(x, y, radius, color, life = 0.4) {
      this.fx.rings.push({ x, y, r: radius, color, life, max: life });
    }

    bolt(points, color = '#bfe6ff', life = 0.25) {
      this.fx.bolts.push({ pts: points, color, life, max: life, seed: Math.random() * 1000 });
    }

    shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); }

    /* ---------- 스킬 실행 ---------- */
    cast(b, sk, ctx) {
      if (!b.alive && sk.trigger !== 'onDeath') return false;
      let res;
      try {
        res = sk.def.cast ? sk.def.cast(b, this, ctx || {}) : undefined;
      } catch (e) {
        console.error('[스킬 오류]', sk.def.name, e);
        res = false;
      }
      if (res === false) return false;
      if (!sk.def.silent) this.announce(b, (sk.def.name || '스킬') + '!', sk.def.color);
      return true;
    }

    fire(b, trigger, ctx) {
      for (const sk of b.skills) {
        if (sk.trigger !== trigger) continue;
        if (sk.timer > 0) continue;
        if (trigger === 'start' && sk.used) continue;
        if (sk.def.chance != null && Math.random() > sk.def.chance) continue;
        if (this.cast(b, sk, ctx)) {
          sk.timer = sk.def.cooldown || 0;
          if (trigger === 'start') sk.used = true;
        }
      }
    }

    kill(b, source) {
      for (const sk of b.skills) {
        if (sk.trigger === 'onDeath' && !sk.used) {
          sk.used = true;
          this.cast(b, sk, { source });
          if (b.hp > 0) return; // 부활 등으로 사망 취소
        }
      }
      b.alive = false;
      b.hp = 0;
      this.particles(b.x, b.y, b.color, 40, 380);
      this.ring(b.x, b.y, b.r * 3, b.color, 0.6);
      this.shake(12);
      this.text(b.x, b.y, '탈락!', '#ff5d5d', 22, 1.2, true);
      if (source && source !== b && source.alive) {
        source.stats.kills++;
        this.fire(source, 'onKill', { target: b });
      }
    }

    /* ---------- 업데이트 ---------- */
    update(dt) {
      if (this.ended) return;
      this.time += dt;
      const A = this.A;

      // 서든데스
      if (this.cfg.suddenDeathTime > 0 && this.time >= this.cfg.suddenDeathTime) {
        const lv = 1 + Math.floor((this.time - this.cfg.suddenDeathTime) / 10);
        const m = 1 + lv * 0.5;
        if (!this.suddenDeath || m !== this.globalMult) {
          this.banner = { str: `서든데스! 피해 x${m}`, life: 2, max: 2 };
        }
        this.suddenDeath = true;
        this.globalMult = m;
      }

      // 예약된 동작
      for (let i = this.timers.length - 1; i >= 0; i--) {
        const t = this.timers[i];
        t.t -= dt;
        if (t.t <= 0) { this.timers.splice(i, 1); try { t.fn(); } catch (e) { console.error(e); } }
      }

      const balls = this.balls;
      for (const b of balls) {
        if (!b.alive) continue;
        // 스킬 쿨다운
        for (const sk of b.skills) {
          if (sk.timer > 0) sk.timer -= dt;
        }
        if (!b.status.stun && this.enemiesOf(b).length) this.fire(b, 'cooldown', {});

        // 상태이상
        for (const k in b.status) {
          const s = b.status[k];
          if (s.time != null) {
            s.time -= dt;
            if (s.time <= 0) { delete b.status[k]; continue; }
          }
          if (k === 'burn' || k === 'poison') {
            s.tick += dt;
            if (s.tick >= 0.5) {
              s.tick -= 0.5;
              this.damage(b, s.dps * 0.5, s.source && s.source.alive ? s.source : null, { kind: 'burn', color: k === 'poison' ? '#b6ff6a' : '#ff9b4a' });
              if (!b.alive) break;
            }
          }
          if (k === 'regen') {
            s.tick += dt;
            if (s.tick >= 0.5) { s.tick -= 0.5; this.heal(b, s.hps * 0.5, true); }
          }
        }
        if (!b.alive) continue;

        // 이동 (가장 가까운 적 쪽으로 살짝 방향을 틂)
        const seek = b.def.seek != null ? b.def.seek : this.cfg.seek;
        if (seek > 0) {
          const t = this.nearestEnemy(b);
          if (t) {
            const want = Math.atan2(t.y - b.y, t.x - b.x);
            let cur = Math.atan2(b.dy, b.dx);
            const diff = ((want - cur + Math.PI * 3) % TAU) - Math.PI;
            cur += clamp(diff, -seek * dt, seek * dt);
            b.dx = Math.cos(cur); b.dy = Math.sin(cur);
          }
        }
        const sp = b.speed;
        b.x += (b.dx * sp + b.kx) * dt;
        b.y += (b.dy * sp + b.ky) * dt;
        const decay = Math.exp(-4 * dt);
        b.kx *= decay; b.ky *= decay;

        // 벽
        if (b.x < b.r) { b.x = b.r; b.dx = Math.abs(b.dx); b.kx = Math.abs(b.kx); }
        if (b.x > A - b.r) { b.x = A - b.r; b.dx = -Math.abs(b.dx); b.kx = -Math.abs(b.kx); }
        if (b.y < b.r) { b.y = b.r; b.dy = Math.abs(b.dy); b.ky = Math.abs(b.ky); }
        if (b.y > A - b.r) { b.y = A - b.r; b.dy = -Math.abs(b.dy); b.ky = -Math.abs(b.ky); }

        // 무기 회전
        if (b.weapon && !b.status.stun) {
          const hm = b.status.haste ? Math.sqrt(b.status.haste.mult) : 1;
          b.angle += b.weapon.spin * b.spinDir * dt * hm;
        }
        if (b.flash > 0) b.flash -= dt;
        for (const [k, v] of b.hitTimers) {
          if (v - dt <= 0) b.hitTimers.delete(k); else b.hitTimers.set(k, v - dt);
        }
      }

      // 공끼리 충돌 (튕기기 + 대시 피해)
      for (let i = 0; i < balls.length; i++) {
        const a = balls[i];
        if (!a.alive) continue;
        for (let j = i + 1; j < balls.length; j++) {
          const b = balls[j];
          if (!b.alive) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy);
          const min = a.r + b.r;
          if (d >= min || d === 0) continue;
          const nx = dx / d, ny = dy / d;
          const overlap = (min - d) / 2;
          a.x -= nx * overlap; a.y -= ny * overlap;
          b.x += nx * overlap; b.y += ny * overlap;
          // 방향 반사 (질량 동일 탄성충돌 후 방향만 유지)
          const sa = a.speed || 1, sb = b.speed || 1;
          let avx = a.dx * sa + a.kx, avy = a.dy * sa + a.ky;
          let bvx = b.dx * sb + b.kx, bvy = b.dy * sb + b.ky;
          const an = avx * nx + avy * ny, bn = bvx * nx + bvy * ny;
          if (an - bn > 0) {
            avx += (bn - an) * nx; avy += (bn - an) * ny;
            bvx += (an - bn) * nx; bvy += (an - bn) * ny;
          }
          let la = Math.hypot(avx, avy), lb = Math.hypot(bvx, bvy);
          if (la > 0.001) { a.dx = avx / la; a.dy = avy / la; }
          if (lb > 0.001) { b.dx = bvx / lb; b.dy = bvy / lb; }
          a.kx *= 0.3; a.ky *= 0.3; b.kx *= 0.3; b.ky *= 0.3;
          if (a.team !== b.team) {
            this.dashHit(a, b, nx, ny);
            this.dashHit(b, a, -nx, -ny);
          }
        }
      }

      // 무기 충돌
      for (const a of balls) {
        if (!a.alive || !a.weapon || a.status.stun) continue;
        const sa = a.weaponSeg();
        for (const b of balls) {
          if (b === a || !b.alive || b.team === a.team) continue;
          // 무기 vs 무기
          if (b.weapon && !b.status.stun && balls.indexOf(b) > balls.indexOf(a)) {
            const sb = b.weaponSeg();
            if (segSegDist(sa, sb) < (a.weapon.width + b.weapon.width) / 2 && !a.hitTimers.has('clash' + balls.indexOf(b))) {
              a.spinDir *= -1; b.spinDir *= -1;
              a.hitTimers.set('clash' + balls.indexOf(b), 0.2);
              const mx = (sa[2] + sb[2]) / 2, my = (sa[3] + sb[3]) / 2;
              this.particles(mx, my, '#fff4c2', 8, 260);
              continue;
            }
          }
          // 무기 vs 공
          if (a.hitTimers.has(b)) continue;
          if (segPointDist(sa[0], sa[1], sa[2], sa[3], b.x, b.y) < b.r + a.weapon.width / 2) {
            a.hitTimers.set(b, this.cfg.hitCooldown);
            const dmg = a.weapon.damage + a.bonusDamage;
            const d = this.dist(a, b) || 1;
            b.kx += ((b.x - a.x) / d) * a.weapon.knockback;
            b.ky += ((b.y - a.y) / d) * a.weapon.knockback;
            if (a.weapon.reverseOnHit) a.spinDir *= -1;
            this.damage(b, dmg, a, { kind: 'weapon' });
            if (a.weapon.onHit && b.alive) a.weapon.onHit(b, a, this);
            this.shake(Math.min(6, dmg / 3));
          }
        }
      }

      // 투사체
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const p = this.projectiles[i];
        p.life -= dt;
        if (p.homing) {
          const t = this.nearestEnemy(p.owner, p);
          if (t) {
            const want = Math.atan2(t.y - p.y, t.x - p.x);
            let cur = Math.atan2(p.vy, p.vx);
            let diff = ((want - cur + Math.PI * 3) % TAU) - Math.PI;
            cur += clamp(diff, -p.homing * dt, p.homing * dt);
            p.vx = Math.cos(cur) * p.speed; p.vy = Math.sin(cur) * p.speed;
          }
        }
        p.trail.push(p.x, p.y);
        if (p.trail.length > 12) p.trail.splice(0, 2);
        p.x += p.vx * dt; p.y += p.vy * dt;
        let dead = p.life <= 0;
        if (p.x < p.r || p.x > A - p.r) {
          if (p.bounce > 0) { p.bounce--; p.vx *= -1; p.x = clamp(p.x, p.r, A - p.r); } else dead = true;
        }
        if (p.y < p.r || p.y > A - p.r) {
          if (p.bounce > 0) { p.bounce--; p.vy *= -1; p.y = clamp(p.y, p.r, A - p.r); } else dead = true;
        }
        if (!dead) {
          for (const b of balls) {
            if (!b.alive || b.team === p.team) continue;
            // 무기로 막기
            if (p.blockable && b.weapon && !b.status.stun) {
              const s = b.weaponSeg();
              if (segPointDist(s[0], s[1], s[2], s[3], p.x, p.y) < p.r + b.weapon.width / 2) {
                this.particles(p.x, p.y, '#fff4c2', 6, 200);
                dead = true;
                break;
              }
            }
            if (p.hit.has(b)) continue;
            if (Math.hypot(b.x - p.x, b.y - p.y) < b.r + p.r) {
              p.hit.add(b);
              this.damage(b, p.damage, p.owner, { kind: 'projectile' });
              const kb = 120;
              b.kx += (p.vx / p.speed) * kb; b.ky += (p.vy / p.speed) * kb;
              if (p.onHit) { try { p.onHit(b, p, this); } catch (e) { console.error(e); } }
              if (!p.pierce) { dead = true; break; }
            }
          }
        }
        if (dead) {
          this.particles(p.x, p.y, p.color, 4, 120);
          this.projectiles.splice(i, 1);
        }
      }

      // 장판
      for (let i = this.zones.length - 1; i >= 0; i--) {
        const z = this.zones[i];
        z.life -= dt;
        z.tick += dt;
        if (z.tick >= 0.5) {
          z.tick -= 0.5;
          const targets = z.owner ? this.enemiesInRadius(z.owner, z.x, z.y, z.radius)
            : this.living().filter((b) => Math.hypot(b.x - z.x, b.y - z.y) <= z.radius + b.r);
          for (const t of targets) {
            if (z.dps) this.damage(t, z.dps * 0.5, z.owner && z.owner.alive ? z.owner : null, { kind: 'burn', color: z.color });
            if (z.slow && t.alive) this.addStatus(t, 'slow', { time: 0.6, factor: z.slow });
            if (z.onTick && t.alive) z.onTick(t, z, this);
          }
        }
        if (z.life <= 0) this.zones.splice(i, 1);
      }

      // 이펙트
      const F = this.fx;
      for (let i = F.texts.length - 1; i >= 0; i--) {
        const t = F.texts[i]; t.life -= dt; t.y -= 34 * dt;
        if (t.life <= 0) F.texts.splice(i, 1);
      }
      for (let i = F.parts.length - 1; i >= 0; i--) {
        const p = F.parts[i]; p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96;
        if (p.life <= 0) F.parts.splice(i, 1);
      }
      for (const k of ['rings', 'bolts']) {
        for (let i = F[k].length - 1; i >= 0; i--) { F[k][i].life -= dt; if (F[k][i].life <= 0) F[k].splice(i, 1); }
      }
      if (this.banner) { this.banner.life -= dt; if (this.banner.life <= 0) this.banner = null; }
      this.shakeAmt *= Math.exp(-10 * dt);

      // 승리 판정
      const teams = new Set(this.living().map((b) => b.team));
      if (teams.size <= 1 && this.endTimer < 0) this.endTimer = this.cfg.endDelay;
      if (this.endTimer >= 0) {
        this.endTimer -= dt;
        if (this.endTimer <= 0) {
          this.ended = true;
          const alive = this.living();
          this.onEnd(alive.length ? alive : [], this);
        }
      }
    }

    dashHit(a, b, nx, ny) {
      const d = a.status.dashing;
      if (!d || d.hit.has(b)) return;
      d.hit.add(b);
      this.damage(b, d.damage, a, { kind: 'weapon' });
      b.kx += nx * 420; b.ky += ny * 420;
      this.shake(6);
    }

    /* ---------- 렌더링 ---------- */
    resize(cssSize) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      this.canvas.style.width = cssSize + 'px';
      this.canvas.style.height = cssSize + 'px';
      this.canvas.width = Math.round(cssSize * dpr);
      this.canvas.height = Math.round(cssSize * dpr);
    }

    render() {
      const ctx = this.ctx, A = this.A;
      const s = this.canvas.width / A;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      const sx = (Math.random() - 0.5) * this.shakeAmt, sy = (Math.random() - 0.5) * this.shakeAmt;
      ctx.setTransform(s, 0, 0, s, sx * s, sy * s);

      // 바닥
      ctx.fillStyle = this.suddenDeath ? '#24161a' : '#171b26';
      ctx.fillRect(0, 0, A, A);
      ctx.strokeStyle = this.suddenDeath ? 'rgba(255,90,90,0.08)' : 'rgba(150,170,220,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let g = 50; g < A; g += 50) { ctx.moveTo(g, 0); ctx.lineTo(g, A); ctx.moveTo(0, g); ctx.lineTo(A, g); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(150,170,220,0.12)';
      ctx.beginPath(); ctx.arc(A / 2, A / 2, 70, 0, TAU); ctx.stroke();
      ctx.strokeStyle = this.suddenDeath ? '#ff5a5a' : '#3a4462';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, A - 4, A - 4);

      // 장판
      for (const z of this.zones) {
        const fade = Math.min(1, z.life / 0.4);
        ctx.globalAlpha = 0.22 * fade;
        ctx.fillStyle = z.color;
        ctx.beginPath(); ctx.arc(z.x, z.y, z.radius, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.6 * fade;
        ctx.strokeStyle = z.color; ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.arc(z.x, z.y, z.radius, this.time * 0.8, this.time * 0.8 + TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      // 예고 표시 (meteor 등)
      for (const t of this.timers) {
        if (!t.warn) continue;
        ctx.globalAlpha = 0.35 + 0.25 * Math.sin(this.time * 20);
        ctx.strokeStyle = t.warn.color || '#ff5a5a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(t.warn.x, t.warn.y, t.warn.r, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 0.12; ctx.fillStyle = t.warn.color || '#ff5a5a'; ctx.fill();
        ctx.globalAlpha = 1;
      }

      // 투사체
      for (const p of this.projectiles) {
        if (p.trail.length > 2) {
          ctx.strokeStyle = p.color; ctx.lineCap = 'round';
          for (let i = 2; i < p.trail.length; i += 2) {
            ctx.globalAlpha = (i / p.trail.length) * 0.5;
            ctx.lineWidth = p.r * (i / p.trail.length) * 1.4;
            ctx.beginPath(); ctx.moveTo(p.trail[i - 2], p.trail[i - 1]); ctx.lineTo(p.trail[i], p.trail[i + 1]); ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        if (p.shape === 'arrow') {
          const a = Math.atan2(p.vy, p.vx);
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(a);
          ctx.strokeStyle = '#d8c8a8'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.moveTo(-p.r * 2.4, 0); ctx.lineTo(p.r, 0); ctx.stroke();
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.moveTo(p.r * 1.8, 0); ctx.lineTo(p.r * 0.3, -p.r * 0.8); ctx.lineTo(p.r * 0.3, p.r * 0.8); ctx.fill();
          ctx.restore();
        } else {
          ctx.fillStyle = p.color;
          ctx.shadowColor = p.color; ctx.shadowBlur = 12;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.45, 0, TAU); ctx.fill();
        }
      }

      // 공 + 무기
      for (const b of this.balls) if (b.alive) this.drawWeapon(b);
      for (const b of this.balls) if (b.alive) this.drawBall(b);

      // 번개
      for (const bo of this.fx.bolts) {
        ctx.globalAlpha = bo.life / bo.max;
        ctx.strokeStyle = bo.color; ctx.lineWidth = 3; ctx.shadowColor = bo.color; ctx.shadowBlur = 14;
        ctx.beginPath();
        for (let i = 0; i < bo.pts.length - 1; i++) {
          const [x1, y1] = bo.pts[i], [x2, y2] = bo.pts[i + 1];
          ctx.moveTo(x1, y1);
          const segs = 6;
          for (let k = 1; k <= segs; k++) {
            const t = k / segs;
            const j = k === segs ? 0 : (Math.sin(bo.seed + k * 7.3 + i * 3.1 + this.time * 60) * 12);
            const nx = -(y2 - y1), ny = x2 - x1, nl = Math.hypot(nx, ny) || 1;
            ctx.lineTo(x1 + (x2 - x1) * t + (nx / nl) * j, y1 + (y2 - y1) * t + (ny / nl) * j);
          }
        }
        ctx.stroke(); ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      }

      // 링
      for (const r of this.fx.rings) {
        const t = 1 - r.life / r.max;
        ctx.globalAlpha = (1 - t) * 0.8;
        ctx.strokeStyle = r.color; ctx.lineWidth = 4 * (1 - t) + 1;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.r * (0.35 + 0.65 * t), 0, TAU); ctx.stroke();
        ctx.globalAlpha = (1 - t) * 0.15; ctx.fillStyle = r.color; ctx.fill();
        ctx.globalAlpha = 1;
      }

      // 파티클
      for (const p of this.fx.parts) {
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx.globalAlpha = 1;

      // 글자
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const t of this.fx.texts) {
        ctx.globalAlpha = Math.min(1, t.life / t.max * 2);
        ctx.font = `${t.bold ? 900 : 800} ${t.size}px "Noto Sans KR", system-ui, sans-serif`;
        ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(10,12,20,0.85)';
        ctx.strokeText(t.str, t.x, t.y);
        ctx.fillStyle = t.color; ctx.fillText(t.str, t.x, t.y);
      }
      ctx.globalAlpha = 1;

      if (this.banner) {
        const b = this.banner;
        ctx.globalAlpha = Math.min(1, b.life / 0.3);
        ctx.font = `400 34px "Black Han Sans", "Noto Sans KR", sans-serif`;
        ctx.lineWidth = 6; ctx.strokeStyle = '#120a0c';
        ctx.strokeText(b.str, A / 2, A / 2);
        ctx.fillStyle = '#ff6b6b'; ctx.fillText(b.str, A / 2, A / 2);
        ctx.globalAlpha = 1;
      }
    }

    drawWeapon(b) {
      const w = b.weapon;
      if (!w) return;
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);
      const r0 = b.r - 2, L = w.length, W = w.width;
      const col = w.color;
      ctx.lineCap = 'round';
      switch (w.type) {
        case 'spear':
          ctx.strokeStyle = '#8a6a44'; ctx.lineWidth = W * 0.55;
          ctx.beginPath(); ctx.moveTo(r0, 0); ctx.lineTo(r0 + L - 14, 0); ctx.stroke();
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.moveTo(r0 + L, 0); ctx.lineTo(r0 + L - 18, -W * 0.9); ctx.lineTo(r0 + L - 18, W * 0.9); ctx.closePath(); ctx.fill();
          break;
        case 'hammer':
          ctx.strokeStyle = '#7a5a3a'; ctx.lineWidth = W * 0.5;
          ctx.beginPath(); ctx.moveTo(r0, 0); ctx.lineTo(r0 + L - 6, 0); ctx.stroke();
          ctx.fillStyle = col; ctx.strokeStyle = shade(col, -0.4); ctx.lineWidth = 2;
          ctx.beginPath(); ctx.rect(r0 + L - 16, -W * 1.6, 16, W * 3.2); ctx.fill(); ctx.stroke();
          break;
        case 'axe':
          ctx.strokeStyle = '#7a5a3a'; ctx.lineWidth = W * 0.5;
          ctx.beginPath(); ctx.moveTo(r0, 0); ctx.lineTo(r0 + L, 0); ctx.stroke();
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.moveTo(r0 + L - 22, 0); ctx.quadraticCurveTo(r0 + L - 6, -W * 2.6, r0 + L + 2, -W * 2); ctx.lineTo(r0 + L + 2, W * 0.3); ctx.lineTo(r0 + L - 4, W * 0.3); ctx.closePath(); ctx.fill();
          break;
        case 'dagger':
          ctx.fillStyle = '#4a4f5e'; ctx.fillRect(r0, -W * 0.35, 10, W * 0.7);
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.moveTo(r0 + 10, -W * 0.55); ctx.lineTo(r0 + L, 0); ctx.lineTo(r0 + 10, W * 0.55); ctx.closePath(); ctx.fill();
          break;
        case 'staff':
          ctx.strokeStyle = '#6b4e2e'; ctx.lineWidth = W * 0.55;
          ctx.beginPath(); ctx.moveTo(r0, 0); ctx.lineTo(r0 + L - W, 0); ctx.stroke();
          ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 12;
          ctx.beginPath(); ctx.arc(r0 + L - W * 0.6, 0, W * 0.9, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
          break;
        case 'scythe':
          ctx.strokeStyle = '#3d3347'; ctx.lineWidth = W * 0.5;
          ctx.beginPath(); ctx.moveTo(r0, 0); ctx.lineTo(r0 + L, 0); ctx.stroke();
          ctx.strokeStyle = col; ctx.lineWidth = W * 0.8;
          ctx.beginPath(); ctx.arc(r0 + L - 18, -2, 20, -0.2, -Math.PI * 0.95, true); ctx.stroke();
          break;
        default: // sword
          ctx.fillStyle = '#5b4632'; ctx.fillRect(r0, -W * 0.3, 10, W * 0.6);
          ctx.fillStyle = '#c9a24a'; ctx.fillRect(r0 + 9, -W * 1.1, 4, W * 2.2);
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.moveTo(r0 + 13, -W * 0.5); ctx.lineTo(r0 + L - 8, -W * 0.5); ctx.lineTo(r0 + L, 0); ctx.lineTo(r0 + L - 8, W * 0.5); ctx.lineTo(r0 + 13, W * 0.5); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(r0 + 14, 0); ctx.lineTo(r0 + L - 6, 0); ctx.stroke();
      }
      ctx.restore();
    }

    drawBall(b) {
      const ctx = this.ctx, st = b.status;
      const t = this.time;
      // 오라
      if (st.power) {
        ctx.globalAlpha = 0.35 + 0.15 * Math.sin(t * 12);
        ctx.fillStyle = '#ff3b3b';
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 8, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (st.haste) {
        ctx.globalAlpha = 0.3; ctx.strokeStyle = '#7dfcff'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(b.x - b.dx * b.r * 2, b.y - b.dy * b.r * 2); ctx.lineTo(b.x - b.dx * b.r * 3.5, b.y - b.dy * b.r * 3.5); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (st.burn && Math.random() < 0.3) this.fx.parts.push({ x: b.x + rand(-b.r, b.r) * 0.7, y: b.y + rand(-b.r, b.r) * 0.7, vx: 0, vy: -60, life: 0.4, max: 0.4, color: '#ff8a3a', size: 4 });
      if (st.poison && Math.random() < 0.3) this.fx.parts.push({ x: b.x + rand(-b.r, b.r) * 0.7, y: b.y + rand(-b.r, b.r) * 0.7, vx: 0, vy: -40, life: 0.4, max: 0.4, color: '#a6ff4d', size: 4 });

      // 몸통
      const g = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.1, b.x, b.y, b.r);
      g.addColorStop(0, shade(b.color, 0.35));
      g.addColorStop(1, shade(b.color, -0.25));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = shade(b.color, -0.5); ctx.stroke();
      if (b.flash > 0) {
        ctx.globalAlpha = b.flash / 0.12 * 0.7; ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      }
      if (st.stun) {
        ctx.fillStyle = 'rgba(160,220,255,0.45)';
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      }

      // 아이콘/글자
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `400 ${Math.round(b.r * 0.95)}px "Black Han Sans", "Noto Sans KR", sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillText(b.icon, b.x, b.y + 1);

      // 보호막/무적
      if (st.shield) {
        ctx.strokeStyle = '#7fe3ff'; ctx.lineWidth = 3; ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 5, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      }
      if (st.invincible) {
        ctx.strokeStyle = '#ffe38a'; ctx.lineWidth = 3; ctx.globalAlpha = 0.5 + 0.4 * Math.sin(t * 25);
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 7, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      }
      if (st.stun) {
        ctx.fillStyle = '#ffe14d';
        for (let i = 0; i < 3; i++) {
          const a = t * 5 + (i * TAU) / 3;
          ctx.beginPath(); ctx.arc(b.x + Math.cos(a) * b.r * 0.8, b.y - b.r - 6 + Math.sin(a) * 4, 3, 0, TAU); ctx.fill();
        }
      }

      // HP 바
      const w = Math.max(44, b.r * 2), h = 6;
      const x = b.x - w / 2, y = b.y - b.r - 14;
      ctx.fillStyle = 'rgba(8,10,16,0.75)';
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      const ratio = clamp(b.hp / b.maxHp, 0, 1);
      ctx.fillStyle = ratio > 0.5 ? '#5ee07a' : ratio > 0.25 ? '#ffc23d' : '#ff5252';
      ctx.fillRect(x, y, w * ratio, h);
      if (st.shield) {
        ctx.fillStyle = 'rgba(127,227,255,0.8)';
        ctx.fillRect(x, y - 3, w * clamp(st.shield.amount / b.maxHp, 0, 1), 2);
      }

      // 이름
      ctx.font = `700 12px "Noto Sans KR", system-ui, sans-serif`;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,10,16,0.8)';
      ctx.strokeText(b.name, b.x, b.y + b.r + 11);
      ctx.fillStyle = '#e8ebf5';
      ctx.fillText(b.name, b.x, b.y + b.r + 11);
    }
  }

  window.BallBattle = { Game, Ball, util: { clamp, rand, shade, TAU } };
})();
