# MCP-server för Budget Tool

En MCP-server (Model Context Protocol) som exponerar budget-tool-databasen som verktyg för
Claude och andra MCP-klienter. Körs som Edge Function på
`https://sjzhrxzyrbtbryypcpor.supabase.co/functions/v1/mcp`.

Servern är **läsbehörig endast** — den innehåller inga verktyg som skriver till databasen.

## Verktyg

| Verktyg | Vad det gör |
|---|---|
| `list_companies` | Alla 4 bolag med id, namn, orgnummer och fabric_key. Börja här. |
| `list_cost_centers` | Kostnadsställen för ett bolag, med region. Kan filtreras på region. |
| `list_accounts` | Kontoplan med kurering — budgeterbart, intercompany, sektion, ordning. |
| `list_sections` | De 33 sektionerna i konfigurerad visningsordning. |
| `list_scenarios` | Scenarier med period, deadline och godkännandestatus. |
| `get_budget` | Budgeterade belopp för ett scenario. IC-rader visar motpartsbolag. Aggregeras per konto/KS/månad/sektion. |
| `get_actuals` | Utfall per bolag och år. Samma aggregeringsval. |
| `compare_budget_actuals` | Budget mot utfall med avvikelse i kr och procent, per konto eller sektion. |
| `get_budget_comments` | Kommentarer som budgetägare lämnat på enskilda rader. |
| `get_sync_status` | Senaste synk- och exporthändelserna, för att bedöma hur färsk datan är. |

Sektionsgrupperingar sorteras med `section_configs.display_order`, samma ordning som
BudgetMatrix och Excel-exporten använder.

## Miljövariabler

`SUPABASE_URL` och `SUPABASE_SERVICE_ROLE_KEY` sätts automatiskt av Supabase.
Du behöver bara lägga till en:

| Variabel | Beskrivning |
|---|---|
| `MCP_TOKEN` | Delad hemlighet som klienten skickar som `Authorization: Bearer <token>`. |

Generera en token i PowerShell:

```powershell
-join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
```

Lägg in den under **Project Settings → Edge Functions → Secrets** i Supabase-dashboarden.

## Deploy

Edge Functions i det här projektet deployas via dashboarden (se "Kända workarounds" i
projektstatusen):

1. Öppna **Edge Functions → Deploy a new function → Via editor**.
2. Namnge funktionen `mcp` och klistra in innehållet i `index.ts`.
3. Slå **av** "Verify JWT with legacy secret" för funktionen — servern har sin egen
   tokenkontroll och MCP-klienten skickar ingen Supabase-JWT.
4. Lägg till `MCP_TOKEN` som secret enligt ovan.

Steg 3 är inte valfritt. Med JWT-verifiering på svarar gatewayen 401 innan koden ens körs.

## Koppla in i Claude Code

```bash
claude mcp add --transport http onvia-budget https://sjzhrxzyrbtbryypcpor.supabase.co/functions/v1/mcp --header "Authorization: Bearer <MCP_TOKEN>"
```

## Verifiera

Lista verktygen utan MCP-klient:

```bash
curl -s -X POST https://sjzhrxzyrbtbryypcpor.supabase.co/functions/v1/mcp -H "Authorization: Bearer <MCP_TOKEN>" -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}"
```

Ett anrop:

```bash
curl -s -X POST https://sjzhrxzyrbtbryypcpor.supabase.co/functions/v1/mcp -H "Authorization: Bearer <MCP_TOKEN>" -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"list_companies\",\"arguments\":{}}}"
```

Förväntat: fyra bolag — 1=Transportgymnasiet, 2=SYAB Gruppen, 3=On Via Trafikutbildningar,
4=On Via TS AB.

## Säkerhetsnoteringar

- Funktionen använder `service_role`-nyckeln och **går därför förbi RLS**. Alla verktyg ser
  samtliga bolag och alla sektioner — sektionsbehörigheterna i appen gäller inte här. Den som
  har `MCP_TOKEN` ser all budgetdata. Behandla token som ett lösenord och committa den aldrig.
- Rotera token genom att sätta om secreten och uppdatera klientens header.
- `get_budget_comments` läser `budget_comments`, som har RLS påslaget utan policies i appen.
  Service role kommer förbi det — verktyget fungerar alltså även om appen inte visar tabellen.
- Vill du senare lägga till skrivande verktyg: sätt dem bakom en egen `MCP_ALLOW_WRITES`-flagga
  och kräv explicit scenario- och kostnadsställes-id, så att ett felaktigt anrop inte kan skriva
  över en hel budget.
