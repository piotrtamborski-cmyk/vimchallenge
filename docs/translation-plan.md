# vimchallenge: przegląd tekstu angielskiego i plan tłumaczeń

Języki docelowe: **de, es, it, pl, pt, fr** (plus angielski jako źródło).
Stan na 2026-11-27, commit `b0612cf`.

---

## 1. Przegląd tekstu angielskiego

Przeczytałem cały tekst, który widzi gracz: wszystkie strony (`apps/web/app`), komponenty (`apps/web/components`),
komunikaty serwera (`apps/web/lib`), e-mail logowania (`packages/accounts/src/mail.ts`), komunikaty edytora
(`packages/engine/src/browser.ts`) oraz pełną treść 18 lekcji (`lessons.json`, ok. 2,7 tys. słów) i 80 zadań na trzech
tekstach każde (`tasks.json`: tytuły, polecenia, opisy kroków, ok. 4,6 tys. słów).

> **Stan:** poprawki z tabel poniżej oraz ujednolicenie terminologii są naniesione (2026-11-27), łącznie z e-mailem
> logowania i jednym komunikatem o nazwie gracza (`NAME_RULES` w `apps/web/lib/auth/messages.ts`). Otwarte zostają
> punkty z „Co w kodzie utrudni tłumaczenie” (sklejane zdania, liczba mnoga, `Intl`, kody z silnika), bo należą do
> etapu 1. Surowe kody w komunikatach (`Could not start: …`, `body.error`, `reason`) są już zastąpione zdaniami.

### Ocena ogólna

Tekst jest dobry: poprawny gramatycznie, krótki, rzeczowy i spójny w tonie. Lekcje są naprawdę klarowne, a polecenia
zadań precyzyjne (mówią, co ma się zgadzać na końcu, a nie które klawisze nacisnąć). Pisownia jest brytyjska (*practise*,
*neighbouring*, *colour*, *full stop*, *cancelled*, *tick the box*) z końcówką *-ize* (*Capitalize*), czyli w praktyce
pisownia oksfordzka. To jest spójne i warto ją zostawić.

Powtarzają się za to trzy rzeczy, które zdradzają, że autor myśli po polsku:

1. **Nadmiar „the” w przyciskach i nagłówkach**: *Create the room*, *Go to the room*, *Start the match*, *Leave the
   room*, *Delete the account*, *The set of this day*, *The table of the day*. Po angielsku przyciski to zwykle
   *Create room*, *Start match*, *Delete account*.
2. **Konstrukcje w dopełniaczu i ze strony biernej**: *the share of the most the set could give*, *Your run of
   2026-11-27*, *Your account and its progress are deleted*, *or was already used*.
3. **Zdania ścisnięte do granic czytelności**: *Hidden, you still see your own place, and others do not see you at
   all*, *the link signs you in once, within 15 minutes*.

### Do poprawienia: błędy treści (wprowadzają gracza w błąd)

| Gdzie | Jest | Proponuję | Dlaczego |
|---|---|---|---|
| [sign-in/page.tsx:26](../apps/web/app/sign-in/page.tsx#L26) | An account keeps your solved tasks and, later, your place in rooms and leaderboards. Training works without one. | An account keeps your progress and puts you on the daily challenge leaderboards. Practice and rooms work without one. | Rankingi już działają („later” jest nieaktualne), a pokoje nie wymagają konta. |
| [rooms/page.tsx:28](../apps/web/app/rooms/page.tsx#L28) | …each round goes to the fastest correct check. | …every correct solve scores, and faster solves score more. | Punktacja jest za każde rozwiązanie z bonusem za czas, a nie „zwycięzca bierze wszystko”. Zdanie przeczy sekcji „How a match is scored”. |
| [tasks.json](../packages/tasks/tasks.json), `select-words`, tekst 1 | Select characters from the `b` in `beta` to the last `a` in `gamma`, inclusive. | …inclusive, and submit while the selection is still active (Alt+Enter or Check). | Tekst 1 wymaga aktywnego zaznaczenia na końcu, ale tylko teksty 2 i 3 to mówią. Gracz może nacisnąć `<Esc>` i nie zaliczyć. |
| [server-check.ts:50](../apps/web/lib/server-check.ts#L50) | Too many checks from your network; the server checks again in 60 s. | Too many checks from your network. Try again in 60 s. | Serwer niczego sam nie sprawdzi ponownie; to gracz musi spróbować jeszcze raz. |
| [Room.tsx:16](../apps/web/components/Room.tsx#L16) | `solved: 'finished'` | `solved: 'solved'` | W tabeli wyników *finished* nie odróżnia rozwiązania od pominięcia czy końca czasu. |
| [Daily.tsx:274](../apps/web/components/Daily.tsx#L274) | Your run of 2026-11-27: … | Your run on 27 November 2026: … | Surowa data ISO i dziwny przyimek. |
| Nazwa gracza (3 miejsca: [rooms/page.tsx:10](../apps/web/app/rooms/page.tsx#L10), [rooms/[code]/page.tsx:13](../apps/web/app/rooms/%5Bcode%5D/page.tsx#L13), [messages.ts](../apps/web/lib/auth/messages.ts)) | A name has 3 to 24 letters, digits, - or _… | A name has 3 to 24 characters: Latin letters without accents (A–Z), digits, - or _, and starts with a letter or a digit. | Po przetłumaczeniu Polak wpisze *Łukasz*, Hiszpan *José*, a komunikat powie tylko „letters”. Komunikat trzeba też trzymać w jednym miejscu. |

### Do poprawienia: niezręczne sformułowania

| Gdzie | Jest | Proponuję |
|---|---|---|
| [sign-in/page.tsx:34](../apps/web/app/sign-in/page.tsx#L34) | Check your inbox: the link signs you in once, within 15 minutes. | Check your inbox. The link works once and expires in 15 minutes. |
| [sign-in/page.tsx:36](../apps/web/app/sign-in/page.tsx#L36) | Your account and its progress are deleted. | Your account and its progress have been deleted. |
| [sign-in/email/page.tsx:22](../apps/web/app/sign-in/email/page.tsx#L22) i [messages.ts:35](../apps/web/lib/auth/messages.ts#L35) | …or was already used. | …or has already been used. |
| [sign-in/email/page.tsx:48](../apps/web/app/sign-in/email/page.tsx#L48) | …so you can sign in with links to it? | …so you can also sign in with links sent there? |
| [sign-in/email/page.tsx:52](../apps/web/app/sign-in/email/page.tsx#L52) | If you have no account yet, this makes one. | If you don't have an account yet, this creates one. |
| [messages.ts:70](../apps/web/lib/auth/messages.ts#L70) | The address is added: you can sign in with a link to it from now on. | Address added. From now on you can sign in with a link sent to it. |
| [account/page.tsx:165](../apps/web/app/account/page.tsx#L165) | Hidden, you still see your own place, and others do not see you at all. | If hidden, you still see your own place, but others don't see you at all. |
| [account/page.tsx](../apps/web/app/account/page.tsx) | A device signs out by itself after 30 days without a visit. / Sign out on every other device | A device is signed out automatically after 30 days without a visit. / Sign out of all other devices |
| [TaskPlayer.tsx:124](../apps/web/components/TaskPlayer.tsx#L124) | You solved this task 3 times, in 12 keys at best | You've solved this task 3 times. Best: 12 keys |
| [TaskPlayer.tsx:192](../apps/web/components/TaskPlayer.tsx#L192), [:214](../apps/web/components/TaskPlayer.tsx#L214) | Practise on new text → / Or try it on new text → | Practise on another text → / Or try another text → |
| [rooms/[code]/page.tsx:46](../apps/web/app/rooms/%5Bcode%5D/page.tsx#L46) i Room.tsx | A match is under way; you play in the next one. | A match is under way. You'll play in the next one. |
| [rooms/page.tsx:92](../apps/web/app/rooms/page.tsx#L92) | A round lasts four times the reference time, at least a minute, or until everyone has finished. | A round lasts four times the reference time (at least one minute), or ends sooner once everyone has finished. |
| [Daily.tsx:143](../apps/web/components/Daily.tsx#L143) | One go per account and day. | One go per account per day. |
| [Daily.tsx:277](../apps/web/components/Daily.tsx#L277), [leaderboards/page.tsx:90](../apps/web/app/leaderboards/page.tsx#L90) | the share of the most the set could give, out of 1000 | your share of the set's maximum, scaled to 1000 |
| [Daily.tsx:315](../apps/web/components/Daily.tsx#L315) | The table of the day is final once… A new set comes at midnight UTC. | The day's leaderboard is final once… A new set arrives at midnight UTC. |
| [leaderboards/page.tsx:144](../apps/web/app/leaderboards/page.tsx#L144) | The set of this day | This day's set |
| Przyciski | Create the room · Go to the room · Start the match · Leave the room · Delete the account · Add the address | Create room · Go to room · Start match · Leave room · Delete account · Add address |
| Prywatność | …or the user number GitHub or Google gives the account you sign in with, with the address they verified for it. | …or the user ID that GitHub or Google gives your account there, together with the email address they verified. |
| Prywatność | Sign-in links sent by email, with their address, for a day. | Sign-in links we email you, with the address they went to, for one day. |
| Prywatność | …so the room knows them again | …so the room recognises them |
| Lekcja *Moving the cursor* | …so you need not reach for the arrow keys. | …so you don't have to reach for the arrow keys. |
| Lekcja *Line ranges* | `:t` copies lines and `:m` moves them, each to below the line you name | `:t` copies lines and `:m` moves them, in both cases to just below the line you give |
| Lekcja *Line ranges* | `.` is the current line, `$` the last one and `%` all of them. | `.` is the current line, `$` the last one, and `%` means the whole file. |
| Lekcja *Visual selection* | …press Check, or Alt+Enter, while it is. | …press Check or Alt+Enter while it is still active. |
| Zadanie `repeat-a-change`, tekst 3 | Change both `small` to `large`. | Change both occurrences of `small` to `large`. |
| Zadanie `mark-fix-and-return` | Mark the starting letter with `a`. | Set mark `a` on the letter under the cursor. |
| Zadanie `substitute-on-matching-lines` | …every line of type `X`. | …every line that starts with `X`. |
| Sekcje lekcji | Motion and range · Control of changes · Edits in several steps | Moving around · Changing text · Multi-step edits |

### Spójność terminologii

- **training / practice / tasks**: nawigacja mówi *Tasks*, a teksty *in training* (Daily, prywatność, logowanie).
  Proponuję jedno słowo: *practice* (rzeczownik) dla trybu bez czasu, a *task* dla pojedynczej karty. *Exercise* zostaje
  dla zadania w obrębie lekcji, bo to świadome rozróżnienie.
- **table / leaderboard**: *Yesterday's table*, *See the table*, *the public table* obok *leaderboards*. Proponuję
  wszędzie *leaderboard* (tabela meczu w pokoju może zostać *standings*).
- **backward / backwards**: lekcja *Search* ma *Search backward*, reszta *backwards*. Proponuję wszędzie *backwards*.
- *solve* jako rzeczownik (*A solve earns*, kolumna *Solves*) jest naturalne w żargonie speedcubingu. Zostawiam, ale
  tłumacze muszą wiedzieć, że to „rozwiązanie zaliczone przez serwer”.

### Co w kodzie utrudni tłumaczenie (naprawić przed tłumaczeniem)

1. **Zdania sklejane z kawałków**: *Stuck? The lesson(s) A and B explain(s)…* ([TaskPlayer.tsx](../apps/web/components/TaskPlayer.tsx)),
   *{n} day(s) of the daily challenge played…* ([account/page.tsx](../apps/web/app/account/page.tsx)),
   *{n} player(s) here: …*. W polskim i niemieckim szyk, przypadek i rodzaj zmieniają całe zdanie, więc każde zdanie
   musi być jednym komunikatem z miejscami na wartości, a listy trzeba łączyć przez `Intl.ListFormat`.
2. **Liczba mnoga przez `=== 1 ? 'key' : 'keys'`**: jest w kilkunastu miejscach, a polski ma trzy formy (1 klawisz,
   2 klawisze, 5 klawiszy). Potrzebny jest `Intl.PluralRules`. Do tego `{l.tasks.length} exercises` w
   [lessons/page.tsx:37](../apps/web/app/lessons/page.tsx#L37) nie ma w ogóle liczby pojedynczej.
3. **Na sztywno wpisany format `en-GB`**: [LocalTime.tsx:14](../apps/web/components/LocalTime.tsx#L14),
   [leaderboards/page.tsx:17](../apps/web/app/leaderboards/page.tsx#L17), godzina w
   [account/page.tsx](../apps/web/app/account/page.tsx) (ISO). Sekundy przez `toFixed(1)` dają „12.5 s”, a w pięciu
   z sześciu języków powinno być „12,5 s”.
4. **Angielski z serwera i silnika trafia prosto do gracza**:
   - [server-check.ts:53](../apps/web/lib/server-check.ts#L53) dokleja `body.error` z API (*the judge is not available*);
   - [TimedTask.tsx:125](../apps/web/components/TimedTask.tsx#L125) i [server-check.ts:43](../apps/web/lib/server-check.ts#L43) pokazują surowy kod powodu;
   - [Room.tsx:161](../apps/web/components/Room.tsx#L161) pokazuje surowy kod (*Could not start: xyz*);
   - edytor zgłasza teksty, a nie kody: *Pasting is turned off here*, *Paste in Insert mode*, *X is not supported*
     ([browser.ts:127-147](../packages/engine/src/browser.ts#L127)).

   Zasada: serwer i silnik zwracają **kody**, a tłumaczy je wyłącznie interfejs.
5. **Treść zadań przychodzi z serwera po angielsku**: widoki pokoju i wyzwania dnia
   (`TaskView.title/prompt`, `title` w tabelach) są składane z banku w pakietach `rooms` i `daily` i wysyłane przez
   SSE/JSON. `TaskView` ma `id` i `text`, więc da się je podmienić na brzegu (patrz 4.4).
6. `<html lang="en">` jest na sztywno w [layout.tsx:24](../apps/web/app/layout.tsx#L24).

---

## 2. Co tłumaczymy, a czego nie

| Tłumaczymy | Objętość (EN) |
|---|---|
| Interfejs: strony, komponenty, komunikaty błędów i powiadomień, tytuły i opisy stron (metadata) | ok. 250 komunikatów, ok. 3 tys. słów |
| Lekcje: sekcja, tytuł, podsumowanie, akapity, opisy klawiszy (`does`) | ok. 2,7 tys. słów |
| Zadania: tytuł, polecenie każdego tekstu, opisy kroków (`expected.steps[].label`) | ok. 4,6 tys. słów, z czego unikalnych mniej niż połowa (warianty się powtarzają) |
| E-mail z linkiem logowania (temat, treść, HTML) | ok. 60 słów |
| Strona prywatności | ok. 700 słów (w sumie z interfejsem) |

Razem ok. 10 tys. słów na język, czyli ok. 60 tys. słów dla sześciu języków.

**Nie tłumaczymy:**

- **Tekstu w edytorze** (`initial.lines`, `expected.lines`, czyli *cat*, *notes*, *DROP* i tak dalej). Od niego zależą
  rozwiązanie, `keys`, `referenceSeconds`, wersja zadania i sędzia. Wyzwanie dnia i pokoje muszą dawać **ten sam tekst
  wszystkim** graczom, niezależnie od języka, bo inaczej wyniki nie byłyby porównywalne. Polecenia odwołują się do tego
  tekstu w `` `…` ``, a fragmenty w backtickach zostają nietknięte.
- **Notacji Vima i nazw trybów na pasku** (`-- NORMAL --`, `-- INSERT --`). Tak wygląda Vim z domyślnym
  `LANG=C`, tak opisuje to każda dokumentacja i tak pokazuje lekcja 1. W treści lekcji tryby tłumaczymy („tryb
  normalny”), a w nawiasie podajemy etykietę z paska.
- README, dokumentacji wdrożenia, komentarzy w kodzie i komunikatów API przeznaczonych dla programistów.

---

## 3. Adresy i wybór języka

### 3.1 Adresy URL

- **Angielski bez prefiksu** (`/lessons`, `/rooms/abc123`), pozostałe języki z prefiksem: `/de/lessons`, `/pl/lessons`
  i tak dalej. Istniejące linki (zaproszenia do pokoi, linki z e-maili, zakładki) dalej działają.
- `/api/*` zostaje bez prefiksu.
- Każdy język ma własny adres, więc Google indeksuje wszystkie wersje, można je podlinkować i udostępnić, a odświeżenie
  nie zmienia języka.

### 3.2 Wybór ręczny

- Przełącznik w stopce i w nagłówku (ikona globusa z kodem, na przykład `PL`), z listą nazw **w ich własnym języku**:
  English, Deutsch, Español, Français, Italiano, Polski, Português. Bez flag, bo flaga oznacza kraj, a nie język
  (portugalski to też Brazylia, hiszpański to też Meksyk).
- Wybór prowadzi do **tej samej strony** w innym języku (`/pl/tasks/search?text=2` → `/de/tasks/search?text=2`)
  i zapisuje cookie `vc_lang` (rok, `SameSite=Lax`).
- Później, opcjonalnie: zalogowany gracz może mieć język zapisany na koncie, żeby działał na każdym urządzeniu.
  Na razie wystarczy cookie, bo na koncie nic jeszcze nie zależy od języka.

### 3.3 Wybór automatyczny przy wejściu

Proxy ([proxy.ts](../apps/web/proxy.ts)) i tak działa przed każdą stroną, więc decyzja zapada tam, bez dodatkowego
kosztu. Strony i tak są renderowane przy każdym żądaniu (nonce CSP).

Kolejność, od najważniejszego:

1. **Adres z prefiksem** (`/de/...`) zawsze wygrywa. To, co ktoś wkleił albo kliknął, nigdy nie jest przekierowywane.
   Proxy zapisuje wtedy `vc_lang=de`, czyli zapamiętuje „ostatnio używany język”.
2. **Adres bez prefiksu i cookie `vc_lang`**: jeśli cookie wskazuje inny język niż angielski, następuje
   przekierowanie 307 na `/{lang}/...` z zachowaniem ścieżki i query. Jeśli wskazuje `en`, zostaje angielski.
3. **Brak cookie**: proxy negocjuje język z nagłówka `Accept-Language` (z wagami `q`, dopasowanie po podstawowym tagu:
   `de-AT` → `de`, `pt-PT` → `pt`, `es-419` → `es`). Jeśli wypadnie obsługiwany język inny niż angielski,
   następuje przekierowanie i zapis cookie. W przeciwnym razie angielski.
4. Roboty wyszukiwarek zwykle nie wysyłają `Accept-Language`, więc dostają angielski pod adresem bez prefiksu i
   resztę przez `hreflang` (3.4). Google odradza przekierowania po języku właśnie dlatego, że roboty by ich nie
   przeszły, a punkt 1 to gwarantuje.

Szczegóły:

- Przekierowanie ma `Cache-Control: private, no-store` i `Vary: Accept-Language, Cookie`, żeby Cloudflare nigdy
  nie podał jednej osobie wersji innej osoby.
- Na stronie po automatycznym przekierowaniu pokazujemy raz dyskretny pasek: „Strona po polsku, bo tak ustawiona jest
  przeglądarka. [English]”. Kliknięcie zapisuje `vc_lang=en`, a pasek znika po pierwszym kliknięciu gdziekolwiek.
- Zaproszenie do pokoju zostaje bez prefiksu (`/rooms/abc123`), więc każdy zaproszony trafia do pokoju w swoim języku.
- Link z e-maila prowadzi do `/{lang}/sign-in/email?token=…` w języku, w którym gracz poprosił o link.
- Strona prywatności musi wymienić nowe cookie. To ustawienie wybrane przez gracza albo wynikające z jego
  przeglądarki, potrzebne do działania strony, więc nadal nie ma tu na co wyrażać zgody.

### 3.4 SEO

- `<html lang={lang}>`, przetłumaczone `title` i `description`.
- `alternates.languages` w metadanych każdej strony (Next generuje `<link rel="alternate" hreflang>`): `en`, `de`, `es`,
  `fr`, `it`, `pl`, `pt` i `x-default` → wersja bez prefiksu.
- Do rozważenia `app/sitemap.ts` z wersjami językowymi (lekcje, zadania i strony główne to ok. 100 adresów na język).

---

## 4. Architektura

### 4.1 Biblioteka: rekomendacja własnego, małego modułu

Projekt świadomie unika zależności (`node:sqlite` zamiast Postgresa, SSE zamiast WSS), a proxy już robi własną
rzecz (nonce CSP). Proponuję ok. 150 linii w `apps/web/lib/i18n/`:

- `locales.ts`: lista języków, negocjacja `Accept-Language`, odczyt i zapis cookie, `localePath(lang, path)`.
- `messages/en.ts` jako źródło prawdy, czyli obiekt z kluczami w przestrzeniach nazw (`nav`, `task`, `daily`,
  `rooms`, `account`, `auth`, `privacy`, `errors`). `messages/pl.ts` i reszta mają typ `Messages` wyprowadzony z `en.ts`,
  więc **TypeScript nie przepuści brakującego klucza**.
- Proste wartości w miejscach: `'Solved in {keys}'`, a liczba mnoga jako obiekt form CLDR:
  `{ one: '{n} klawisz', few: '{n} klawisze', many: '{n} klawiszy', other: '{n} klawisza' }`, wybierany przez
  `Intl.PluralRules(lang)`.
- `t()` po stronie serwera (z `params.lang`) i `useT()` w komponentach klienckich, przez provider z tylko tymi
  przestrzeniami nazw, których klient potrzebuje (`task`, `daily`, `rooms`, `goals`), żeby nie wysyłać całego
  słownika.
- Formatowanie przez `Intl.DateTimeFormat`, `Intl.NumberFormat`, `Intl.ListFormat` i `Intl.RelativeTimeFormat` z
  `lang`, zamiast `'en-GB'` i `toFixed`.

Alternatywa to **next-intl**: dojrzała, z formatem ICU, routingiem i obsługą Next 16. Kosztem jest zależność,
złożenie jej middleware z naszym proxy CSP i format ICU w plikach, który trudniej sprawdzać testami. Przy siedmiu
językach i ok. 250 komunikatach własny moduł wystarczy.

### 4.2 Routing w Next.js

- Strony przechodzą do `app/[lang]/...`, a `app/[lang]/layout.tsx` staje się głównym layoutem z `<html lang>`.
  `app/api` zostaje na miejscu.
- Proxy **przepisuje** (rewrite, nie redirect) `/lessons` → `/en/lessons` wewnętrznie, więc angielski nie ma prefiksu w
  pasku adresu. Nieznany `lang` daje `notFound()`.
- Wszystkie `<Link href="/tasks">` przechodzą przez `localePath` (albo przez mały `<L href>`). Dotyczy to też
  `SignInLink`, który dziś składa `next` z `usePathname()`, więc prefiks przejdzie sam.
- [`safeReturn`](../apps/web/lib/auth/routes.ts#L29) musi zdejmować prefiks przed sprawdzeniem `/sign-in` i `/api/`
  (bez tego `/pl/sign-in` przeszłoby jako cel powrotu).
- Przekierowania z API (`/sign-in?error=…`, `/account?notice=…`, `/rooms?error=…`) dostają prefiks z cookie
  `vc_lang`. Ponieważ proxy aktualizuje cookie przy każdej stronie z prefiksem, cookie zawsze odpowiada językowi, w
  którym gracz właśnie był.

### 4.3 Treść lekcji i zadań

- Osobne pliki `packages/tasks/i18n/{lang}.json`, a `tasks.json` i `lessons.json` zostają czysto angielskie i
  nietknięte:
  ```json
  {
    "tasks": {
      "replace-a-letter": {
        "title": "Zamień literę",
        "prompts": ["Zamień `x` pod kursorem na `a`.", "…", "…"],
        "steps": [[], [], []],
        "source": "3f9a…"
      }
    },
    "lessons": { "modes-and-typing": { "section": "…", "title": "…", "summary": "…", "body": ["…"], "does": ["…"] } }
  }
  ```
- `localizeTask(task, n, lang)` i `localizeLesson(lesson, lang)` w `@vimchallenge/tasks`: podmieniają tylko teksty, a
  brakujący napis bierze z angielskiego.
- `source` to skrót angielskich napisów danej karty. Gdy ktoś zmieni angielskie polecenie, test oznacza tłumaczenia jako
  **nieaktualne** (ostrzeżenie w CI i lista do ponownego tłumaczenia). Wersja zadania (`version`) **nie** zależy od
  tłumaczeń, bo sędzia patrzy tylko na tekst i cele.
- **Testy integralności** (vitest, przy istniejących testach `packages/tasks`):
  - każdy fragment w `` `…` `` z angielskiego występuje w tłumaczeniu bez zmian i w tej samej liczbie (to chroni
    przed „przetłumaczeniem” `` `x` `` albo `` `:s/old/new/` ``);
  - te same miejsca `{n}` i `{title}` w komunikatach interfejsu;
  - liczba wariantów i kroków się zgadza;
  - każdy język ma komplet form liczby mnogiej dla swojego `Intl.PluralRules`;
  - raport pokrycia: ile napisów spada na angielski.

### 4.4 Pokoje i wyzwanie dnia

Widok pokoju jest liczony osobno dla każdego gracza, a widok dnia osobno dla każdego konta, więc tłumaczenie dodaje się
na brzegu, w trasach `apps/web`:

- `GET /api/rooms/[code]`, `.../events` (SSE) i `GET /api/daily` przyjmują `?lang=` (klient zna swój język) i
  przed wysłaniem przepuszczają `TaskView` przez `localizeTask(id, text, lang)`. To samo dotyczy tytułów w tabelach
  (`RoundResult.title`, `set[].title`) przez `taskId`.
- Pakiety `rooms` i `daily` się nie zmieniają.

### 4.5 E-mail

`signInMail(to, url, adding, lang)` w [mail.ts](../packages/accounts/src/mail.ts) z tekstami na siedem języków (to
kilka zdań, mogą leżeć w samym pakiecie `accounts`). Trasa `POST /api/auth/email` bierze język z cookie albo z
ukrytego pola `lang` w formularzu, a link w mailu dostaje prefiks.

### 4.6 Kody zamiast tekstów (patrz 1, „Co w kodzie utrudni tłumaczenie”, punkt 4)

- `onRejected` w silniku zwraca `{ code: 'paste-off' | 'paste-mode' | 'unsupported' | 'key-error', name? }`.
- `confirmOnServer` mapuje tylko status i `reason`, bez doklejania `body.error`.
- Wszystkie słowniki `ERROR`, `START_ERROR`, `START_REASON`, `REJECTED`, `STATUS` i `METHOD` przechodzą do
  `messages/*.ts`, a duplikaty komunikatu o nazwie łączą się w jeden.

### 4.7 Układ strony

- Niemiecki i francuski są o ok. 20–35% dłuższe. Trzeba sprawdzić nawigację (już `flex-wrap`), przyciski w rzędzie na
  stronie zadania, tabele rankingów i wyników na telefonie oraz kolumnę `w-40` z klawiszami w lekcji.
- **Pseudojęzyk** `en-XA` w trybie deweloperskim (każdy napis jako `[Ŝöļvéð îñ {keys} ķéýš·····]`) od razu pokazuje
  napisy pominięte przy wyciąganiu i za ciasne miejsca, zanim powstanie choć jedno prawdziwe tłumaczenie.
- Fonty są w porządku: DM Sans i IBM Plex Mono są już ładowane z `latin-ext`, który obejmuje ą, ę, ł, ß, ç, ñ, ã i õ.

### 4.8 Klawiatury (poza tłumaczeniem, ale ta sama publiczność)

Na układach DE, FR, ES, IT i PT znaki `` ` ``, `^`, `~`, `[`, `]`, `{` i `}` wymagają AltGr albo są **martwymi
klawiszami**. Silnik ma już obsługę AltGr i martwych klawiszy
([browser-keys.ts:52-83](../packages/engine/src/browser-keys.ts#L52)), ale warto ręcznie przejść lekcje *Marks*,
*Moving the cursor* (`^`) i *Editing characters* (`~`) na układach niemieckim (QWERTZ), francuskim (AZERTY) i
hiszpańskim. Do tłumaczeń lekcji warto dodać krótką wskazówkę „na układzie niemieckim `` ` `` to Shift+´, a potem
spacja”.

---

## 5. Proces tłumaczenia

1. **Najpierw poprawić angielski** (sekcja 1), bo każda niejasność angielska powtórzy się sześć razy.
2. **Glosariusz i przewodnik stylu** w `packages/tasks/i18n/GLOSSARY.md`. To propozycja do weryfikacji przez
   rodzimych użytkowników:

   | EN | de | es | fr | it | pl | pt (BR) |
   |---|---|---|---|---|---|---|
   | Normal / Insert / Visual mode | Normalmodus / Einfügemodus / visueller Modus | modo normal / de inserción / visual | mode normal / insertion / visuel | modalità normale / inserimento / visuale | tryb normalny / wstawiania / wizualny | modo normal / de inserção / visual |
   | yank (copy) | kopieren (yank) | copiar (yank) | copier (yank) | copiare (yank) | skopiować (yank) | copiar (yank) |
   | put | einfügen | pegar | coller | incollare | wkleić | colar |
   | register | Register | registro | registre | registro | rejestr | registrador |
   | mark | Marke | marca | marque | marca | znacznik | marca |
   | macro | Makro | macro | macro | macro | makro | macro |
   | text object | Textobjekt | objeto de texto | objet textuel | oggetto testuale | obiekt tekstowy | objeto de texto |
   | block selection | Blockauswahl | selección de bloque | sélection en bloc | selezione a blocco | zaznaczenie blokowe | seleção em bloco |
   | task / lesson / exercise | Aufgabe / Lektion / Übung | tarea / lección / ejercicio | tâche / leçon / exercice | esercizio / lezione / esercizio* | zadanie / lekcja / ćwiczenie | tarefa / lição / exercício |
   | daily challenge | Tägliche Challenge | reto diario | défi du jour | sfida del giorno | wyzwanie dnia | desafio diário |
   | room / match / round | Raum / Match / Runde | sala / partida / ronda | salon / partie / manche | stanza / partita / round | pokój / mecz / runda | sala / partida / rodada |
   | leaderboard / league points | Bestenliste / Ligapunkte | clasificación / puntos de liga | classement / points de ligue | classifica / punti lega | ranking / punkty ligowe | ranking / pontos de liga |
   | solve (n.) | Lösung | resolución | réussite | soluzione | rozwiązanie | resolução |
   | Check / Hint / Start over / Skip | Prüfen / Tipp / Neu starten / Überspringen | Comprobar / Pista / Empezar de nuevo / Saltar | Vérifier / Indice / Recommencer / Passer | Verifica / Suggerimento / Ricomincia / Salta | Sprawdź / Podpowiedź / Od nowa / Pomiń | Verificar / Dica / Recomeçar / Pular |

   \* W języku włoskim *task* i *exercise* zbiegają się w *esercizio*, więc tłumacz musi wybrać inne słowo dla jednego
   z nich (na przykład *compito* albo *prova*).

   Styl: forma bezpośrednia i nieformalna, krótkie zdania, tryb rozkazujący w poleceniach, brak żargonu poza
   glosariuszem, nazwy klawiszy i komend zawsze w `` `…` ``.
3. **Pierwsza wersja maszynowa** (Claude) z glosariuszem, angielskim kontekstem karty (tekst w edytorze, rozwiązanie
   `keys`, cele), żeby tłumacz wiedział, do czego odnosi się „the middle line” albo „the colon”, i z poleceniem
   zachowania backticków. Testy z 4.3 odrzucają wszystko, co naruszy kod.
4. **Weryfikacja przez człowieka**: polski możesz zrobić sam, a dla pozostałych pięciu języków potrzebny jest rodzimy
   recenzent znający Vima (patrz decyzja 6). Recenzent gra lekcje i zadania na stronie, zamiast czytać JSON.
5. Języki bez recenzji pokazujemy z oznaczeniem **„beta”** w przełączniku i linkiem „Zgłoś błąd w tłumaczeniu” (issue na
   GitHubie z gotowym szablonem: język, adres strony, napis).
6. **Utrzymanie**: każda zmiana angielskiego napisu w PR uruchamia test „nieaktualne tłumaczenia” z listą kluczy, a
   aktualizacja ma być osobnym krokiem, żeby nie blokować zmian.

---

## 6. Etapy

| Etap | Zakres | Gotowe, gdy |
|---|---|---|
| **0. Angielski** | Poprawki z sekcji 1, ujednolicenie terminologii, kody zamiast tekstów (silnik, API, `server-check`), jeden komunikat o nazwie | Testy przechodzą, a na stronie nie ma żadnego zdania składanego z kawałków |
| **1. Infrastruktura** | `lib/i18n`, `app/[lang]`, proxy (rewrite, detekcja, cookie), przełącznik, pasek po autodetekcji, `localePath`, `safeReturn`, przekierowania API, formatowanie `Intl`, wyciągnięcie wszystkich napisów do `en.ts`, pseudojęzyk, hreflang | Strona działa po angielsku jak dziś, pseudojęzyk nie pokazuje ani jednego nieprzetłumaczonego napisu, testy proxy (negocjacja, priorytety, `Vary`) przechodzą |
| **2. Treść** | `packages/tasks/i18n`, `localizeTask`/`localizeLesson`, lokalizacja widoków pokoi i dnia, e-mail w języku, testy integralności i nieaktualności | Pseudojęzyk obejmuje też lekcje, zadania, pokój, wyzwanie dnia i e-mail |
| **3. Polski** | Glosariusz, tłumaczenie, Twoja recenzja na wersji testowej .250 | Przejście lekcji 1–18, kilku zadań z każdego poziomu, pokoju na dwóch przeglądarkach (PL i EN jednocześnie) i wyzwania dnia |
| **4. de, fr, es, it, pt** | Tłumaczenie maszynowe, testy, „beta”, potem recenzje | Testy integralności przechodzą, a każdy język ma co najmniej jedną recenzję albo widoczne oznaczenie „beta” |
| **5. Po starcie** | Sitemap, aktualizacja strony prywatności (cookie języka), szablon zgłoszeń, ewentualnie język na koncie | — |

Etapy 0–2 to praca jednorazowa w kodzie. Każdy kolejny język to potem tylko dwa pliki: `messages/xx.ts` i
`i18n/xx.json`.

---

## 7. Decyzje do podjęcia (z rekomendacją)

1. **Portugalski: pt-BR czy pt-PT?** Rekomenduję **pt-BR** (dużo większa społeczność programistów). Kod `pt` ze
   słownictwem brazylijskim (*você*, *tela*, *arquivo*), a `pt-PT` można dodać później.
2. **Hiszpański: neutralny czy es-ES?** Rekomenduję **neutralny** (*tú*, bez *vosotros*, bez regionalizmów, *archivo*
   zamiast *fichero*), czytelny w Hiszpanii i w Ameryce Łacińskiej.
3. **Forma zwracania się**: nieformalna (*du*, *tú*, *tu*, *ty*, *você*). Otwarta pozostaje kwestia francuskiego:
   *tu* (ton gry, jak Duolingo) czy *vous* (ton serwisu). Rekomenduję **tu**, dla spójności z resztą.
4. **Angielski bez prefiksu w adresie**: rekomenduję tak (patrz 3.1).
5. **Automatyczne przekierowanie przy pierwszej wizycie** (zgodnie z prośbą) z paskiem „zmień na English” i bez
   przekierowań na adresach z prefiksem. Alternatywą jest tylko pasek z propozycją, bez przekierowania.
6. **Kto recenzuje de, es, fr, it i pt?** Społeczność (projekt jest open source), znajomi albo płatna recenzja.
   Do tego czasu oznaczenie „beta”.
7. **Własny moduł czy next-intl?** Rekomenduję własny (4.1).
8. **Tekst w edytorze zostaje angielski**: rekomenduję tak (sprawiedliwość wyzwania dnia i pokoi, stabilność sędziego).
9. **Nazwy graczy tylko z ASCII**: zostawiam ASCII (ochrona przed podszywaniem się literami z innych alfabetów), ale z
   lepszym komunikatem (sekcja 1).

---

## 8. Ryzyka

- **Tłumaczenie zepsuje polecenie**, na przykład zmieni `` `x` `` albo przetłumaczy *the colon* tak, że nie wiadomo, o
  który znak chodzi. Ochroną są testy backticków, kontekst karty przy tłumaczeniu i recenzja przez grę.
- **Rozjazd wersji**: angielskie polecenie się zmienia, a tłumaczenia mówią coś starego. Ochroną jest skrót `source`
  i test nieaktualności.
- **Cache Cloudflare** poda komuś cudzą wersję językową. Ochroną są `Vary`, `private, no-store` na przekierowaniach i
  ręczne sprawdzenie po wdrożeniu (`curl -H 'Accept-Language: de'` na produkcji).
- **Przekierowanie w kółko** między `/` i `/de` przy błędzie cookie. Ochroną jest zasada, że adres z prefiksem nigdy
  nie przekierowuje, oraz test proxy.
- **Martwe klawisze** na układach europejskich (4.8): to nie tłumaczenie, ale nowi gracze trafią na to pierwsi.
