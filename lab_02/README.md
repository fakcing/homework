# Dogfight — Lab 02: Об'єкти, прототипи та `this`

Продовження Lab 1 (цикл із фіксованим кроком і корабель лишаються). Тема: космічні кораблі.

## Запуск

```bash
nvm use && npm install
npm run dev          # ?seed=123 — відтворюваний запуск, ?debug — малює кола колізій
npm run lint && npm test
npm run demo:this    # баг із this та фікси
npm run demo:proto   # експеримент із ланцюжком прототипів
```

Керування: `←/→` (`A/D`) — поворот, `↑` (`W`) — тяга, `Space` — вогонь.

## Структура

```
src/
  loop.js input.js math.js        з Lab 1 (+ createRng, clamp у math.js)
  sim/                            БЕЗ DOM/canvas
    vector2.js                    Vector2 — незмінний, усі методи повертають новий
    entity.js                     Entity: #id (приватний лічильник), pos, vel, radius, kind, update
    behaviors.js                  lifetime, homing, pickup — композиція
    ship.js bullet.js asteroid.js Ship / Bullet / Asteroid extends Entity (один рівень)
    effects.js                    частинки, вибух, фабрика pickup
    world.js                      Map<id, Entity>, spawn/despawn + sweep, ofKind*, step
    game.js                       правила: рахунок, респаун 2 с, спавн астероїдів/pickup
  systems/collisions.js           коло-коло, O(n²), з урахуванням wrap-around
  render/                         canvas.js draw.js drawWorld.js (інтерполяція prev→curr)
```

## Як влаштовано

- **`World.step(dt)`**: `savePrevious` → `update` усіх → колізії → sweep мертвих. `despawn` лише позначає `alive = false`; видалення з `Map` відбувається наприкінці кроку, тож ітерація ніколи не ламається. Нові сутності (кулі, частинки) отримують перший `update` на наступному кроці.
- **Події** (`world.on/emit`): сутності лише повідомляють (`asteroidDestroyed`, `shipDestroyed`), а `Game` вирішує, що робити (вибух, рахунок, розділення великого астероїда, респаун). Сутності нічого не знають про правила гри.
- **Колізії** — окрема система: знаходить пари, `World` викликає `a.onCollide(b)` та `b.onCollide(a)`. Кулі б'ють усе, що має `takeDamage` (корабель, астероїд) і не належить власнику; таран астероїда вбиває його, але очок не дає.
- **Інкапсуляція**: у `Ship` — `#hp` і `get hp()` без setter (присвоєння кидає `TypeError`). `Entity.#nextId` — приватний статичний лічильник.
- **Детермінізм**: симуляція не використовує `Math.random`, лише `world.rng` (mulberry32 із seed). Тест «той самий seed і ввід → той самий світ» проходить.
- **Вогонь** запускається з кроку симуляції (`Space` у `Ship.update`), а не з DOM-слухача. Подія у випадковий момент між кадрами порушила б детермінізм.

## Експеримент із прототипами

`npm run demo:proto`:

```
Object.getPrototypeOf(a) === Ship.prototype                true
Object.getPrototypeOf(Ship.prototype) === Entity.prototype true
Object.getPrototypeOf(Entity.prototype) === Object.prototype true
a instanceof Ship / Entity                                 true / true
Object.keys(a)                                             world, alive, kind, pos, prevPos, vel, radius, angle, prevAngle, collidable, tag, behaviors, thrusting
Object.hasOwn(a, 'fire')  (method lives on the prototype)  false
a.fire === b.fire  (one shared function)                   true
Object.hasOwn(a, 'hp')  (#hp is private, hp is a getter)   false
Object.hasOwn(Ship.prototype, 'hp')                        true
a.id !== b.id                                              1 !== 2
```

`class` — синтаксичний цукор над прототипами: `ship → Ship.prototype → Entity.prototype → Object.prototype → null`. Методи живуть на прототипі в одному екземплярі, поля — на об'єкті. Приватні `#поля` у ланцюжок не потрапляють і не видні в `Object.keys`.

## Баг із `this` і його фікс

`Ship.fire()` читає `this.alive`, `this.world`, `this.angle`. `npm run demo:this`:

```
--- BUG ---
addEventListener('keydown', ship.fire) bullets spawned: 0
const { fire } = ship; fire()          THROWS TypeError: Cannot read properties of undefined (reading 'alive')
--- FIXES ---
arrow wrapper  () => ship.fire()       bullets spawned: 1
ship.fire.bind(ship)                   bullets spawned: 1
ship.fire.call(ship)                   bullets spawned: 1
```

**Причина.** `this` визначається способом виклику, а не місцем оголошення. Правила: (1) `new`; (2) явні `call/apply/bind`; (3) виклик як метод `obj.f()` — `this` це `obj`; (4) звичайний виклик `f()` — `undefined` у strict (модулі й тіла класів завжди strict). Стрілки власного `this` не мають і беруть його з оточення. `addEventListener('keydown', ship.fire)` передає голу функцію, тому браузер викликає її з `this` = елемент-мішень (правило 3 для мішені). `this.alive` там `undefined`, `fire()` мовчки повертає `false`, і кулі немає. Жодної помилки, тому такий баг особливо підступний. `const { fire } = ship; fire()` — правило 4, негайний `TypeError`.

**Фікси.**

1. Стрілка-обгортка `() => ship.fire()`: найпростіше, `this` задає виклик `ship.fire()`.
2. `ship.fire.bind(ship)`: нова функція з закріпленим `this`. Мінус: кожен виклик `bind` створює новий об'єкт, відписатися можна лише зберігши посилання.
3. Поле-стрілка в класі (`fire = () => {…}`): `this` закріплений назавжди, але метод стає власним полем кожного екземпляра, зникає з прототипу й `super.fire()` не працює.
4. **Вибір у грі:** взагалі не передавати метод слухачу. `Space` опитується в `Ship.update` (`input.isDown`), а `this` завжди правильний, бо виклик `this.fire()` йде зсередини класу.

## Дизайн-запис: композиція замість глибокої ієрархії

**Вимоги.** Homing потрібен кулі (наводиться на астероїди) і астероїду (наводиться на корабель). Pickup стоїть, колізиться і не є кораблем.

**Як виглядала б ієрархія.** `Entity → Bullet → HomingBullet`, `Entity → Asteroid → HomingAsteroid`, `Entity → Pickup`. Логіка наведення дублюється в `HomingBullet` і `HomingAsteroid`. Виносити її в спільного предка неможливо: у них різні предки, а множинного наслідування в JS немає. Якщо підняти homing у `Entity`, він зʼявиться й у корабля та частинок, яким не потрібен, з прапорцем `isHoming` у базовому класі. Кожна нова комбінація (homing + pickup, що летить до корабля; кулі з часом життя й без) додає клас: N незалежних можливостей дають до 2ᴺ підкласів. Через ранній `Pickup extends Entity` довелося б копіювати TTL з `Bullet` і `Particle`.

**Обраний підхід.** `Entity` має масив `behaviors`, а кожен behavior це невеликий обʼєкт із необовʼязковими хуками `update(entity, dt, world)` і `onCollide(entity, other, world)`. `homing({targetKinds, turnRate, range})`, `pickup(effect)` і `lifetime(seconds)` це фабрики-замикання. Тоді:

- homing-куля: `new Bullet({…, behaviors: [homing({targetKinds: ["asteroid"]})]})`;
- астероїд-мисливець: `new Asteroid({…, behaviors: [homing({targetKinds: ["ship"]})]})`;
- pickup: `new Entity({kind: "pickup", behaviors: [pickup(ship => ship.heal(1)), lifetime(15)]})`: жодного нового класу;
- TTL для куль і частинок один і той самий `lifetime`.

**Що лишилося класами.** `Ship`, `Bullet`, `Asteroid` — справжні «is-a» зі своїм станом та інваріантами (`#hp`, `takeDamage`, `fire()`); один рівень `extends` для спільних полів і методів. Композиція — для необовʼязкових можливостей, що перетинають типи.

**Компроміси.** Менше перевірок типів (behavior — структурний обʼєкт), а порядок behaviors має значення. Для пошуку є `entity.behavior("homing")`, який renderer використовує, щоб фарбувати homing-кулі в інший колір. Повноцінний ECS тут надмірний, але `Map<id, Entity>` у `World` і система колізій вже роблять перший крок до нього.

## Definition of Done

- [x] `Vector2` з чистими методами, `Entity` з `#id`, `Ship extends Entity`
- [x] `World` (Map, spawn/despawn + sweep, `ofKind*`, `step`)
- [x] Кулі з TTL, астероїди, `Ship.fire()` з носа, пояснення `this` та фікси
- [x] Колізії окремою системою, `#hp` + `get hp()`, вибух із частинок, респаун 2 с, рахунок на HUD
- [x] Homing і pickup композицією + дизайн-запис
- [ ] Тег `lab-02`
