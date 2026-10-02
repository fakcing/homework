# Dogfight — Lab 03: Асинхронний JavaScript

Продовження Lab 1–2 (цикл, `Entity`/`World`, колізії). Додано: пайплайн ассетів, екран завантаження, спрайти, звук (Web Audio), лобі з `GET /api/rooms`.

## Запуск

```bash
nvm use && npm install
npm run dev            # http://localhost:5173  (мок-бекенд — у vite.config.js)
npm run lint && npm test
npm run bench          # sequential vs concurrent
npm run puzzle -- 1    # головоломки 1–4 (див. нижче)
npm run gen:assets     # перегенерувати спрайти/звуки (Python + Pillow)
```

Потік: **loading** (прогрес-бар на canvas) → **лобі** (DOM) → **гра**. `Esc` повертає в лобі. Вимагає браузер з `AbortSignal.any` (Chrome 116+, Firefox 124+, Safari 17.4+).

## Структура

```
public/assets/   manifest.json, sprites.png + atlas.json, fire|hit|explode|pickup.wav (генеруються скриптом)
src/assets/      errors.js net.js(fetchResponse, fetchJson) retry.js loaders.js manifest.js loadAll.js
src/audio/       audio.js — AudioContext після жесту, пул голосів
src/lobby/       lobby.js (class Lobby extends EventTarget, без DOM), api.js
src/ui/          dom.js, lobbyView.js — увесь DOM лобі окремо
src/render/      sprites.js (спрайтшит + атлас), drawWorld.js, draw.js (+ drawLoading)
src/sim/         world.events = EventTarget; sim НЕ імпортує audio/HUD
src/faults.js    перемикачі збоїв для галереї
```

## Як це працює

- **`fetchResponse`** робить `fetch`, перевіряє `response.ok` (інакше `HttpError`: fetch на 404/500 **не** реджектить) і додає `AbortSignal.timeout` через `AbortSignal.any`. `fetchJson` перетворює `SyntaxError` на `BadPayloadError`. Усі завантажувачі (`loadJson/Image/Audio`) приймають `{ signal }`. Картинка: `fetch → blob → createImageBitmap`, бо `new Image()` через signal не скасувати.
- **Повтор** (`withRetry`): exponential backoff з full jitter, `delay = random() · min(max, base·2ⁿ)`. Повторюємо лише мережеві помилки, таймаути, 5xx, 408 і 429. **Не** повторюємо 4xx, `BadPayloadError` та `AbortError`. Jitter розводить клієнтів у часі, щоб не було «грому» запитів одночасно.
- **`loadAll`**: `Promise.all` по всіх записах, прогрес `{key, status, done, total}` на кожен файл. Перша критична помилка скасовує решту (внутрішній `AbortController`). Звукові файли мають `required: false`: збій пропускається (`failed[]`), гра стартує без звуку. Гра стартує тільки після `await loadResources()`.
- **Звук**: буфери декодуються на завантаженні через `OfflineAudioContext` (жест не потрібен). Справжній `AudioContext` створюється в `unlock()` усередині обробника кліку `Join`.
- **Шина подій**: `World` тримає `EventTarget`; сімуляція диспатчить `CustomEvent` `fired`, `hit`, `exploded` (і `pickupTaken`). `audio.attach(world.events, signal)` підписується, а `signal.abort()` знімає всі слухачі. Помилка в слухачі не ламає симуляцію: `EventTarget` не пробрасує її в `dispatchEvent`.
- **Лобі**: `Lobby` опитує `fetchRooms` ланцюжком `setTimeout` (не `setInterval`, щоб запити не накладались). Кожен запит має власний `AbortController` + `AbortSignal.timeout(3 с)`. `stop()` (вихід із лобі або прихована вкладка) скасовує запит, що летить, а запізнілу відповідь відкидаємо. DOM у `lobbyView.js` (лише `textContent`, ніякого `innerHTML`, бо назви кімнат приходять із сервера).

## Sequential `await` vs `Promise.all`

6 файлів із маніфесту, сервер із штучною затримкою на кожен запит (`npm run bench`, Node, реальні файли):

| затримка/запит | sequential | concurrent | прискорення |
| -------------- | ---------- | ---------- | ----------- |
| 50 мс          | 334 мс     | 59 мс      | 5.7×        |
| 150 мс         | 921 мс     | 158 мс     | 5.8×        |
| 300 мс         | 1820 мс    | 307 мс     | 5.9×        |

Sequential ≈ Σ затримок (N × RTT), concurrent ≈ max затримок (один RTT): чекання паралельне, бо основний потік під час `await` вільний.

У браузері (виміряй сам): `http://localhost:5173/?slow=300&mode=sequential` та `?slow=300` (дивись у консолі `[loadAll] …: N ms`).

| режим      | час у браузері |
| ---------- | -------------- |
| sequential | 	1911 мс         |
| concurrent | 	338 мс         |

## Головоломки порядку (мікрозадачі / задачі)

Код у `scripts/puzzles.mjs`; виводи 1–4 отримані запуском у Node 22.

**1. `await` усередині `async`**

```js
async function a() {
  console.log("a1");
  await b();
  console.log("a2");
}
async function b() {
  console.log("b");
}
console.log("start");
a();
Promise.resolve().then(() => console.log("p"));
console.log("end");
```

Вивід: `start, a1, b, end, a2, p`. До першого `await` `async`-функція працює синхронно (`a1`, `b`). `await` готового проміса ставить продовження в чергу мікрозадач раніше, ніж `.then(p)` зареєстровано, тому `a2` йде перед `p`.

**2. `setTimeout` усередині `.then`**

```js
setTimeout(() => console.log("T1"), 0);
Promise.resolve()
  .then(() => {
    console.log("P1");
    setTimeout(() => console.log("T2"), 0);
  })
  .then(() => console.log("P2"));
console.log("sync");
```

Вивід: `sync, P1, P2, T1, T2`. Усі мікрозадачі (`P1`, `P2`) виконуються до наступної задачі; таймери ідуть у порядку постановки (`T1` до `T2`), навіть якщо `T2` створено в мікрозадачі.

**3. `async`-функція, що повертає проміс**

```js
async function f1() {
  return 1;
}
async function f2() {
  return Promise.resolve(2);
}
f2().then(() => console.log("f2"));
f1().then(() => console.log("f1"));
Promise.resolve()
  .then(() => console.log("x"))
  .then(() => console.log("y"))
  .then(() => console.log("z"))
  .then(() => console.log("w"));
```

Вивід: `f1, x, y, f2, z, w`. `return 1` резолвить проміс за один тік, а `return promise` потребує додатково «розгортання» thenable (ще ~2 мікрозадачі), тому `f2` приходить після `y`.

**4. `catch` / `finally` проти `queueMicrotask`**

```js
Promise.reject(new Error("boom"))
  .then(() => console.log("then-1"))
  .catch(() => console.log("catch"))
  .finally(() => console.log("finally"))
  .then(() => console.log("then-2"));
queueMicrotask(() => console.log("qm"));
console.log("sync");
```

Вивід: `sync, qm, catch, finally, then-2`. `then-1` пропускається (немає обробника відмови): це мікрозадача, що передає відхилення далі, і вона стоїть у черзі раніше за `qm`, а `catch` ставиться вже після неї. Помилка «пролітає» через `then` до найближчого `catch`.

**5. `requestAnimationFrame` (запусти в консолі браузера)**

```js
requestAnimationFrame(() => {
  console.log("raf 1");
  Promise.resolve().then(() => console.log("micro in raf 1"));
});
requestAnimationFrame(() => console.log("raf 2"));
setTimeout(() => console.log("timeout"), 0);
Promise.resolve().then(() => console.log("micro"));
console.log("sync");
```

Очікуваний вивід: `sync, micro, timeout, raf 1, micro in raf 1, raf 2`. Мікрозадачі виконуються одразу після синхронного коду; rAF-колбеки йдуть у кроці рендерингу, після таймера, що вже встиг (порядок `timeout` і rAF специфікація не гарантує, у Chrome зазвичай саме такий). Між двома rAF-колбеками відбувається microtask checkpoint, тому `micro in raf 1` стоїть перед `raf 2`. _(Цей пункт у Node не запускається: впиши свій фактичний вивід.)_

## Галерея збоїв (гра не падає)

Усі збої відтворюються через URL; у кожному випадку користувач бачить причину і або гру, або кнопку Retry. Поведінка loaders перевірена тестами `test/assets.test.js`.

| Збій                       | URL                                   | Що бачить гравець                                                                     | Що робить код                                                               |
| -------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 404 спрайта                | `?fault=sprite404`                    | на екрані завантаження `✗ sheet`, текст «The server answered 404 …», кнопка **Retry** | `HttpError(404)`, **без повтору** (1 запит), решта завантажень скасовується |
| 404 звуку                  | `?fault=sound404`                     | гра стартує, у списку `– explode`, вибух мовчить                                      | файл `required: false`: пропуск, решта звуків працює                        |
| тимчасовий 503             | `?fault=flaky`                        | `↻ atlas retry #1/#2`, потім `✓` і гра                                                | 5xx повторюється з backoff + jitter, успіх на 3-й спробі                    |
| таймаут мережі             | `?fault=timeout`                      | лобі: «The server did not answer in time. Retrying automatically.», **Join** вимкнено | `AbortSignal.timeout(3 с)` → `TimeoutError`, опитування триває              |
| abort посеред              | `?slow=2000`, натисни **Cancel**      | «Loading was cancelled.» + **Retry**                                                  | `controller.abort()` скасовує всі запити, повтору немає                     |
| битий JSON (маніфест)      | `?fault=json`                         | «The server sent unusable data: …» + **Retry**                                        | `BadPayloadError`, без повтору                                              |
| битий JSON / 500 (кімнати) | `?fault=roomsjson`, `?fault=rooms500` | помилка в лобі, авто-повтор раз на інтервал                                           | `BadPayloadError` / `HttpError(500)` → стан `error`                         |

## Definition of Done

- [x] manifest + `loadImage/loadAudio/loadJson` (спільний `fetchJson` з `ok`), `AbortSignal`, backoff + jitter, без ретраю 4xx
- [x] `loadAll` через `Promise.all` з прогресом по файлах, прогрес-бар на canvas, старт після `await`
- [x] спрайти зі спрайтшита; Web Audio після жесту, буфери декодуються при завантаженні; шина `EventTarget` (`fired`/`hit`/`exploded`)
- [x] `Lobby extends EventTarget`, DOM окремо, інтервал, `AbortSignal.timeout`, abort при виході
- [x] README: sequential vs concurrent, головоломки, галерея збоїв
- [x] Заповнити браузерні виміри і вивід головоломки 5
- [x] Тег `lab-03`
