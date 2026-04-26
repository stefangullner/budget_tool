# Projektplan — On Via Budget Tool

**Senast uppdaterad:** 2026-04-26  
**Status:** Fas 3 — Admin & användarhantering

---

## Mål

Bygga ett internt webbaserat budgetverktyg för On Via med fyra bolag som stödjer:
- Budgetering per konto, kostnadsställe och månad
- Utfallsjämförelse mot faktiska siffror från Fortnox
- Prognoser med flera scenarier
- Rollbaserad åtkomst (admin, bolagsansvarig, KS-ansvarig)
- Export av budget till Fabric för vidare analys

**Stack:** React + Vite + TypeScript + Tailwind + Supabase + Vercel + GitHub

---

## Status per fas

### ✅ Fas 1 — Grund & datamodell
- [x] React-app med routing, auth-guard, Supabase-klient
- [x] Supabase-schema: companies, cost_centers, accounts, account_configs, scenarios, budget_entries, scenario_locks, actuals, user_profiles, user_roles, sync_log
- [x] RLS-policies för alla tabeller
- [x] 4 bolag inlagda (id 1–4)
- [x] 56 kostnadsställen med region-struktur
- [x] 3 001 konton synkade från Fortnox via Fabric-notebook
- [x] Admin-användare skapad (stefan.gullner@onvia.se)

### ✅ Fas 2 — Kontokonfiguration
- [x] AccountConfigPage: toggle is_budgetable, sektion per konto, filter, synkstatus
- [x] account_configs skapade för alla konton

### ✅ Fas 3 — Budgetinmatning
- [x] Flexibla scenarier med datumspann (start/slut år+månad, ej låst till kalenderår)
- [x] BudgetPage med bolagsflikar, scenarioval, KS-väljare
- [x] BudgetMatrix: sektionsgruppering, autosave per cell, tangentbordsnavigation
- [x] Historiska månader visas som skrivskyddade (från actuals-tabellen)
- [x] Lås/lås upp per KS direkt i matrisen
- [x] Scenarioskapande begränsat till admins (RLS + UI)
- [x] Kopiering från befintligt scenario vid skapande

---

## Pågående — Fas 4: Admin-vy

Admin-vyn nås via `/admin` och är synlig enbart för användare med rollen `admin`.
Sidebar-länk visas konditionellt baserat på roll.

### 4.1 Admin-skal *(nästa)*
- [ ] `/admin`-route med egen layout/navigering
- [ ] Admin-sidebar med sektioner: Användare, Scenarier, Konton, Kostnadsställen, Synkronisering, Deadlines
- [ ] Sidebar-länk "Admin" i huvud-layout (visas bara för admins)

### 4.2 Användarhantering (`/admin/users`)
- [ ] Lista alla användare med roll och tilldelade KS/bolag
- [ ] Bjuda in ny användare via e-post (Supabase email invite)
- [ ] Tilldela roll: Admin / Bolagsansvarig / KS-ansvarig
- [ ] Koppla bolagsansvarig till bolag
- [ ] Koppla KS-ansvarig till ett eller flera KS (och/eller region)
- [ ] Ta bort användare / återkalla åtkomst

### 4.3 Scenariohantering (`/admin/scenarios`)
- [ ] Lista alla scenarier per bolag med status (öppet/låst/godkänt)
- [ ] Byta namn på scenario
- [ ] Godkänna scenario (is_approved = true, helåsning)
- [ ] Ångra godkännande
- [ ] Ta bort scenario (med bekräftelse)
- [ ] Visa låsstatus per KS inom scenario (vem låste, när)

### 4.4 Kontokonfiguration (`/admin/accounts`)
- [ ] Flytta/länka från befintlig AccountConfigPage
- [ ] Bulk-toggle is_budgetable (markera flera konton)
- [ ] Sätta display_order per sektion

### 4.5 Kostnadsställen (`/admin/cost-centers`)
- [ ] Lista KS med region och aktiv-status
- [ ] Aktivera/inaktivera KS
- [ ] Redigera region-tillhörighet
- [ ] Lägga till nytt KS manuellt

### 4.6 Deadlines (`/admin/deadlines`)
- [ ] Sätta deadline per scenario (datum då KS ska vara låst)
- [ ] Statusöversikt: vilka KS har låst, vilka är kvar
- [ ] Visuell indikation (grön/gul/röd) per KS

### 4.7 Synkronisering (`/admin/sync`)
- [ ] Visa senaste kontosynk (tidpunkt, status, antal konton per bolag)
- [ ] Trigga manuell kontosynk (anropar Fabric-notebook via REST)
- [ ] Synklogg med historik

---

## Kommande — Fas 5: Utfall & dashboard

- [ ] Fabric-notebook som synkar utfall från silver-lager till actuals-tabellen
- [ ] Schemalägg utfallssynk (dagligen efter Fortnox-synk)
- [ ] DashboardPage: budget vs utfall per bolag
  - Totaler per sektion (Intäkter, Personal etc.)
  - Avvikelse i kr och %
  - Trafikljus per KS (grön/gul/röd)
- [ ] Drilldown per KS och konto
- [ ] Rullande 12-månaders vy

---

## Kommande — Fas 6: Export & integration

- [ ] Export av scenario till Fabric (Delta-tabell i silver/gold-lager)
  - Fabric-notebook som läser från Supabase REST och skriver Delta
  - Triggas manuellt från admin-vyn (`/admin/scenarios`)
- [ ] Schemalägg kontosynk i Fabric (dagligen 05:00)
- [ ] Export till Excel (klient-side via SheetJS)
- [ ] Kommentarsfält per rad/konto i budgetmatrisen

---

## Tekniska beslut (fattade)

| Område | Beslut |
|---|---|
| UI-ramverk | React + Vite + TypeScript |
| Designsystem | Tailwind CSS |
| Backend/DB | Supabase (Postgres + Auth + RLS) |
| Hosting | Vercel (auto-deploy från GitHub main) |
| Fabric-integration | Notebooks via REST API, Supabase service role key |
| Auth | Supabase email/password (+ invite-flöde planerat) |
| Kontosynk | Fabric notebook → Supabase REST (dagligen 05:00, ej schemalagd än) |
