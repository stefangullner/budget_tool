# MCP-server för Budget Tool (v3 — OAuth)

En MCP-server (Model Context Protocol) som låter Claude läsa och, med godkännande, ändra
budget-tool-databasen. Körs som Edge Function på
`https://sjzhrxzyrbtbryypcpor.supabase.co/functions/v1/mcp`.

**Varje användare loggar in med sitt eget konto.** Servern kör alla frågor som den personen, så
RLS gäller per person (en regionchef ser bara sina kostnadsställen) och ändringar sparas i
rätt namn. Det finns ingen delad token.

## Så fungerar inloggningen

1. Claude Code anropar servern utan token och får `401` med en pekare till
   `/.well-known/oauth-protected-resource` (serveras av funktionen själv).
2. Metadata pekar på Supabase Auth som auktorisationsserver. Klienten registrerar sig
   (dynamisk klientregistrering) och skickar användaren till godkännandesidan i budgetverktyget:
   `/oauth/consent` (`src/pages/OAuthConsentPage.tsx`).
3. Användaren loggar in (om hen inte redan är det) och trycker **Godkänn**. Supabase ger klienten
   en åtkomsttoken för just den användaren.
4. Funktionen validerar token, skapar en databasklient med användarens token och kör verktygen.

## Engångsinställningar i Supabase (gör Stefan, i dashboarden)

OAuth-servern är **avstängd** i projektet i dag (`feature_disabled`), så detta måste göras först:

1. **Authentication → URL Configuration:** Site URL ska vara appens riktiga adress
   (`https://budget-tool-sage.vercel.app`). Godkännandesidan byggs som Site URL + sökväg.
2. **Authentication → OAuth Server:** slå på **Enable OAuth 2.1 server**, sätt
   **Authorization Path** till `/oauth/consent` och slå på **Allow dynamic client registration**
   (annars kan Claude inte registrera sig själv).
3. Kör `supabase/add_mcp_change_log.sql` i SQL Editor (tabellen för förslag och logg; `user_id`
   binder varje förslag till den som gjorde det).
4. Deploya appen (push till `main` → Vercel) så att `/oauth/consent` finns, och deploya funktionen
   `mcp` med JWT-verifiering **av**.

Rekommenderat: byt JWT-signering till asymmetrisk (RS256/ES256) under
**Authentication → JWT Keys**. Det är inte ett krav för det här flödet.

⚠️ Dynamisk registrering låter vilken MCP-klient som helst registrera sig mot projektet. Varje klient
kräver ändå att en inloggad användare trycker Godkänn, men titta då och då under
**Authentication → OAuth Server** och ta bort klienter du inte känner igen.

## Koppla in i Claude Code

Repot har en `.mcp.json` utan några hemligheter. I en ny session i mappen godkänner du servern
`onvia-budget`, kör `/mcp`, väljer servern och **Authenticate**. Webbläsaren öppnas, du loggar in i
budgetverktyget och godkänner. Utan repot:

```bash
claude mcp add --transport http onvia-budget https://sjzhrxzyrbtbryypcpor.supabase.co/functions/v1/mcp
```

## Läsverktyg

| Verktyg | Vad det gör |
|---|---|
| `list_companies` | Bolagen du ser. Börja här. |
| `list_cost_centers` | Kostnadsställen med region. |
| `list_accounts` | Kontoplan med sektion, budgeterbart, intercompany. |
| `list_sections` | Sektionerna i visningsordning. |
| `list_scenarios` | Scenarier med period, deadline och godkännandestatus. |
| `get_budget` | Budgeterade belopp, aggregerbart. IC-rader visar motpart. |
| `get_actuals` | Utfall per bolag och år. |
| `compare_budget_actuals` | Budget mot utfall. `include_comments` lägger ägarnas kommentarer på varje kontorad. |
| `get_budget_comments` | Kommentarer på enskilda rader. |
| `get_locks` | Låsta kostnadsställen och om scenariot är godkänt. |
| `get_intercompany_budget` | Internhandel avstämd: säljarens sida, köparens sida, netto. Scenarier matchas över bolag på **namn**. |
| `get_sync_status` | Senaste synk- och exporthändelserna. |

**Sektionsbehörigheter gäller.** De är en app-regel och inte RLS, så servern tillämpar dem själv:
konton i sektioner du inte får se finns inte i svaren, och ett konto utan sektion är bara synligt för
administratörer. Samma unionsregel som appen (`role_section_permissions`, vilken roll som helst som
ger tillgång räcker).

## Skrivverktyg — två steg

Inget skrivs av ett `propose_*`-verktyg. Allt går i två steg:

1. `propose_*` kontrollerar ändringen, sparar den i `mcp_change_log` och returnerar en
   förhandsvisning (gammalt → nytt) samt en `confirm_token`.
2. `apply_change(confirm_token, summary)` utför den. **Det är det enda verktyget som skriver
   budgetdata.** `summary` måste vara exakt den text förslaget gav — det är den du godkänner.

| Verktyg | Vad det föreslår |
|---|---|
| `propose_budget_changes` | Belopp per kostnadsställe, konto, år och månad. Med `counterpart_company_id` blir det internhandelsbudget. Max 500 rader. |
| `propose_comment_changes` | Skriva, uppdatera eller (tom text) ta bort radkommentaren. |
| `propose_cost_center_locks` | Låsa och/eller låsa upp kostnadsställen i ett scenario. |
| `propose_create_scenarios` | Skapa scenario (samma namn i flera bolag), valfritt med kopiering. **Bara administratörer.** |
| `apply_change` | Utför ett förslag. Bara den som gjorde förslaget kan utföra det. |

**Spärrar** (vid förslaget *och* igen vid `apply_change`):

- Godkända scenarier går inte att skriva i; kostnadsställen i dem går inte att låsa upp.
- Låsta kostnadsställen går inte att skriva i.
- Personalbudgetens konton (`staff_locked_account_ids`) går inte att skriva i.
- Bara budgeterbara konton, i sektioner där du har *Editera*. Perioden måste ligga i scenariot.
- Internhandel: motpartsbolag krävs på intercompany-konton och är förbjudet på andra.
- Ett scenarionamn som redan finns i bolaget vägras.
- En ogiltig rad stoppar hela förslaget. En token gäller en gång och i 30 minuter. Har en cell
  ändrats sedan förhandsvisningen vägrar `apply_change`.

Utöver detta gäller databasens egna regler eftersom allt körs som användaren: RLS på
`budget_entries`, `scenario_locks` och `budget_comments`, samt triggern som skyddar personalkonton.

**Godkännandet:** servern kan inte själv veta att en människa har godkänt. Spärren är att
`apply_change` ska fråga användaren i klienten. I Claude Code: låt aldrig `apply_change` ligga i
`permissions.allow`. Läsverktygen och `propose_*` kan gärna tillåtas.

## Verifiera

Utan token ska servern svara med OAuth-utmaningen:

```bash
curl -si -X POST https://sjzhrxzyrbtbryypcpor.supabase.co/functions/v1/mcp -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}"
```

Förväntat: `401` med `WWW-Authenticate: Bearer ... resource_metadata="…/.well-known/oauth-protected-resource"`.

```bash
curl -s https://sjzhrxzyrbtbryypcpor.supabase.co/functions/v1/mcp/.well-known/oauth-protected-resource
curl -s https://sjzhrxzyrbtbryypcpor.supabase.co/.well-known/oauth-authorization-server/auth/v1
```

Den första ska nämna `…/auth/v1` som auktorisationsserver, den andra ska ge Supabase Auths metadata
(`feature_disabled` betyder att OAuth-servern inte är påslagen). Efter inloggning: `tools/list` ger
17 verktyg. Provköra skrivvägen på ett **testscenario**, och prova att ett godkänt scenario, ett låst
kostnadsställe och en sektion utan Editera-rätt vägras.

## Säkerhetsnoteringar

- Servern använder service role till **en enda sak**: tabellen `mcp_change_log` (RLS på, inga
  policies) och att validera åtkomsttoken. Budgetdata läses och skrivs alltid med användarens
  egen token.
- Personalbudgetens löner är inte exponerade som verktyg, men personalkontona (7210 m.fl.) syns
  som vanliga konton för den som har sektionsbehörighet.
- Tokens från Supabase Auth gäller för hela användarens konto, inte bara för MCP. Användare kan
  stängas av genom att tas bort eller loggas ut överallt.
- Teckenkonventionen för internhandel är inte verifierad. Kör `get_intercompany_budget` efter en
  skrivning och kontrollera att nettot blir noll.
