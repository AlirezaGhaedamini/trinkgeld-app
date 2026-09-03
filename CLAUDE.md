# CLAUDE.md — TipCrew

> Projektgedächtnis. Wird bei jeder Session automatisch geladen.
> Backend-Details stehen bewusst **nicht** hier, sondern in
> [`docs/BACKEND.md`](docs/BACKEND.md) (1.394 Zeilen, Abschnitte §1–§10).
> Lies dort nach, bevor du eine Migration schreibst oder eine RLS-Policy
> anfasst — jede Migration hat dort einen eigenen Abschnitt (§4b–§4l).

## Projekt

TipCrew verteilt Trinkgeld in Gastronomie-Teams: Der Verantwortliche gibt den
Betrag ein, die App kennt Arbeitszeiten und die Regeln des Betriebs und rechnet
aus, wer wie viel bekommt — und **warum**. Mobile-first, zweisprachig (DE/EN),
deutscher Markt.

Zustand: **in Entwicklung, nicht live.** Kein Deployment, keine URL, keine CI.
Phase 1 (Frontend) und Phase 2 (Backend) sind fertig; Phase 3 verdrahtet die
Screens Stück für Stück mit der echten Datenbank und ist bei **3N** angekommen.
`TipCrew Prototype.html` im Root ist die visuelle Quelle der Wahrheit und wird
nie verändert.

## Architektur

Eine Single-Page-App gegen Supabase. **Kein eigener Server, kein Worker, kein
Cron** — die gesamte Geschäftslogik liegt als PostgreSQL-Funktionen und
RLS-Policies in der Datenbank. Der Browser hält nur den Anon-Key.

Der Weg einer Aktion, am Beispiel „Zeitraum abschließen":

1. `src/pages/manager/PeriodClosePage.tsx` — die Seite, ruft einen Domänen-Hook
2. `src/period/usePeriod.ts` — Hook: hält State, kennt `enabled` (Manager? echte
   Daten? konfiguriert?), ruft die API-Schicht
3. `src/period/queries.ts` — die einzigen Stellen, die `client.rpc(...)` bzw.
   `client.from(...)` aufrufen
4. `src/lib/supabase.ts` — der memoisierte, typisierte Client (Anon-Key)
5. PostgREST → `close_financial_period()` in
   `supabase/migrations/20260901002800_period_close_and_export.sql`
6. Die Funktion prüft `app.is_manager()`, leitet Akteur und Zeitstempel **selbst**
   ab und schreibt
7. Fehler zurück → `src/distribution/errors.ts` klassifiziert die
   Postgres-Meldung → i18n-Key → `useToast()`

Dieses Fünferpaar wiederholt sich pro Domäne. Wer eine Ebene überspringt (z.B.
`client.rpc` direkt in einer Seite), bricht das Muster.

**Providerreihenfolge** ist bedeutungstragend und in `src/App.tsx` kommentiert:
I18n → Auth → AppState → Workplace → Toast → AuthBridge → HashRouter.
`WorkplaceProvider` liegt **innerhalb** `AppStateProvider`, weil es `dataMode`
sehen muss — im Demo-Modus darf kein einziger Supabase-Call rausgehen.

`HashRouter` ist Absicht: kein Server-Rewrite nötig, funktioniert aus einem
Unterpfad und später in einer Capacitor-WebView.

## Verzeichnisstruktur

```
src/
  pages/{auth,employee,manager}/   Ein Screen = eine Route = eine Datei
  components/ui/                   Präsentations-Primitive (Button, Card, Sheet …)
  components/layout/               AppLayout, BottomNav, Screen, guards.tsx
  components/domain/               Fachliche Bausteine (AreaResultBlock …)
  hooks/                           Nur Context-Zugriff + kleine Ableitungen
  lib/                             supabase.ts, env.ts, money.ts, time.ts, icons.ts
  i18n/                            strings.ts = flaches Wörterbuch EN/DE (736 Keys)
  state/                           Phase-1-Reducer, Demo-Modus, Toasts
  styles/                          tokens.css (Design-Tokens), base.css, fonts.css
  types/database.ts                Von Hand gepflegte Supabase-Typen
  data/                            Phase-1-Mockdaten UND echte Konstanten (s.u.)
  auth/ workplace/                 Provider + Domänenmodule
  distribution/ rules/ shifts/     Domänenmodule: types · queries · errors · useX
  team/ tips/ period/ config/
supabase/
  migrations/                      28 nummerierte Migrationen, streng aufsteigend
  tests/                           19 SQL-Suites + rebuild.sh
  config.toml                      Supabase-CLI
scripts/                           14 Live-Prüfskripte gegen echtes Supabase
docs/BACKEND.md                    Backend-Referenz, pro Migration ein Abschnitt
NEXT_STEPS.md                      Roadmap — VERALTET, siehe Offene Fragen
TipCrew Prototype.html             Visuelle Quelle der Wahrheit, nie ändern
```

**Domänenmodul-Muster** (`src/<domäne>/`), belegt in `period/`, `rules/`,
`shifts/`, `team/`, `distribution/`, `config/`, `tips/`:

| Datei | Aufgabe |
| --- | --- |
| `types.ts` | Interfaces + `toX()`-Mapper von snake_case-Zeilen auf camelCase |
| `queries.ts` | Die einzige Stelle mit `client.rpc` / `client.from` |
| `errors.ts` | `classifyXError()` + `X_FAILURE_KEY: Record<Failure, StringKey>` |
| `useX.ts` | React-State, `enabled`-Gate, ruft `* as api from './queries'` |

Neuer Code gehört in das Domänenmodul, dem er fachlich zugehört — nicht in
`lib/`. `lib/` ist für Technik ohne Fachbezug.

## Stack

- **TypeScript ~5.6.3**, `strict: true`, zusätzlich `noUnusedLocals`,
  `noUnusedParameters`, `noImplicitOverride`. Im gesamten `src/` (144 Dateien):
  **kein `any` in irgendeiner Form** (`: any`, `as any`, `<any>`, `any[]`) und
  **kein `@ts-ignore`**. Halt das so.
- **React 18.3.1** + **react-router-dom 6.30** (HashRouter). Keine
  UI-Bibliothek, kein Tailwind, kein CSS-in-JS.
- **Vite 5.4** — `base: './'` (portabler Build), Alias `@` → `src/`.
- **Supabase** (`@supabase/supabase-js` ^2.45) für Auth **und** Daten. PKCE,
  Session in `localStorage` unter `tipcrew.auth`.
- **PostgreSQL** — 21 Tabellen, 23 Enums, 50 RLS-Policies, 5 Views, 34 RPCs.
  Die Rechenlogik ist eine PL/pgSQL-Funktion, kein JS.
- **Kein Test-Framework in `package.json`**, kein ESLint, kein Prettier, keine
  CI. Getestet wird per SQL-Suites und Live-Skripten (s. Testing).

Externe Dienste außer Supabase: **keine**. Kein Payment, kein Mail, kein
Storage. TipCrew rechnet Trinkgeld aus — es bewegt nie Geld.

## Setup

Nötig: Node ≥ 20 (getestet mit 22), npm, für die DB-Tests PostgreSQL 16 lokal
oder die Supabase CLI.

```bash
npm install
cp .env.example .env.local      # Werte aus Supabase → Project Settings → API
npm run dev                     # http://localhost:5173
```

Environment-Variablen (**Namen, nie Werte** — `.env*` ist gitignored, einzige
Ausnahme `.env.example`):

| Variable | Datei | Wofür |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `.env.local` | Projekt-Endpunkt |
| `VITE_SUPABASE_ANON_KEY` | `.env.local` | **Anon-Key**, niemals service_role |
| `TEST_A_EMAIL` / `TEST_A_PASSWORD` | `.env.test.local` | Testkonto A (wird Manager) |
| `TEST_B_EMAIL` / `TEST_B_PASSWORD` | `.env.test.local` | Testkonto B (wird Mitarbeiter) |

`src/lib/env.ts` wirft aktiv, wenn der Anon-Key nach `service_role` aussieht.
Die App startet auch **ohne** `.env.local` — dann läuft sie auf den
Phase-1-Mockdaten.

Seed-Daten: keine Fixtures nötig. Die Live-Skripte legen sich pro Lauf ein
eigenes Workplace an; `supabase/tests/rebuild.sh` baut die DB von Null auf.

## Befehle

Alle verifiziert. Was **nicht** in der Liste steht, gibt es nicht.

| Befehl | Was er tut |
| --- | --- |
| `npm run dev` | Vite-Devserver auf :5173, `host: true` (im LAN erreichbar) |
| `npm run build` | `tsc --noEmit` **und dann** `vite build` nach `dist/` |
| `npm run typecheck` | Nur der Typecheck |
| `npm run preview` | Den Build lokal ausliefern |
| `bash supabase/tests/rebuild.sh` | DB **löschen**, neu anlegen, alle 28 Migrationen anwenden |
| `bash supabase/tests/rebuild.sh --test` | Dasselbe + alle 19 SQL-Suites (814 Assertions) |
| `psql -f supabase/tests/19_period_close.sql` | Eine einzelne Suite (DB muss stehen) |
| `node scripts/<name>-check.mjs` | Eine Live-Prüfung gegen **echtes** Supabase |
| `supabase db push` | Migrationen ins verknüpfte Projekt (Vorsicht, s. Fallstricke) |

Es gibt **kein** `npm test`, **kein** `npm run lint`, **kein** `npm run format`.

## Datenmodell

Das mentale Modell — Details in [`docs/BACKEND.md §3`](docs/BACKEND.md).

```
workplaces ──< workplace_members >── profiles (1:1 zu auth.users)
     │              │
     ├──< workplace_areas ──< workplace_roles
     ├──< shifts            (work_date = Geschäftstag, s.u.)
     ├──< tip_reports       (gemeldete Trinkgeld-Beträge)
     ├──< distribution_rules ──< distribution_rule_{areas,roles}
     └──< tip_pools ──< tip_distributions ──< tip_distribution_{areas,entries}
                              │
                              ├──< distribution_queries      (Rückfrage → Antwort)
                              ├──< distribution_payouts ──< distribution_payout_reversals
                              └── supersedes_id → tip_distributions  (Korrekturkette)
     └──< financial_period_closes    (Abschluss-Prüfpunkt)
```

Vier Begriffe, ohne die nichts Sinn ergibt:

- **Geschäftstag.** `shifts.work_date` schreibt `app.business_day()` aus der
  Zeitzone des Betriebs minus `business_day_start_hour` (Default 05:00). Eine
  Schicht um 02:00 gehört zum Vortag. **Rechne nie im Browser mit Datumswerten.**
- **Korrektur = Ersetzung.** Eine gesendete Verteilung wird nie bearbeitet. Es
  entsteht eine neue mit `supersedes_id`; die alte wird `cancelled`. Die
  **Summe einer Kette ändert sich nie** — Geld bewegt sich nur *zwischen*
  Personen.
- **Effektive Auszahlung.** Ein Auszahlungsbeleg wird nie gelöscht; eine
  Rücknahme ist ein zweites Ereignis. „Bezahlt" heißt: es gibt eine Auszahlung,
  auf die keine Rücknahme zeigt.
- **Mitarbeiter lesen nur Views.** `member_distributions` und
  `member_distribution_entries` maskieren den Pool-Betrag. Schreiben immer über
  `SECURITY DEFINER`-RPCs, nie per Tabellen-Insert.

## Konventionen

Abgeleitet aus dem Code, mit Beleg.

- **Named Exports überall.** Einzige `export default`-Datei ist `src/App.tsx`.
- **Dateinamen:** Seiten `PascalCasePage.tsx` (`src/pages/manager/RulesPage.tsx`),
  Komponenten `PascalCase.tsx`, Domänenmodule und `lib/` kleingeschrieben
  (`src/period/csv.ts`), Hooks `useX.ts`.
- **Imports immer über `@/`**, nie relativ über Ordnergrenzen
  (`import { Card } from '@/components/ui/Card'`).
- **Fehlerbehandlung:** Nie eine rohe Postgres-Meldung anzeigen. `queries.ts`
  wirft, `useX.ts` fängt und ruft `classifyXError()`, das eine
  `Failure`-Union liefert; `X_FAILURE_KEY` mappt auf einen i18n-Key.
  **Die Reihenfolge der Regeln in `classify*` ist kritisch** — spezifisch vor
  generisch, sonst schluckt ein `code === '42501'` am Ende alles
  (`src/distribution/errors.ts:150–210`, mit Kommentaren an genau den Stellen).
- **Datenabruf:** kein React Query, kein SWR. Handgeschriebene Hooks mit
  `useState` + `useCallback` + einem `alive`-Ref gegen Updates nach Unmount —
  in **neun** Hooks identisch (`src/rules/useRules.ts:52–58`,
  `src/period/usePeriod.ts:31–36`, …). Wo sich Anfragen überholen können, kommt
  ein Sequenznummern-Ref dazu: `src/shifts/useShifts.ts:157–166` zählt
  `token.current` hoch und verwirft jede Antwort, die nicht mehr die neueste
  ist. Nur dort nötig, weil nur dort mit wechselnden Filtern nachgeladen wird.
- **`enabled`-Gate:** Jeder Domänen-Hook berechnet
  `Boolean(client) && workplace.enabled && membership?.role === 'manager'`.
  Ist es `false`, wird **kein** Netzwerkaufruf gemacht — so bleibt der
  Demo-Modus offline (`src/period/usePeriod.ts:27`).
- **Styling:** CSS-Module, nur **drei** Dateien (`ui.module.css`,
  `layout.module.css`, `pages.module.css`) plus Design-Tokens in
  `src/styles/tokens.css`. **Keine Hex-Werte in Komponenten** — immer
  `var(--color-…)`.
- **Typisierung:** Zeilen kommen snake_case aus der DB und werden in `types.ts`
  per `toX()`-Funktion nach camelCase gemappt. `src/types/database.ts` ist von
  Hand gepflegt (nicht generiert) und muss bei jeder Migration mitgezogen werden.
- **i18n:** `strings.ts` ist flach. `EN` ist die Quelle,
  `DE: Record<StringKey, string>` erzwingt Vollständigkeit — eine fehlende
  Übersetzung ist ein **Compile-Fehler**. Platzhalter sind `{n}`, `{from}` … und
  werden per `.replace()` gefüllt.
- **Kommentarstil:** Jede nicht-triviale Datei beginnt mit einem JSDoc-Block,
  der das **Warum** erklärt, nicht das Was — oft mit einer Begründung, warum die
  naheliegende Alternative falsch wäre. Siehe `src/period/csv.ts:1–26`.

## Workflow

- Branch: aktuell wird **direkt auf `main`** gearbeitet. Kein anderes Schema in
  der Historie, keine Feature-Branches, kein PR-Prozess. Remote:
  `github.com/AlirezaGhaedamini/trinkgeld-app`.
- **Commit-Stil:** ein Satz, Imperativ, kein Präfix, kein Body. Beispiele aus
  der Historie: `Implement TipCrew payout reversal events`,
  `Implement TipCrew manager initiated corrections`. **Ein Commit = eine Phase.**
- Vor einem Commit muss laufen: `npm run typecheck`, `bash
  supabase/tests/rebuild.sh --test`, und die betroffenen `scripts/*-check.mjs`
  gegen ein Entwicklungsprojekt.
- **Nicht committen und nicht pushen ohne ausdrückliche Aufforderung.**
- Deploy: existiert nicht.

## Testing

Drei Ebenen, keine davon in `package.json`:

1. **SQL-Suites** — `supabase/tests/[0-9][0-9]_*.sql`, benannt nach Phase
   (`19_period_close.sql`). Sie prüfen RLS, Guards, Rechenwege und
   Unveränderlichkeit gegen ein echtes PostgreSQL. Assertions haben je Suite
   einen Buchstaben-Präfix (`C1`, `C2`, … in Suite 19). Start:
   `bash supabase/tests/rebuild.sh --test` → **814 Assertions**.
   Eine einzelne: `psql -f supabase/tests/19_period_close.sql`.
2. **Live-Skripte** — `scripts/*-check.mjs`, je Phase eines, gegen ein **echtes**
   Supabase-Projekt mit zwei Testkonten. Sie legen pro Lauf ein eigenes
   Workplace an und räumen nicht auf. `period-close-check.mjs` hat 98 Checks.
   Sie brechen mit Exit 2 ab, wenn `.env.local` / `.env.test.local` fehlen.
3. **Browser-Suites** — Playwright gegen einen Offline-Stub, **derzeit nicht im
   Repository** (siehe Offene Fragen).

Bewusst **nicht** getestet: Unit-Tests einzelner React-Komponenten. Die
Absicherung liegt auf der Datenbank und auf Ende-zu-Ende-Verhalten.

Negativkontrollen sind Teil der Methode: einen Guard abschalten und beweisen,
dass eine **namentlich benannte** Assertion bricht. Ohne das ist ein grüner Test
kein Beweis.

## Fallstricke

- **`btrim(s)` mit einem Argument entfernt nur Leerzeichen** — nicht Tab, LF,
  CR, NBSP. Das ließ einmal eine „leere" Notiz durch. `app.trimmed_note()`
  (Migration 25) ist die **einzige** Definition von „leer"; nie eine zweite
  Meinung dazu schreiben.
- **`alter type … add value` funktioniert nicht in derselben Transaktion**, und
  `supabase db push` packt eine Migration in genau eine. Neuen Enum-Wert
  brauchen? Neuen Typ anlegen (so entstand `payout_state` neben `payout_status`).
- **`create or replace view` kann keinen Spaltentyp ändern** — die View muss
  gedroppt und neu angelegt werden.
- **`create_pool_from_reports` legt eine Temp-Tabelle `on commit drop` an**:
  **ein Aufruf pro Transaktion**. Mehrere Nächte = mehrere Requests.
- **`supabase-js` braucht ein String-*Literal* in `.select()`.** Über zwei
  Zeilen mit `+` zusammengesetzt wird der Typ zu `string` erweitert und du
  bekommst `GenericStringError`.
- **Enum-Werte werden vor dem Funktionsrumpf geprüft.** Ein erfundener Wert
  scheitert mit `22P02`, bevor irgendeine Logik läuft. Enum-Literale immer gegen
  die Migration prüfen — `correction_reason` ist
  `hours|area|role|multiplier|tip_amount|rule|other` (kein `wrong_hours`).
- **`src/data/` ist kein toter Ordner.** Es enthält Phase-1-Mockdaten *und*
  echte Produktionskonstanten (`AREA_ORDER`, `iconForAreaKey`,
  `MIN_OVERLAP_CHOICES`), die 14 Dateien importieren. Nicht pauschal löschen.
- **Tote Klassifizierungsregel:** `src/distribution/errors.ts:202`
  (`revNoteLong`) ist unerreichbar, weil Zeile 152 dieselbe Meldung
  („that reason is too long") vorher fängt. Sichtbar ist nichts — beide
  i18n-Strings sind wortgleich —, aber die Regel greift nie.
- **`supabase/config.toml` sagt `major_version = 15`**, der Kommentar direkt
  darüber und `docs/BACKEND.md` sagen PostgreSQL 16.
- **`npm run build` aus einer Linux-Shell gegen ein unter Windows installiertes
  `node_modules` schlägt fehl** (`@rollup/rollup-linux-x64-gnu` fehlt, nur die
  win32-Binaries liegen da). Kein Codefehler — unter Windows bauen.
- **`src/shifts/useShifts.ts:168` trägt ein
  `// eslint-disable-next-line react-hooks/exhaustive-deps`, obwohl es kein
  ESLint im Projekt gibt.** Es dokumentiert eine Absicht: die Dependency ist
  `statuses.join(',')` statt `statuses`, damit ein bei jedem Render neu
  erzeugtes Array keinen Reload auslöst. Wer ESLint einführt, muss genau hier
  hinsehen — und darf die Zeile nicht „aufräumen".
- **Der Demo-Modus darf die Datenbank nie erreichen.** Er hängt allein am
  `enabled`-Gate der Hooks. Wer in einer Seite direkt `getSupabase()` aufruft,
  hebelt das aus.

## Nicht anfassen

- **`supabase/migrations/*` — bereits angewendete Migrationen nie umschreiben.**
  Korrekturen kommen als neue Migration mit der nächsten Nummer.
- **`TipCrew Prototype.html`** — die visuelle Referenz, bleibt unverändert.
- `dist/`, `node_modules/`, `supabase/.temp/` (CLI-Zustand, gitignored).
- `.env`, `.env.local`, `.env.test.local` — nie committen, nie ausgeben.
- `src/types/database.ts` ist **handgepflegt**, nicht generiert. Nicht mit
  `supabase gen types` überschreiben, ohne die Kommentare zu retten.

## Aktueller Stand

**Fertig und getestet:** Phasen 1, 2 und 3A–3N. Auth, Profile, Workplaces,
Mitgliedschaften, Bereiche/Rollen, Schichten, Stundenprüfung, Trinkgeldmeldung,
Pools, Verteilungsrechnung, Regeleditor, Bestätigung, Rückfragen,
Korrekturen (Mitarbeiter- und Manager-initiiert), Auszahlungsstatus,
Rücknahmen, Zeitraum-Abschluss und CSV-Export.

**Halbfertig / offen:**

- **Phase 3N ist nicht committed** und **Migration 28 ist nicht gepusht.**
  Letzter Commit ist `fd36637` (Phase 3M). Im Arbeitsbaum liegen 7 geänderte und
  8 neue Dateien.
- Der **Live-Lauf von `scripts/period-close-check.mjs` gegen echtes Supabase
  steht noch aus.** Der erste Versuch brach nach 26 Checks an einem erfundenen
  Enum-Wert im Testskript ab; das ist korrigiert, aber nicht erneut gelaufen.
- **PDF-Export bewusst nicht gebaut** — jede Browser-Bibliothek dafür ist
  größer als das gesamte Bundle. Empfohlener Weg: Druck-Stylesheet plus „Als
  PDF sichern" des Browsers. Begründung in `docs/BACKEND.md §4l`.
- `NEXT_STEPS.md` beschreibt den Stand von Phase 3C und ist überholt.

## Offene Fragen

1. **Sollen die Browser-Suites ins Repository?** Es gibt 22 Playwright-Suites
   mit 1.171 Assertions (inkl. `close.cjs`, 165) plus einen Offline-Stub, der
   RLS und die RPCs nachbildet. Sie liegen **nur in der Cloud-Sandbox der
   Sessions**, nicht im Repo — ein zukünftiger Claude findet sie nicht und baut
   sie womöglich neu. Aufnehmen (z.B. unter `harness/`, mit Playwright als
   devDependency)?
2. **PostgreSQL-Version:** 15 oder 16? `supabase/config.toml` sagt 15, alles
   andere 16. Was ist im verknüpften Projekt eingestellt?
3. **`NEXT_STEPS.md`:** aktualisieren, oder löschen und die Roadmap hier führen?
4. **Linter/Formatter:** Soll ESLint + Prettier dazu, oder bleibt es bei
   `tsc --noEmit` als einziger statischer Prüfung? (Es gibt bereits einen
   `eslint-disable`-Kommentar in `src/shifts/useShifts.ts:168` — irgendwann lief
   dort ESLint oder war geplant.)
5. **Branch-Strategie:** Bleibt es bei direkten Commits auf `main`, oder ab
   jetzt Feature-Branches pro Phase?
6. **`src/data/`:** Sollen die echten Konstanten (`AREA_ORDER`,
   `iconForAreaKey`, `MIN_OVERLAP_CHOICES`) aus den Mockdaten herausgelöst
   werden, damit der Ordner irgendwann löschbar wird?
7. Gibt es ein Zielhosting (Vercel/Netlify/statisch) und einen geplanten
   Capacitor-Wrapper, oder ist das noch offen?

> Diesen Abschnitt nach dem Beantworten löschen.
