/* =========================================================
 * 스킬 라이브러리
 *
 * 스킬은 아래 모양의 객체입니다.
 * {
 *   name: '파이어볼',          // 발동 시 공 위에 표시되는 이름
 *   desc: '설명',              // 캐릭터 선택 화면에 표시
 *   trigger: 'cooldown',       // 언제 발동하는지 (아래 표 참고)
 *   cooldown: 3,               // 재사용 대기시간(초)
 *   chance: 1,                 // 발동 확률(0~1, 생략하면 항상)
 *   hpBelow: 0.3,              // trigger가 'lowHp'일 때 체력 비율 기준
 *   silent: false,             // true면 발동 이름을 띄우지 않음
 *   sound: 'cast',             // 발동 효과음 (js/sfx.js의 이름: cast heal shield zap freeze dash teleport rage revive warn crit boom ...)
 *   cast(self, game, ctx) {}   // 실제 효과. false를 반환하면 "발동 안 함"
 * }
 *
 * trigger 종류
 *   'cooldown'  : 쿨다운마다 자동 발동 (기본값)
 *   'start'     : 전투 시작 시 1번
 *   'onHit'     : 내 무기/투사체가 적을 맞혔을 때   ctx = {target, amount, kind}
 *   'onDamaged' : 내가 피해를 입었을 때              ctx = {source, amount, kind}
 *   'lowHp'     : 체력이 hpBelow 이하가 되면 1번
 *   'onKill'    : 적을 처치했을 때                   ctx = {target}
 *   'onDeath'   : 죽을 때 1번 (cast 안에서 hp를 올리면 부활)
 *   'onCollide' : 적과 몸으로 부딪혔을 때            ctx = {target, nx, ny}(nx,ny = 상대 쪽 방향)
 *
 * 추가로 쓸 수 있는 칸
 *   tick(self, game, dt) {}    매 순간(1/120초마다) 실행. 점점 빨라지기 같은 효과
 *   display(self, sk) { return {text, ratio} }   영상의 스킬 칸에 보여줄 글자와 막대(0~1)
 *   collide(self, game, ctx) {}  적과 부딪힐 때마다 실행 (쿨다운과 무관)
 *   onWall(self, game) {}        벽에 튕길 때마다 실행 (self.dx, self.dy로 방향을 바꿀 수 있음)
 *   self.speedBonus            이동 속도 배율 (1 = 기본)
 *
 * cast 안에서 쓸 수 있는 game 기능
 *   game.nearestEnemy(self) / game.randomEnemy(self) / game.enemiesOf(self)
 *   game.enemiesInRadius(self, x, y, 반경)
 *   game.damage(대상, 피해량, self)
 *   game.heal(대상, 회복량)
 *   game.shoot(self, {target, angle, speed, damage, radius, color, pierce, bounce, homing, shape:'orb'|'arrow', onHit})
 *   game.explode(x, y, 반경, 피해량, self, {color, knockback})
 *   game.zone({x, y, radius, dps, duration, owner:self, color, slow})
 *   game.addStatus(대상, 상태, {...})
 *       'burn'/'poison' {time, dps, source}   지속 피해
 *       'slow'    {time, factor}               이동 속도 배율 (0.5 = 절반)
 *       'stun'    {time}                       기절 (이동/무기/스킬 정지)
 *       'shield'  {time, amount}               보호막
 *       'haste'   {time, mult}                 이동 속도 증가
 *       'power'   {time, mult}                 주는 피해 증가
 *       'invincible' {time}                    무적
 *       'regen'   {time, hps}                  초당 회복
 *   game.after(초, 함수)    일정 시간 뒤 실행
 *   game.text(x, y, 글자, 색) / game.particles(x, y, 색, 개수) / game.ring(x, y, 반경, 색) / game.shake(세기)
 *   self.x, self.y, self.r, self.hp, self.maxHp, self.weapon, self.bonusDamage, self.data(자유 저장소)
 * ========================================================= */
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const P = (defaults, o) => Object.assign({}, defaults, o || {});

  const Skills = {
    /* ----- 원거리 ----- */
    fireball(o) {
      const p = P({ name: '파이어볼', damage: 12, cooldown: 3, speed: 420, radius: 9, burn: 0, color: '#ff7a2f' }, o);
      return {
        name: p.name, color: '#ffab5e', trigger: 'cooldown', cooldown: p.cooldown,
        desc: `${p.cooldown}초마다 가장 가까운 적에게 화염구 (피해 ${p.damage}${p.burn ? `, 화상 초당 ${p.burn}` : ''})`,
        cast(self, game) {
          const t = game.nearestEnemy(self);
          if (!t) return false;
          game.shoot(self, {
            target: t, speed: p.speed, damage: p.damage, radius: p.radius, color: p.color, sound: 'fire',
            onHit: (tg) => { if (p.burn) game.addStatus(tg, 'burn', { time: 3, dps: p.burn, source: self }); },
          });
        },
      };
    },

    arrows(o) {
      const p = P({ name: '연사', count: 3, spread: 0.35, damage: 5, cooldown: 2.5, speed: 560 }, o);
      return {
        name: p.name, trigger: 'cooldown', cooldown: p.cooldown,
        desc: `${p.cooldown}초마다 화살 ${p.count}발 부채꼴 발사 (발당 ${p.damage})`,
        cast(self, game) {
          const t = game.nearestEnemy(self);
          if (!t) return false;
          const base = Math.atan2(t.y - self.y, t.x - self.x);
          for (let i = 0; i < p.count; i++) {
            const a = base + (p.count === 1 ? 0 : (i / (p.count - 1) - 0.5) * p.spread * 2);
            game.shoot(self, { angle: a, speed: p.speed, damage: p.damage, radius: 5, color: '#f1e3b0', shape: 'arrow', sound: i === 0 ? 'arrow' : null, silent: i > 0 });
          }
        },
      };
    },

    nova(o) {
      const p = P({ name: '노바', count: 12, damage: 4, cooldown: 6, speed: 330, color: '#c77dff' }, o);
      return {
        name: p.name, color: '#d9a8ff', trigger: 'cooldown', cooldown: p.cooldown,
        desc: `${p.cooldown}초마다 사방으로 탄환 ${p.count}발 (발당 ${p.damage})`,
        cast(self, game) {
          const off = Math.random() * TAU;
          for (let i = 0; i < p.count; i++) {
            game.shoot(self, { angle: off + (i / p.count) * TAU, speed: p.speed, damage: p.damage, radius: 6, color: p.color, silent: i > 0 });
          }
        },
      };
    },

    homingMissiles(o) {
      const p = P({ name: '유도탄', count: 3, damage: 6, cooldown: 5, speed: 300, turn: 4, color: '#ff5fa2' }, o);
      return {
        name: p.name, color: '#ff8cc0', trigger: 'cooldown', cooldown: p.cooldown,
        desc: `${p.cooldown}초마다 적을 쫓아가는 유도탄 ${p.count}발 (발당 ${p.damage})`,
        cast(self, game) {
          if (!game.nearestEnemy(self)) return false;
          for (let i = 0; i < p.count; i++) {
            game.shoot(self, { angle: Math.random() * TAU, speed: p.speed, damage: p.damage, radius: 6, color: p.color, homing: p.turn, life: 4, silent: i > 0 });
          }
        },
      };
    },

    lightning(o) {
      const p = P({ name: '체인 라이트닝', damage: 10, chains: 3, range: 260, cooldown: 5, stun: 0 }, o);
      return {
        name: p.name, color: '#bfe6ff', sound: 'zap', trigger: 'cooldown', cooldown: p.cooldown,
        desc: `${p.cooldown}초마다 번개가 적 최대 ${p.chains}명에게 연쇄 (피해 ${p.damage})`,
        cast(self, game) {
          let from = self;
          const hit = new Set();
          const pts = [[self.x, self.y]];
          for (let i = 0; i < p.chains; i++) {
            let best = null, bd = Infinity;
            for (const e of game.enemiesOf(self)) {
              if (hit.has(e)) continue;
              const d = Math.hypot(e.x - from.x, e.y - from.y);
              if (d < bd && d <= p.range) { bd = d; best = e; }
            }
            if (!best) break;
            hit.add(best);
            pts.push([best.x, best.y]);
            game.damage(best, p.damage * (1 - i * 0.15), self);
            if (p.stun && best.alive) game.addStatus(best, 'stun', { time: p.stun });
            from = best;
          }
          if (!hit.size) return false;
          game.bolt(pts);
        },
      };
    },

    meteor(o) {
      const p = P({ name: '메테오', damage: 25, radius: 90, delay: 1.1, cooldown: 9 }, o);
      return {
        name: p.name, color: '#ff8a5c', sound: 'warn', trigger: 'cooldown', cooldown: p.cooldown,
        desc: `${p.cooldown}초마다 적 위치에 운석 낙하 (${p.delay}초 뒤, 피해 ${p.damage})`,
        cast(self, game) {
          const t = game.randomEnemy(self);
          if (!t) return false;
          const x = t.x, y = t.y;
          const timer = { t: p.delay, fn: () => { if (self.alive) game.explode(x, y, p.radius, p.damage, self, { color: '#ff6a2b', knockback: 500 }); } };
          timer.warn = { x, y, r: p.radius, color: '#ff5a3a' };
          game.timers.push(timer);
        },
      };
    },

    /* ----- 던지기 / 떨어뜨리기 ----- */
    // Throw a spinning object at the nearest enemy (default: red bra)
    throwItem(o) {
      const p = P({ name: '빨간 브래지어', damage: 2, cooldown: 1, speed: 420, size: 11, shape: 'bra', color: '#e11d2e' }, o);
      return {
        name: p.name, color: '#ff5a6a', silent: p.silent !== false, trigger: 'cooldown', cooldown: p.cooldown, // silent: no name pop-up every throw
        desc: `${p.cooldown}초마다 가장 가까운 적에게 던짐 (피해 ${p.damage})`,
        cast(self, game) {
          const t = game.nearestEnemy(self);
          if (!t) return false;
          game.shoot(self, { target: t, speed: p.speed, damage: p.damage, radius: p.size, color: p.color, shape: p.shape });
        },
      };
    },

    // Drop a heavy object from the sky on an enemy (default: graphics card)
    skyDrop(o) {
      const p = P({ name: '그래픽카드 낙하', damage: 28, radius: 85, delay: 1.0, cooldown: 7, shape: 'gpu', color: '#76b900' }, o);
      return {
        name: p.name, color: '#9be15d', sound: 'warn', trigger: 'cooldown', cooldown: p.cooldown,
        desc: `${p.cooldown}초마다 하늘에서 떨어져 큰 피해 (${p.delay}초 뒤, 피해 ${p.damage})`,
        cast(self, game) {
          const t = game.nearestEnemy(self);
          if (!t) return false;
          // aim a little ahead of where the target is heading
          const lead = Math.min(0.5, p.delay) * (t.speed || 0);
          const x = Math.max(20, Math.min(game.A - 20, t.x + t.dx * lead));
          const y = Math.max(20, Math.min(game.A - 20, t.y + t.dy * lead));
          game.timers.push({
            t: p.delay, total: p.delay, drop: p.shape,
            warn: { x, y, r: p.radius, color: p.color },
            fn: () => { if (self.alive) game.explode(x, y, p.radius, p.damage, self, { color: p.color, knockback: 520 }); },
          });
        },
      };
    },

    /* ----- 범위 ----- */
    explosion(o) {
      const p = P({ name: '폭발', damage: 14, radius: 120, cooldown: 7, color: '#ffb347' }, o);
      return {
        name: p.name, trigger: 'cooldown', cooldown: p.cooldown,
        desc: `${p.cooldown}초마다 주변 폭발 (반경 ${p.radius}, 피해 ${p.damage})`,
        cast(self, game) {
          if (!game.enemiesInRadius(self, self.x, self.y, p.radius * 1.3).length) return false; // 적이 가까울 때만
          game.explode(self.x, self.y, p.radius, p.damage, self, { color: p.color });
        },
      };
    },

    freeze(o) {
      const p = P({ name: '빙결', radius: 150, duration: 1.4, damage: 4, cooldown: 8 }, o);
      return {
        name: p.name, color: '#9fe7ff', sound: 'freeze', trigger: 'cooldown', cooldown: p.cooldown,
        desc: `${p.cooldown}초마다 주변 적을 ${p.duration}초 얼림`,
        cast(self, game) {
          const ts = game.enemiesInRadius(self, self.x, self.y, p.radius);
          if (!ts.length) return false;
          game.ring(self.x, self.y, p.radius, '#9fe7ff', 0.5);
          for (const t of ts) {
            game.damage(t, p.damage, self);
            if (t.alive) game.addStatus(t, 'stun', { time: p.duration });
          }
        },
      };
    },

    poisonPool(o) {
      const p = P({ name: '독 늪', radius: 70, dps: 6, duration: 4, slow: 0.6, cooldown: 6 }, o);
      return {
        name: p.name, color: '#b6ff6a', trigger: 'cooldown', cooldown: p.cooldown,
        desc: `${p.cooldown}초마다 적 발밑에 독 늪 (초당 ${p.dps}, 감속)`,
        cast(self, game) {
          const t = game.nearestEnemy(self);
          if (!t) return false;
          game.zone({ x: t.x, y: t.y, radius: p.radius, dps: p.dps, duration: p.duration, owner: self, color: '#8cff3d', slow: p.slow });
        },
      };
    },

    /* ----- 이동 ----- */
    dash(o) {
      const p = P({ name: '돌진', power: 950, damage: 10, cooldown: 4 }, o);
      return {
        name: p.name, sound: 'dash', trigger: 'cooldown', cooldown: p.cooldown,
        desc: `${p.cooldown}초마다 적에게 돌진 (부딪히면 ${p.damage})`,
        cast(self, game) {
          const t = game.nearestEnemy(self);
          if (!t) return false;
          const d = game.dist(self, t) || 1;
          self.dx = (t.x - self.x) / d; self.dy = (t.y - self.y) / d;
          self.kx = self.dx * p.power; self.ky = self.dy * p.power;
          game.addStatus(self, 'dashing', { time: 0.5, damage: p.damage, hit: new Set() });
        },
      };
    },

    teleport(o) {
      const p = P({ name: '순간이동', cooldown: 6, damage: 0 }, o);
      return {
        name: p.name, color: '#d9a8ff', sound: 'teleport', trigger: 'cooldown', cooldown: p.cooldown,
        desc: `${p.cooldown}초마다 적의 등 뒤로 순간이동${p.damage ? ` (피해 ${p.damage})` : ''}`,
        cast(self, game) {
          const t = game.nearestEnemy(self);
          if (!t) return false;
          game.particles(self.x, self.y, '#c77dff', 16, 220);
          const back = Math.atan2(-t.dy, -t.dx);
          const A = game.A, dd = t.r + self.r + 6;
          self.x = Math.min(A - self.r, Math.max(self.r, t.x + Math.cos(back) * dd));
          self.y = Math.min(A - self.r, Math.max(self.r, t.y + Math.sin(back) * dd));
          game.particles(self.x, self.y, '#c77dff', 16, 220);
          if (p.damage) game.damage(t, p.damage, self);
        },
      };
    },

    haste(o) {
      const p = P({ name: '가속', mult: 1.7, duration: 3, cooldown: 7 }, o);
      return {
        name: p.name, color: '#7dfcff', sound: 'dash', trigger: 'cooldown', cooldown: p.cooldown,
        desc: `${p.cooldown}초마다 ${p.duration}초간 이동속도 x${p.mult}`,
        cast(self, game) { game.addStatus(self, 'haste', { time: p.duration, mult: p.mult }); },
      };
    },

    /* ----- 방어/회복 ----- */
    heal(o) {
      const p = P({ name: '치유', amount: 20, cooldown: 8 }, o);
      return {
        name: p.name, color: '#6dff9c', sound: 'heal', trigger: 'cooldown', cooldown: p.cooldown,
        desc: `${p.cooldown}초마다 체력 ${p.amount} 회복`,
        cast(self, game) {
          if (self.hp > self.maxHp * 0.85) return false; // 다쳤을 때만
          game.heal(self, p.amount);
          game.ring(self.x, self.y, self.r * 2.2, '#6dff9c', 0.5);
        },
      };
    },

    shield(o) {
      const p = P({ name: '보호막', amount: 25, duration: 4, cooldown: 9 }, o);
      return {
        name: p.name, color: '#7fe3ff', sound: 'shield', trigger: 'cooldown', cooldown: p.cooldown,
        desc: `${p.cooldown}초마다 ${p.duration}초간 피해 ${p.amount} 흡수`,
        cast(self, game) { game.addStatus(self, 'shield', { amount: p.amount, time: p.duration }); },
      };
    },

    /* ----- 몸통 박치기 ----- */
    brainAccel(o) {
      const p = P({
        name: '브레인 악셀', cooldown: 4.5,
        maxSpeed: 2.6,   // top speed multiplier while active
        ramp: 1.0,       // seconds to reach top speed
        duration: 3.0,   // how long the boost lasts if it never hits anyone
        decay: 1.5,      // speed multiplier lost per second after the boost ends
        baseDamage: 6, damagePerSpeed: 8,
        aimOnWall: true, // after casting, the next wall bounce heads for the nearest enemy
        stackMult: 1.2,  // each cast permanently multiplies base speed by this (stacks)
        maxStacks: 10,   // stack cap so the ball stays controllable
      }, o);
      return {
        name: p.name, color: '#5ef2ff', sound: 'cast', trigger: 'cooldown', cooldown: p.cooldown,
        desc: `${p.cooldown}초마다 발동: 점점 빨라지고(최대 x${p.maxSpeed}) 다음 벽에서 적에게 방향을 틂. 부딪히면 속도에 비례한 피해. 쓸 때마다 기본 속도 x${p.stackMult} 중첩(최대 ${p.maxStacks}중첩)`,
        cast(self, game) {
          const stacks = self.data.brainStacks || 0;
          if (stacks < p.maxStacks) {
            self.data.brainStacks = stacks + 1;
            self.baseSpeed *= p.stackMult;
            game.text(self.x, self.y + self.r + 50, `${self.data.brainStacks}중첩`, '#5ef2ff', 13);
          }
          self.data.brain = { active: true, t: 0, aim: p.aimOnWall };
          game.ring(self.x, self.y, self.r * 2.2, '#5ef2ff', 0.4);
        },
        tick(self, game, dt) {
          const st = self.data.brain;
          if (st && st.active) {
            st.t += dt;
            const target = 1 + (p.maxSpeed - 1) * Math.min(1, st.t / p.ramp);
            self.speedBonus = Math.max(self.speedBonus, target);
            if (st.t >= p.duration) st.active = false;
          } else if (self.speedBonus > 1) {
            self.speedBonus = Math.max(1, self.speedBonus - p.decay * dt);
          }
        },
        onWall(self, game) {
          const st = self.data.brain;
          if (!st || !st.aim) return;
          const t = game.nearestEnemy(self);
          if (!t) return;
          st.aim = false;
          const d = game.dist(self, t) || 1;
          self.dx = (t.x - self.x) / d; self.dy = (t.y - self.y) / d;
          game.particles(self.x, self.y, '#5ef2ff', 10, 220);
        },
        collide(self, game, ctx) {
          const st = self.data.brain;
          if (!st || !st.active) return;
          const t = ctx.target;
          st.active = false; // one hit per activation
          const over = self.speedBonus - 1;
          const dmg = p.baseDamage + p.damagePerSpeed * over;
          t.kx += (ctx.nx || 0) * (280 + 200 * over); t.ky += (ctx.ny || 0) * (280 + 200 * over);
          game.sound('hit', { dmg });
          game.damage(t, dmg, self, { kind: 'weapon', color: '#5ef2ff' });
          game.ring(t.x, t.y, t.r * 1.8, '#5ef2ff', 0.3);
          game.shake(Math.min(8, 2 + over * 3));
        },
        // Video skill panel: current speed while active, otherwise the cooldown
        display(self, sk) {
          const st = self.data.brain;
          const n = self.data.brainStacks || 0;
          const tag = n ? `${n}중첩 ` : '';
          if (st && st.active) return { text: `${tag}x${self.speedBonus.toFixed(1)}`, ratio: (self.speedBonus - 1) / (p.maxSpeed - 1) };
          if (sk && sk.timer > 0) return { text: tag + sk.timer.toFixed(1) + 's', ratio: 1 - sk.timer / p.cooldown };
          return { text: tag + '준비', ratio: 1 };
        },
      };
    },

    /* ----- 패시브 ----- */
    lifesteal(o) {
      const p = P({ ratio: 0.3 }, o);
      return {
        name: '흡혈', silent: true, trigger: 'onHit',
        desc: `적중 피해의 ${Math.round(p.ratio * 100)}% 회복`,
        cast(self, game, ctx) { game.heal(self, ctx.amount * p.ratio, true); },
      };
    },

    growth(o) {
      const p = P({ damage: 1, length: 3, maxLength: 140 }, o);
      return {
        name: '성장', silent: true, trigger: 'onHit',
        desc: `무기로 맞힐 때마다 피해 +${p.damage}, 길이 +${p.length}`,
        cast(self, game, ctx) {
          if (ctx.kind !== 'weapon') return false;
          self.bonusDamage += p.damage;
          if (self.weapon) self.weapon.length = Math.min(p.maxLength, self.weapon.length + p.length);
          game.text(self.x, self.y + self.r + 22, `+${p.damage}`, '#ffd23f', 12);
        },
      };
    },

    burnTouch(o) {
      const p = P({ dps: 4, time: 3 }, o);
      return {
        name: '화상', silent: true, trigger: 'onHit',
        desc: `적중 시 ${p.time}초간 화상 (초당 ${p.dps})`,
        cast(self, game, ctx) { game.addStatus(ctx.target, 'burn', { time: p.time, dps: p.dps, source: self }); },
      };
    },

    poisonTouch(o) {
      const p = P({ dps: 3, time: 4 }, o);
      return {
        name: '중독', silent: true, trigger: 'onHit',
        desc: `적중 시 ${p.time}초간 중독 (초당 ${p.dps})`,
        cast(self, game, ctx) { game.addStatus(ctx.target, 'poison', { time: p.time, dps: p.dps, source: self }); },
      };
    },

    critical(o) {
      const p = P({ chance: 0.2, mult: 2 }, o);
      return {
        name: '치명타', color: '#ff4d4d', sound: 'crit', trigger: 'onHit', chance: p.chance,
        desc: `적중 시 ${Math.round(p.chance * 100)}% 확률로 추가 피해 (x${p.mult})`,
        cast(self, game, ctx) {
          if (ctx.kind === 'skill') return false;
          game.damage(ctx.target, ctx.amount * (p.mult - 1), self, { kind: 'skill', color: '#ff4d4d' });
        },
      };
    },

    thorns(o) {
      const p = P({ ratio: 0.4 }, o);
      return {
        name: '가시', silent: true, trigger: 'onDamaged',
        desc: `받은 피해의 ${Math.round(p.ratio * 100)}%를 되돌려줌`,
        cast(self, game, ctx) {
          if (!ctx.source || ctx.source === self) return false;
          game.damage(ctx.source, ctx.amount * p.ratio, self, { kind: 'thorns', color: '#d0ff8a' });
        },
      };
    },

    berserk(o) {
      const p = P({ name: '광폭화', hpBelow: 0.35, duration: 8, damageMult: 1.6, speedMult: 1.4 }, o);
      return {
        name: p.name, color: '#ff5a5a', sound: 'rage', trigger: 'lowHp', hpBelow: p.hpBelow,
        desc: `체력 ${Math.round(p.hpBelow * 100)}% 이하에서 ${p.duration}초간 피해 x${p.damageMult}, 속도 x${p.speedMult}`,
        cast(self, game) {
          game.addStatus(self, 'power', { time: p.duration, mult: p.damageMult });
          game.addStatus(self, 'haste', { time: p.duration, mult: p.speedMult });
          game.ring(self.x, self.y, self.r * 3, '#ff3b3b', 0.6);
        },
      };
    },

    revive(o) {
      const p = P({ name: '부활', hpRatio: 0.4 }, o);
      return {
        name: p.name, color: '#ffe38a', sound: 'revive', trigger: 'onDeath',
        desc: `처음 쓰러질 때 체력 ${Math.round(p.hpRatio * 100)}%로 부활`,
        cast(self, game) {
          self.hp = self.maxHp * p.hpRatio;
          game.addStatus(self, 'invincible', { time: 1.5 });
          game.ring(self.x, self.y, self.r * 3, '#ffe38a', 0.8);
          game.particles(self.x, self.y, '#ffe38a', 30, 260);
        },
      };
    },

    bloodlust(o) {
      const p = P({ heal: 25, damage: 3 }, o);
      return {
        name: '피의 갈증', color: '#ff5a5a', sound: 'rage', trigger: 'onKill',
        desc: `적 처치 시 체력 ${p.heal} 회복, 무기 피해 +${p.damage}`,
        cast(self, game) { game.heal(self, p.heal); self.bonusDamage += p.damage; },
      };
    },
  };

  window.Skills = Skills;
})();
