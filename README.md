# Ball Battle

공 캐릭터들이 경기장 안을 튕겨 다니며 **무기와 스킬로** 싸우는 자동 전투 시뮬레이션입니다.
몸끼리 부딪히는 것은 튕기기만 하고 피해가 없습니다.
설치나 빌드 없이 브라우저에서 바로 실행되고, 모바일 화면에 맞춰져 있습니다.

## 실행

- **PC**: `index.html`을 브라우저로 열면 됩니다.
- **모바일**: GitHub 저장소의 Settings → Pages에서 이 브랜치를 배포하면 폰에서 주소로 열 수 있습니다.
  홈 화면에 추가하면 앱처럼 전체 화면으로 열립니다.

## 파일 구조

| 파일 | 내용 |
| --- | --- |
| `js/characters.js` | **캐릭터 목록과 게임 설정** ← 주로 여기를 고칩니다 |
| `js/skills.js` | 스킬 라이브러리 (새 스킬 추가) |
| `js/engine.js` | 물리, 전투, 그리기 엔진 |
| `js/ui.js` | 선택 화면, 전투 화면, 결과 화면 |

## 캐릭터 추가하기

`js/characters.js`의 `CHARACTERS` 배열에 객체 하나를 추가합니다.

```js
{
  name: '닌자', icon: '닌', color: '#444c6b',
  hp: 70, radius: 24, speed: 260,
  weapon: { type: 'dagger', length: 30, width: 7, damage: 6, spin: 6 },
  skills: [
    Skills.teleport({ cooldown: 4 }),
    Skills.critical({ chance: 0.3, mult: 2.5 }),
  ],
  desc: '빠르게 치고 빠지는 캐릭터',
},
```

무기 종류는 `sword`, `spear`, `axe`, `hammer`, `dagger`, `staff`, `scythe`입니다. 무기가 없으면 `weapon`을 빼면 됩니다.

## 기본 제공 스킬

| 스킬 | 발동 | 효과 |
| --- | --- | --- |
| `fireball` | 쿨다운 | 화염구 발사 (화상 옵션) |
| `arrows` | 쿨다운 | 부채꼴 화살 |
| `nova` | 쿨다운 | 사방으로 탄환 |
| `homingMissiles` | 쿨다운 | 유도탄 |
| `lightning` | 쿨다운 | 연쇄 번개 (기절 옵션) |
| `meteor` | 쿨다운 | 예고 후 운석 낙하 |
| `explosion` | 쿨다운 | 주변 폭발 |
| `freeze` | 쿨다운 | 주변 적 얼리기 |
| `poisonPool` | 쿨다운 | 독 장판 |
| `dash` | 쿨다운 | 적에게 돌진 |
| `teleport` | 쿨다운 | 적 등 뒤로 순간이동 |
| `haste` | 쿨다운 | 이동속도 증가 |
| `heal` | 쿨다운 | 체력 회복 |
| `shield` | 쿨다운 | 보호막 |
| `lifesteal` | 적중 시 | 흡혈 |
| `growth` | 적중 시 | 맞힐 때마다 무기 강화 |
| `burnTouch` / `poisonTouch` | 적중 시 | 화상 / 중독 |
| `critical` | 적중 시 | 확률 치명타 |
| `thorns` | 피격 시 | 피해 반사 |
| `berserk` | 체력 낮을 때 | 광폭화 |
| `bloodlust` | 처치 시 | 회복 + 강화 |
| `revive` | 사망 시 | 1회 부활 |

모든 스킬은 숫자를 바꿀 수 있습니다. 예: `Skills.fireball({ damage: 20, cooldown: 2, burn: 5 })`

## 나만의 스킬 만들기

`skills` 배열에 객체를 직접 쓰면 됩니다. 사용할 수 있는 기능은 `js/skills.js` 맨 위 주석에 정리되어 있습니다.

```js
{
  name: '회오리', trigger: 'cooldown', cooldown: 6,
  desc: '주변 적을 끌어당기고 피해 8',
  cast(self, game) {
    const targets = game.enemiesInRadius(self, self.x, self.y, 180);
    if (!targets.length) return false;          // false = 발동 안 함
    for (const t of targets) {
      const d = game.dist(self, t) || 1;
      t.kx -= (t.x - self.x) / d * 500;         // 끌어당기기
      t.ky -= (t.y - self.y) / d * 500;
      game.damage(t, 8, self);
    }
    game.ring(self.x, self.y, 180, '#9be7ff');
  },
},
```

`trigger`: `cooldown`(기본), `start`, `onHit`, `onDamaged`, `lowHp`, `onKill`, `onDeath`

## 게임 설정

`js/characters.js` 맨 위의 `GAME_CONFIG`에서 바꿀 수 있습니다.

- `suddenDeathTime`: 이 시간(초)이 지나면 10초마다 모든 피해가 커집니다. `0`이면 꺼집니다.
- `hitCooldown`: 같은 상대를 무기로 다시 때리기까지의 대기 시간
- `seek`: 공이 가까운 적 쪽으로 방향을 트는 정도 (`0`이면 완전 무작위로 튕김)

## 영상 녹화

선택 화면에서 캐릭터를 고르고 **● 녹화**를 누르면 버튼 같은 UI 없이 대결 화면만 세로 영상(1080x1920)으로 녹화됩니다.
대결이 끝나면 승자 화면을 3초 보여준 뒤 녹화가 멈추고, **영상 저장** 또는 **공유**(폰에서 사진 앱에 저장할 때)로 파일을 받을 수 있습니다.
크롬과 안드로이드에서는 보통 MP4, 그 외 브라우저에서는 WebM으로 저장됩니다.
