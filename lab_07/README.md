# Dogfight — Lab 07: V8, пам’ять і тести

[![CI](https://img.shields.io/badge/CI-GitHub_Actions-2088ff?logo=github)](.github/workflows/lab-07.yml)

Лабораторна 7 продовжує гру з Lab 6: `shared`, `server` і `client` використовують одну детерміновану модель стану, а CI доводить, що клієнт і сервер рахують однаково. У гарячих місцях немає зайвих алокацій: кулі повторно беруться з `BulletPool`, частинки — з `ObjectPool`, пошук колізій виконується через toroidal `SpatialHash`.

## Швидкий запуск

Потрібні Node.js 22+ і npm.

```bash
nvm use
npm ci
npm run dev                 # сервер + Vite клієнт
# Відкрити http://localhost:5173 у двох вкладках
```

Повна локальна перевірка:

```bash
npm run typecheck
npm run check:assertions
npm run lint
npm run format:check
npm test                    # node:test Lab 6 + Vitest Lab 7
npm run coverage:shared     # shared має бути не нижче 85 %
npm run build
npm run playwright         # два Chromium-контексти: рух + чат
```

## Що додано в Lab 7

| Частина       | Реалізація                                    | Перевірка                                     |
| ------------- | --------------------------------------------- | --------------------------------------------- |
| Вектор і крок | `shared/src/math.ts`, `shared/src/sim.ts`     | round-trip, детермінізм, bounds               |
| Колізії       | `shared/src/spatialHash.ts`                   | wrapping на краях, зіткнення bullet/ship      |
| Пам’ять       | `shared/src/pool.ts`, `BulletPool`, `Effects` | повторне використання об’єктів                |
| Кадр          | `client/src/loop.ts`                          | fixed timestep, clamp, p50/p95/p99, fake RAF  |
| Протокол      | `shared/src/codec.ts`, `protocol.ts`          | довжина, биті буфери, fast-check              |
| Інтеграція    | `client/test/playwright.spec.ts`              | два браузери в одній кімнаті, рух і чат       |
| Боти          | `client/src/bot.ts`, `botWorker.ts`           | той самий `buttons` bit-mask, worker опційний |
| Навантаження  | `scripts/load.ts`                             | 8 / 32 / 64 / 128 headless клієнтів           |

Усього в Lab 7 — понад 60 тестів. П’ять property-based тестів fast-check перевіряють: input round-trip, округлення кута, довжину кадру, помилки битого буфера, межі арени та приймання/відхилення повідомлень.

## Профілювання V8 і пам’яті

Запис тестового прогону на 30 секунд для 8 ботів:

```bash
npm run profile
node --trace-gc --trace-gc-verbose --expose-gc node_modules/tsx/dist/cli.mjs scripts/profile.ts 2> artifacts/gc.log
```

Скрипт записує `artifacts/profile-after.json` з p50/p95/p99 кадру та статистикою `BulletPool`. Для Chrome DevTools:

1. Запустити `npm run dev`.
2. Відкрити **DevTools → Performance**, увімкнути **Screenshots** і **Memory**.
3. Записати 30 секунд з вісьмома ботами.
4. Зберегти trace як `artifacts/profile-after.json` або `.json.gz`.
5. Порівняти із записом до змін (`artifacts/profile-before.json`), дивитися Flame Chart і GC pauses.

Ціль: `p99 < 16.7 ms`, без довгих GC-пауз. Якщо результат на конкретній машині інший — у висновку фіксуються фактичні числа, а не вигаданий результат.

Приклад таблиці для звіту:

| Стан            |                      p50 кадру |                      p95 кадру |                      p99 кадру |           GC pause | Основний аллокатор             |
| --------------- | -----------------------------: | -----------------------------: | -----------------------------: | -----------------: | ------------------------------ |
| до пулу/hash    |              заповнити з trace |              заповнити з trace |              заповнити з trace |  заповнити з trace | заповнити з allocation profile |
| після пулу/hash | `artifacts/profile-after.json` | `artifacts/profile-after.json` | `artifacts/profile-after.json` | `artifacts/gc.log` | `BulletPool` / `ObjectPool`    |

Боти генерують той самий payload кнопок, що й людина. `createBotController({ useWorker: true })` виносить decision step у Web Worker; залишати worker у фінальній версії треба лише якщо повторний Performance trace показує прискорення main thread.

## Headless load test

Сервер має бути запущений окремо:

```bash
npm run start
npm run load
# або LOAD_SECONDS=10 SERVER_URL=ws://127.0.0.1:3000 npm run load
```

Скрипт послідовно підключає 8, 32, 64 і 128 WebSocket-клієнтів без вікна браузера, шле input і виводить p95 часу input-кроку. Перша кількість з `step > 33 ms` — межа для таблиці навантаження.

## CI

`.github/workflows/lab-07.yml` запускається на кожен `push` і `pull_request` у такому порядку:

1. `typecheck` для `shared`, `server`, `client`;
2. перевірка кількості `as`;
3. ESLint і Prettier;
4. `node:test` та Vitest;
5. coverage `shared`;
6. Playwright з Chromium;
7. production build.

Перед здачею замініть у badge посилання `OWNER/REPOSITORY` на фактичні owner і repo, якщо потрібен саме status badge GitHub Actions.

## Як зробити коміти, push і тег `lab-07`

Перейти в корінь **публічного** репозиторію Lab 6, не створювати новий репозиторій і не додавати секрети:

```bash
cd lab_06
# скопіювати сюди вміст цієї версії Lab 7
npm ci
npm run ci                 # швидка перевірка, якщо команда залишена з Lab 6
npm test
npm run playwright
```

Рекомендована історія комітів:

```bash
git status
git switch -c lab-07

git add shared client server scripts package.json package-lock.json README.md .github ci
 git commit -m "test: add shared vitest and fast-check properties"
git add .
git commit -m "perf: pool bullets and hash collisions"
git commit --allow-empty -m "ci: add lab 07 playwright and coverage"  # лише якщо CI-файл уже закомічений

git push -u origin lab-07
```

Якщо викладач очікує коміти в `main`, замість окремої гілки:

```bash
git switch main
git pull --rebase origin main
git add .
git commit -m "feat: complete lab 07"
git push origin main
```

Після того як GitHub Actions став зеленим, створити тег на **цей самий commit**:

```bash
git fetch origin
git tag -a lab-07 -m "Lab 07: V8, memory and tests"
git push origin lab-07
git ls-remote --tags origin lab-07
```

У здачу входять URL публічного репозиторію, гілка/commit і тег `lab-07`. Не робіть `git push --force` і не тегуйте commit, на якому CI ще червоний.

## 5-хвилинний захист

1. Показати гру з ботами без смикання та таблицю p50/p95/p99.
2. Відкрити один fast-check тест про округлення кута або битий буфер.
3. Пояснити, чому `stepWorld` детермінований для клієнта й сервера.
4. Показати, як `BulletPool` і `SpatialHash` зменшують алокації та кількість перевірок.
5. Відповісти, чи worker залишено після вимірювання main-thread, і від якої кількості headless клієнтів крок перевищує 33 ms.

## Reflection

- **Чому типи не захищають мережу?** TypeScript стирається, тому кожен JSON/ArrayBuffer проходить runtime-схему або `ProtocolError`.
- **Чому фіксований timestep кращий за `dt` від кадру?** Сервер, prediction і replay отримують однаковий крок; довгий кадр clamp-иться і не створює spiral of death.
- **Коли worker не варто залишати?** Якщо профайлер показує, що обмін повідомленнями дорожчий за обчислення бота або main thread не став швидшим.
- **Чому spatial hash не змінює результат?** Він змінює лише набір кандидатів; остаточна перевірка залишається тим самим wrapped distance і фіксованим порядком.
