/* =========================================================
 * 캐릭터 목록  ← 여기를 고쳐서 내 캐릭터를 넣으세요!
 *
 * 캐릭터 하나 = 객체 하나
 * {
 *   name:   '검사',        // 이름
 *   icon:   '검',          // 공 가운데 글자 (생략하면 이름 첫 글자, 이모지도 가능)
 *   image:  'assets/characters/내사진.jpg', // 공 안에 넣을 사진 (정사각형 권장, 있으면 icon 대신 사용)
 *   color:  '#e5484d',     // 공 색
 *   hp:     120,           // 체력
 *   radius: 28,            // 공 크기
 *   speed:  220,           // 이동 속도
 *   weapon: {              // 회전하는 근접 무기 (없으면 생략 또는 {type:'none'})
 *     type:   'sword',     // sword | spear | axe | hammer | dagger | staff | scythe
 *     length: 50,          // 길이
 *     width:  8,           // 두께 (판정 굵기)
 *     damage: 8,           // 한 번 맞힐 때 피해
 *     spin:   4,           // 회전 속도 (초당 라디안, 6.28 = 1초에 한 바퀴)
 *     color:  '#dfe4ee',
 *   },
 *   skills: [              // 스킬 목록 (js/skills.js 참고)
 *     Skills.fireball({ damage: 10, cooldown: 3 }),
 *     { name: '내 스킬', trigger: 'cooldown', cooldown: 5, desc: '...', cast(self, game) { ... } },
 *   ],
 *   desc: '캐릭터 소개',
 * }
 *
 * 공끼리 몸으로 부딪히는 것은 튕기기만 하고 피해가 없습니다.
 * 피해는 무기와 스킬로만 들어갑니다.
 * ========================================================= */

window.GAME_CONFIG = {
  arenaSize: 600,        // 경기장 크기 (내부 단위)
  hitCooldown: 0.4,      // 같은 상대를 무기로 다시 때리기까지 대기(초)
  suddenDeathTime: 60,   // 이 시간이 지나면 서든데스 (0이면 없음)
  seek: 0,               // 가까운 적 쪽으로 방향을 트는 정도 (0 = 적을 쫓지 않음)
  wallSpread: 140,       // 벽에 튕길 때 무작위 방향 범위(도). 0이면 거울처럼 반사
  ballScale: 1.2,        // 모든 공 크기 배율
  showCooldowns: true,   // 공 밑에 스킬 쿨타임 표시
};

window.CHARACTERS = [
  {
    name: '이진우',
    image: 'assets/characters/leejinwoo.jpg', // 공 안에 들어가는 사진
    color: '#22c7e8',
    hp: 95, radius: 30, speed: 200,
    // 무기 없음: 몸으로 부딪혀서 공격
    skills: [
      Skills.brainAccel({ cooldown: 4.5, maxSpeed: 3, baseDamage: 8, damagePerSpeed: 10, stackMult: 1.2, maxStacks: 10 }),
    ],
    desc: '4.5초마다 가속해서 적에게 몸통 박치기',
  },
  {
    name: '젠슨 황',
    image: 'assets/characters/jensenhuang.jpg',
    color: '#76b900',
    hp: 100, radius: 28, speed: 190,
    skills: [
      Skills.throwItem({ name: '빨간 브래지어', damage: 2, cooldown: 1 }),
      Skills.skyDrop({ name: '그래픽카드 낙하', damage: 28, radius: 85, delay: 1.0, cooldown: 7 }),
    ],
    desc: '빨간 브래지어를 던지고 하늘에서 그래픽카드를 떨어뜨림',
  },
  {
    name: '검사', icon: '검', color: '#e5484d',
    hp: 85, radius: 28, speed: 220,
    weapon: { type: 'sword', length: 50, width: 8, damage: 8, spin: 4.5 },
    skills: [Skills.growth({ damage: 2, length: 4 }), Skills.lifesteal({ ratio: 0.15 })],
    desc: '때릴수록 칼이 길어지고 강해지는 성장형',
  },
  {
    name: '마법사', icon: '마', color: '#6e56cf',
    hp: 65, radius: 26, speed: 200,
    weapon: { type: 'staff', length: 34, width: 7, damage: 4, spin: 3, color: '#b69cff' },
    skills: [
      Skills.fireball({ damage: 10, cooldown: 2.6, burn: 3 }),
      Skills.shield({ amount: 15, cooldown: 10 }),
    ],
    desc: '화염구로 멀리서 태우고 보호막으로 버팀',
  },
  {
    name: '궁수', icon: '궁', color: '#30a46c',
    hp: 60, radius: 25, speed: 240,
    weapon: { type: 'dagger', length: 26, width: 6, damage: 4, spin: 5 },
    skills: [
      Skills.arrows({ count: 3, damage: 5, cooldown: 1.8 }),
      Skills.critical({ chance: 0.2, mult: 2 }),
    ],
    desc: '빠르게 화살을 퍼붓는 원거리 딜러',
  },
  {
    name: '성기사', icon: '성', color: '#e2b93b',
    hp: 105, radius: 31, speed: 170,
    weapon: { type: 'hammer', length: 44, width: 9, damage: 10, spin: 3, color: '#f3e3a4' },
    skills: [
      Skills.heal({ amount: 16, cooldown: 7 }),
      Skills.revive({ hpRatio: 0.35 }),
    ],
    desc: '단단하고 회복하며 한 번 부활함',
  },
  {
    name: '암살자', icon: '암', color: '#3b3f52',
    hp: 60, radius: 23, speed: 290,
    weapon: { type: 'dagger', length: 30, width: 7, damage: 6, spin: 7, color: '#c7f0ff' },
    skills: [
      Skills.teleport({ cooldown: 5, damage: 6 }),
      Skills.poisonTouch({ dps: 3, time: 3 }),
    ],
    desc: '등 뒤로 순간이동해서 독을 묻힘',
  },
  {
    name: '번개술사', icon: '번', color: '#0090ff',
    hp: 70, radius: 26, speed: 210,
    weapon: { type: 'staff', length: 32, width: 7, damage: 4, spin: 3.5, color: '#9fe0ff' },
    skills: [
      Skills.lightning({ damage: 11, chains: 3, cooldown: 4, stun: 0.3 }),
      Skills.haste({ cooldown: 8 }),
    ],
    desc: '연쇄 번개로 여러 적을 동시에 지짐',
  },
  {
    name: '독술사', icon: '독', color: '#7c9a1e',
    hp: 80, radius: 27, speed: 200,
    weapon: { type: 'scythe', length: 42, width: 7, damage: 6, spin: 3.5, color: '#c6ff6b' },
    skills: [
      Skills.poisonPool({ dps: 8, cooldown: 4 }),
      Skills.thorns({ ratio: 0.35 }),
    ],
    desc: '독 늪을 깔고 맞으면 가시로 반사',
  },
  {
    name: '광전사', icon: '광', color: '#b4402a',
    hp: 95, radius: 30, speed: 210,
    weapon: { type: 'axe', length: 46, width: 9, damage: 9, spin: 3.8, color: '#e3e6ee' },
    skills: [
      Skills.dash({ damage: 8, cooldown: 4.5 }),
      Skills.lifesteal({ ratio: 0.25 }),
      Skills.berserk({ hpBelow: 0.35 }),
    ],
    desc: '돌진하고 흡혈하며 빈사 상태에서 폭주',
  },
  {
    name: '창술사', icon: '창', color: '#12a594',
    hp: 80, radius: 26, speed: 230,
    weapon: { type: 'spear', length: 70, width: 6, damage: 9, spin: 3.6, color: '#e6f6f3' },
    skills: [
      Skills.dash({ name: '찌르기 돌진', damage: 6, cooldown: 5 }),
      Skills.critical({ chance: 0.25, mult: 2 }),
    ],
    desc: '긴 창으로 거리를 지배함',
  },
  {
    name: '폭탄마', icon: '폭', color: '#f76b15',
    hp: 80, radius: 28, speed: 210,
    skills: [
      Skills.meteor({ damage: 18, cooldown: 4.5 }),
      Skills.explosion({ damage: 14, radius: 120, cooldown: 4 }),
      Skills.homingMissiles({ name: '폭탄 투척', count: 2, damage: 6, cooldown: 3.5, color: '#ffb347' }),
    ],
    desc: '무기 없이 폭탄과 운석으로만 싸움',
  },

  /* ----- 직접 만든 스킬 예시 -----
   * 아래처럼 skills 배열 안에 객체를 바로 써서 나만의 스킬을 만들 수 있어요.
   */
  {
    name: '흡혈귀', icon: '🦇', color: '#8e1b3a',
    hp: 70, radius: 26, speed: 230,
    weapon: { type: 'scythe', length: 40, width: 7, damage: 6, spin: 4, color: '#ff8fa3' },
    skills: [
      Skills.lifesteal({ ratio: 0.4 }),
      {
        name: '피의 폭풍', trigger: 'cooldown', cooldown: 5, color: '#ff4d6d',
        desc: '5초마다 체력 10을 소모해 주변 적에게 피해 15 + 그만큼 흡수',
        cast(self, game) {
          const targets = game.enemiesInRadius(self, self.x, self.y, 140);
          if (!targets.length || self.hp <= 15) return false; // 조건이 안 맞으면 발동 안 함
          self.hp -= 10;
          game.ring(self.x, self.y, 140, '#ff4d6d', 0.5);
          for (const t of targets) {
            const dealt = game.damage(t, 15, self);
            game.heal(self, dealt * 0.5);
          }
        },
      },
    ],
    desc: '체력을 깎아 쓰는 스킬 예시 (직접 만든 스킬)',
  },
];
