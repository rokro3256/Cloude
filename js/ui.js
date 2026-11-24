/* 화면 전환, 캐릭터 선택, 전투 HUD */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const chars = window.CHARACTERS || [];
  const selected = new Set();
  let game = null;
  let lastPicks = [];
  const SPEEDS = [1, 2, 3, 0.5];
  let speedIdx = 0;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /* ---------- 선택 화면 ---------- */
  function buildGrid() {
    const grid = $('grid');
    grid.innerHTML = '';
    chars.forEach((c, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'card';
      el.dataset.i = i;
      const w = c.weapon && c.weapon.type !== 'none' ? c.weapon : null;
      const skills = (c.skills || []).map((s) => `<li><b>${esc(s.name || '스킬')}</b>${esc(s.desc || '')}</li>`).join('');
      el.innerHTML = `
        ${orbHtml(c)}
        <h3>${esc(c.name)} <span class="stats">HP ${c.hp || 100} · 속도 ${c.speed != null ? c.speed : 200}</span></h3>
        <p class="desc">${esc(c.desc || '')}</p>
        <ul>${w ? `<li><b>무기</b>${esc(weaponName(w.type))} · 피해 ${w.damage != null ? w.damage : 8}</li>` : '<li><b>무기</b>없음</li>'}${skills}</ul>`;
      el.addEventListener('click', () => toggle(i));
      grid.appendChild(el);
    });
    refreshSel();
  }

  function orbHtml(c) {
    if (c.image) {
      return `<span class="orb photo" style="--ring:${esc(c.color || '#888')};background-image:url('${esc(c.image)}')"></span>`;
    }
    return `<span class="orb" style="background:${esc(c.color || '#888')}">${esc(c.icon || (c.name || '?').charAt(0))}</span>`;
  }

  function weaponName(t) {
    return { sword: '검', spear: '창', axe: '도끼', hammer: '망치', dagger: '단검', staff: '지팡이', scythe: '낫' }[t] || t;
  }

  function toggle(i) {
    if (selected.has(i)) selected.delete(i); else selected.add(i);
    refreshSel();
  }

  function refreshSel() {
    const order = [...selected];
    document.querySelectorAll('.card').forEach((el) => {
      const i = +el.dataset.i;
      const on = selected.has(i);
      el.classList.toggle('on', on);
      el.setAttribute('aria-pressed', on);
      const orb = el.querySelector('.orb');
      let badge = orb.querySelector('.badge');
      if (on) {
        if (!badge) { badge = document.createElement('span'); badge.className = 'badge'; orb.appendChild(badge); }
        badge.textContent = order.indexOf(i) + 1;
      } else if (badge) badge.remove();
    });
    $('selCount').textContent = selected.size;
    $('btnStart').disabled = selected.size < 2;
    $('btnRecord').disabled = selected.size < 2;
  }

  $('btnRandom').addEventListener('click', () => {
    selected.clear();
    const idx = chars.map((_, i) => i).sort(() => Math.random() - 0.5).slice(0, Math.min(4, chars.length));
    idx.forEach((i) => selected.add(i));
    refreshSel();
  });

  $('btnStart').addEventListener('click', () => {
    if (selected.size < 2) return;
    lastPicks = [...selected].map((i) => chars[i]);
    startBattle(lastPicks);
  });

  $('btnRecord').addEventListener('click', () => {
    if (window.SFX) window.SFX.live.unlock(); // 실시간 녹화로 대신할 때 소리를 쓰려면 버튼을 누른 순간에 열어야 함
    if (selected.size < 2) return;
    lastPicks = [...selected].map((i) => chars[i]);
    window.Recorder.start(lastPicks);
  });

  /* ---------- 전투 ---------- */
  function startBattle(defs) {
    if (game) game.stop();
    $('select').hidden = true;
    $('battle').hidden = false;
    $('overlay').hidden = true;
    const canvas = $('canvas');
    const sfx = window.SFX && window.SFX.live;
    if (sfx) sfx.unlock();
    game = new BallBattle.Game(canvas, defs, {
      onEnd: (w, g) => { if (sfx) sfx.play('win'); showResult(w, g); },
      onSound: (name, t, o) => { if (sfx) sfx.play(name, o); },
    });
    game.speedMult = SPEEDS[speedIdx];
    buildRoster();
    fit();
    game.start();
    if (sfx) sfx.play('fight');
    $('btnPause').textContent = '❚❚';
  }

  function fit() {
    if (!game) return;
    const st = $('stage');
    const size = Math.max(200, Math.floor(Math.min(st.clientWidth, st.clientHeight)));
    game.resize(size);
  }
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 200));

  function buildRoster() {
    const r = $('roster');
    r.innerHTML = '';
    game.balls.forEach((b) => {
      const el = document.createElement('div');
      el.className = 'fighter';
      el.innerHTML = `<span class="dot" style="background:${esc(b.color)}"></span><span class="nm">${esc(b.name)}</span><span class="hp"></span><span class="bar"><i></i></span>`;
      b._el = el;
      r.appendChild(el);
    });
  }

  function tickHud() {
    if (game && !$('battle').hidden) {
      for (const b of game.balls) {
        const el = b._el;
        if (!el) continue;
        const ratio = Math.max(0, b.hp / b.maxHp);
        el.querySelector('.hp').textContent = b.alive ? Math.ceil(b.hp) : '탈락';
        const bar = el.querySelector('.bar i');
        bar.style.width = ratio * 100 + '%';
        bar.style.background = ratio > 0.5 ? '#5ee07a' : ratio > 0.25 ? '#ffc23d' : '#ff5252';
        el.classList.toggle('dead', !b.alive);
      }
      const c = $('clock');
      c.textContent = game.time.toFixed(1);
      c.classList.toggle('sd', game.suddenDeath);
    }
    requestAnimationFrame(tickHud);
  }
  requestAnimationFrame(tickHud);

  function showResult(winners, g) {
    const w = winners[0];
    const orb = $('winOrb');
    if (w && w.def.image) {
      orb.className = 'orb photo';
      orb.style.cssText = `--ring:${w.color};background-image:url('${w.def.image}')`;
      orb.textContent = '';
    } else {
      orb.className = 'orb';
      orb.style.cssText = '';
      orb.style.background = w ? w.color : '#444';
      orb.textContent = w ? w.icon : '?';
    }
    $('winName').textContent = w ? (winners.length > 1 ? winners.map((x) => x.name).join(', ') : w.name) : '무승부';
    const rows = [...g.balls]
      .sort((a, b) => b.stats.damageDealt - a.stats.damageDealt)
      .map((b) => `<tr><td>${esc(b.name)}</td><td>${Math.round(b.stats.damageDealt)}</td><td>${b.stats.kills}</td></tr>`)
      .join('');
    $('winStats').innerHTML = rows;
    $('overlay').hidden = false;
  }

  $('btnSound').addEventListener('click', () => {
    const sfx = window.SFX && window.SFX.live;
    if (!sfx) return;
    sfx.unlock();
    sfx.muted = !sfx.muted;
    $('btnSound').textContent = sfx.muted ? '🔇' : '🔊';
    $('btnSound').setAttribute('aria-pressed', String(!sfx.muted));
    $('btnSound').setAttribute('aria-label', sfx.muted ? '효과음 켜기' : '효과음 끄기');
  });

  $('btnPause').addEventListener('click', () => {
    if (!game) return;
    game.paused = !game.paused;
    $('btnPause').textContent = game.paused ? '▶' : '❚❚';
  });
  $('btnSpeed').addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    $('btnSpeed').textContent = SPEEDS[speedIdx] + 'x';
    if (game) game.speedMult = SPEEDS[speedIdx];
  });
  $('btnRestart').addEventListener('click', () => startBattle(lastPicks));
  $('btnAgain').addEventListener('click', () => startBattle(lastPicks));
  const toMenu = () => {
    if (game) { game.stop(); game = null; }
    $('overlay').hidden = true;
    $('battle').hidden = true;
    $('select').hidden = false;
  };
  $('btnBack').addEventListener('click', toMenu);
  $('btnMenu').addEventListener('click', toMenu);

  // 화면 이동 시 자동 일시정지
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game && !game.paused) {
      game.paused = true;
      $('btnPause').textContent = '▶';
    }
  });

  buildGrid();
  // 캐릭터 사진을 미리 불러 둠 (전투 화면 캔버스에 그리기 위해)
  BallBattle.loadImages(chars);
})();
