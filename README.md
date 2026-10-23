# Solver: фото с очков → WhatsApp → ответ Claude

Схема: очки шлют фото контакту «Solver» в WhatsApp → GREEN-API (бесплатно) → Val Town (бесплатно) → Claude → ответ приходит в WhatsApp и всплывает на очках.
Всё настраивается с iPhone, компьютер не нужен.

## 0. Проверка очков (1 минута)
1. Meta AI app → Devices → Device settings → Communication → WhatsApp → Connect (основной WhatsApp).
2. Язык Meta AI: English.
3. Скажи: «Hey Meta, send a photo to <друг> on WhatsApp». Фото пришло другу? Если нет — дальше делать нет смысла.

## 1. Номер бота
1. App Store → WhatsApp Business → войти по второму номеру. Имя: Solver.
2. Если спросит про passkey (ключ входа) — «Не сейчас».
3. Настройки iPhone → Уведомления → WhatsApp Business → выключить.
4. Контакты → новый контакт «Solver» → второй номер с кодом страны.

## 2. GREEN-API
1. Safari → console.green-api.com → регистрация по почте.
2. «Создать инстанс» → тариф «Разработчик» (Developer, бесплатно). Подождать 2 минуты.
3. Открыть инстанс → «Связать по номеру телефона» → ввести второй номер → появится код из 8 знаков (живёт ~2 минуты).
4. Сразу: WhatsApp Business → Настройки → Связанные устройства → Привязка устройства → «по номеру телефона» → ввести код.
5. Скопировать в Заметки: apiUrl, idInstance, apiTokenInstance.

## 3. Ключ Claude
platform.claude.com → API keys → Create key → скопировать в Заметки.

## 4. Val Town
1. Safari → val.town → Sign up.
2. val.town/val/new → Name: `solver` → Create val.
3. В файле main.ts удалить всё и вставить одну строку, нажать Save:
   ```ts
   export { default } from "https://raw.githubusercontent.com/DavidManukan/Other/claude/solver-bot/solver.ts";
   ```
4. «+ Add trigger» → HTTP.
5. Слева «Env vars» → Add → 4 штуки:
   - `ANTHROPIC_API_KEY` = ключ Claude
   - `GREEN_URL` = apiUrl
   - `GREEN_ID` = idInstance
   - `GREEN_TOKEN` = apiTokenInstance
6. Над кодом «Copy HTTP endpoint» → открыть ссылку в Safari.
7. Увидишь ⏳ — подождать 5 минут и обновить. Должно быть три ✅.

## 5. Проверка
В WhatsApp написать Solver «ping» → придёт «pong ✅».

## Как пользоваться
«Hey Meta, send a photo to Solver on WhatsApp» → ответ через 10–40 секунд всплывёт на очках.
Если ушло старое фото: «Hey Meta, take a photo», потом «Hey Meta, send my last photo to Solver on WhatsApp».

## Важно
- Раз в 2 недели открывать WhatsApp Business, иначе бот отвяжется.
- Номер бота никому не давать: бесплатно только 3 чата в месяц.
- Если ты в России — VPN на телефоне всегда включён.
- Бот молчит → открыть ссылку из шага 4.6, там написано, что сломалось.
- Ошибается в решениях → в Env vars добавить `EFFORT` = `high`.
- Цена: примерно 1–3 цента за фото.
- Если строка из шага 4.3 не работает — вставить вместо неё весь код из `solver.ts`.
