# Dogfight — Lab 06: TypeScript для протоколу і симуляції

Три пакети (`shared`, `server`, `client`) і протокол із Lab 5 переведені на TypeScript. Гра поводиться як раніше: тест детермінізму, тест «передбачення = сервер» і e2e з двома справжніми клієнтами проходять.

## Запуск і перевірки

```bash
nvm use && npm install
npm run dev                # сервер (tsx watch) + Vite
npm run typecheck          # tsc --noEmit: shared, server, client — strict + noUncheckedIndexedAccess
npm run check:assertions   # кількість `as` < 5, кожне з коментарем
npm run lint && npm test && npm run build
npm run ci                 # усе підряд; ci/github-workflow.yml копіюється в <корінь репо>/.github/workflows/
```

`tsc` лише перевіряє типи, а запускає код `tsx` (сервер, тести) і Vite (клієнт): обидва просто стирають типи. Тому типи **не** захищають від даних із мережі, і всюди, де щось приходить ззовні, є рантайм-перевірка (див. «Zod»).

## Що змінилося

| | було (JS, Lab 5) | стало (TS) |
| --- | --- | --- |
| `shared/` | `.js`, `id`/`seq`/`tick` числа | `.ts`, branded `ShipId`/`BulletId`/`Tick`/`Seq`, `readonly`, `kind`, Zod |
| повідомлення | ручна перевірка в `protocol.js` (Lab 4) | схеми Zod, тип виводиться: `z.infer` |
| бінарний декодер | довжина + версія + ручні діапазони | довжина, версія, прапори, діапазони через ті самі схеми |
| конфіг | `readInt(...)` + `problems` | `EnvSchema` (Zod), один вхід у `process.env` |
| події кімнати | `EventEmitter` з рядками | `EventEmitter<RoomEvents>`: назва й аргументи перевіряються |
| `catch (e)` | `e.message` | `catch (err: unknown)` + `instanceof Error` |
| `any` | неявний скрізь | жодного (`no-explicit-any`, `strict`) |
| `as`-приведень | — | **0** (ліміт 4, див. `check:assertions`) |

Файли `.js` перейменовано в `.ts` по пакетах: спочатку `shared` (проходить `tsc` і 7 тестів), потім `server` (20 тестів), потім `client` (23 тести). `shared/tsconfig.json` має `lib: ["ES2022"]` і `types: []`: `window`, `process`, `Buffer` там просто не існують, тож DOM чи Node, що «просочилися» у симуляцію, це помилка компіляції (на додачу до ESLint).

## Які помилки знайшов TypeScript

Я перейменував файли Lab 5 на `.ts` і запустив `tsc` до будь-яких виправлень (з вимкненим `noImplicitAny`, щоб побачити суттєве). 348 помилок, більшість «властивість не оголошена» (JS-стиль `Object.assign(this, …)`). Серед них справжні дефекти:

1. **`server.address().port`** (`app.ts`): `address()` повертає `string | AddressInfo | null`. Для unix-сокета це рядок, `.port` дало б `undefined`, а `listening` залогувався б із `port: undefined`. Тепер `if (address === null || typeof address === "string") throw …`.
2. **`ws` ще `null`** (`app.ts`): `ws.close()` у `stop()` і `ws.count` у `sockets()` викликались, поки змінна була ініціалізована `null`. Порядок створення виправлено (`const ws` після `server`, замикання бачить його лише після `listen`).
3. **`clearTimeout(timer)` із `null`** (`ticker.ts`): `stop()` до `start()` передавав `null` у `cancel`; у тестовому `cancel` це була б помилка. Тепер `if (timer !== null)`.
4. **`session` можливо `null`** (`main.ts`, шість місць): `session = null` після `Esc` і виклики з `requestAnimationFrame`. Тепер локальна змінна `current` (замикання) і перевірка `if (session && sprites)`.
5. **`noUncheckedIndexedAccess`** (`interpolation.ts`): `while (snaps[i].tick > renderTick) i--` міг вийти за межі масиву (`snaps[-1]` це `undefined`). Цикл переписано без індексів.
6. **`Map.get` не гарантує значення** (`registry.ts`, `stats.ts`): `log.end()` у колбеку, де `log` міг бути `null`; `list[0][0]` на порожньому списку.

Типи ще зловили б помилку, якої немає в тестах: `world.bullets.map(stepBullet)` передає індекс як другий аргумент `dt`. Це компілюється (і `index` це `number`), тож у `stepWorld` я навмисно пишу `.map((b) => stepBullet(b))`. Це чесна межа можливостей типів: вони не знають, що `dt` не індекс.

## Три типи простими словами

**Branded-тип** (`Seq`, `Tick`, `ShipId`). Це число з «наклейкою» на рівні типу. `Seq` і `Tick` обидва числа, але функція, що чекає `Seq`, не прийме `Tick`: наклейка існує лише під час компіляції (`z.number().brand<"Seq">()`), у виконанні це те саме число, тому нічого не коштує. Виготовити `Seq` можна лише через `Seq.parse(n)`: це перевірка діапазону й видача наклейки одним рухом, без `as`. Раніше `lastSeq` і `tick` можна було переплутати, і ніхто б не помітив.

**Дискримінований union + `never`** (`kind`, `type`). Значення може бути одним із кількох варіантів, а спільне поле-мітка (`kind: "ship" | "bullet"`, `type: "join" | "chat" | …`) каже, яким саме. `switch` по мітці звужує тип у кожній гілці (в гілці `"ship"` є `hp`, у `"bullet"` немає). У `default` стоїть `assertNever(x)`, що приймає `never`: якщо додати новий варіант і забути гілку, у `default` потрапить значення не типу `never`, і `tsc` не збереться. Так працює `handle()` у `ws.ts`, `drawScene`, `RoomGame.tick`, `GameSession.#onControl` і `main.ts`.

**`unknown` проти `any`.** `any` вимикає перевірку: з ним можна робити що завгодно, і помилки вилізуть у проді. `unknown` це «щось, чого я ще не знаю»: використати його можна лише після перевірки (`typeof`, `instanceof`, Zod). Тому `JSON.parse`, `response.json()`, `catch (err)` і тіло HTTP-запиту в нас `unknown`, а `parseClientMessage(value: unknown)`.

## Zod на вході в процес

Типи стираються при збірці, тому все, що приходить ззовні, проходить схему: JSON-повідомлення клієнта й сервера, JSON-знімок, бінарний знімок (поля декодуються й перевіряються тими самими `ShipSnap`/`BulletSnap`), змінні оточення, тіло `POST /api/rooms`, відповіді `/api/rooms`, маніфест і атлас спрайтів. Тип отримується зі схеми (`z.infer`), тож опис і перевірка не розходяться. Невдала перевірка ніколи не кидає виняток у `parseClientMessage`: `ws.ts` логує `connection rejected` і закриває сокет із кодом (1007 не JSON, 1008 форма/тип, 1009 розмір), як у Lab 4. Ручні `SCHEMAS`, `NAME_RE`, `readInt` видалені.

**Ціна.** Декодер тепер валідує кожне поле, тож він повільніший (`npm run bench -w @dogfight/shared`, Node):

| сцена (кораблі+кулі) | JSON, байт | binary, байт | encode+decode JSON, мкс | binary, мкс |
| --- | --- | --- | --- | --- |
| 2+0 | 509 | 65 | 12.8 | 5.0 |
| 2+6 | 1396 | 209 | 26.0 | 10.5 |
| 8+24 | 5467 | 809 | 108.7 | 44.2 |

Бінарний знімок досі в 2.5 раза швидший за JSON і в ≈ 7 раз менший (JSON трохи виріс, бо тепер кожна сутність несе `kind`). Для 30 знімків/с це ≈ 0.3 мс на кадр у найбільшій сцені: прийнятно.

## Фреймворк

Не взято. Canvas і цикл за умовою лишаються без фреймворку, а решта UI це два екрани (лобі й чат) на ~200 рядків з `h()`, де весь DOM будується через `textContent`. Свіжий Svelte/Vue/React додав би збірку, залежності й другу модель оновлення поруч із циклом `requestAnimationFrame`, а виграш (реактивність списку з кількох кімнат) малий. Типізована `TypedEvents` (дженерик над мапою подій) покриває головну потребу, що її дав би фреймворк: гарантовано правильні підписки.

## Definition of Done

- [x] shared → server → client на `.ts`, `strict` + `noUncheckedIndexedAccess`, жодного `any`
- [x] branded `ShipId`/`BulletId`/`Tick`/`Seq`, `readonly` у знімках і `Vec2`, дискримінований union із `kind`, `assertNever` у кожному switch
- [x] Zod: протокол, JSON-знімок, конфіг, HTTP-тіло, маніфест, атлас; `parseClientMessage(unknown)` не кидає
- [x] `as`: 0 (< 5), `catch` лише `unknown`, типізовані події кімнати
- [x] `npm run typecheck` у CI (`ci/github-workflow.yml`)
- [ ] Тег `lab-06`
