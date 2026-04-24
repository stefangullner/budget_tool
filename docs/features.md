# Funktionsspecifikation — On Via Budget Tool

**Status:** Utkast

---

## Modul 1: Kontohantering

### Kontoplanskuration
- Lista alla konton per bolag (hämtade från Fortnox)
- Markera konton som budgeterbara (synliga i budgetformuläret)
- Markera konton som beräknade (ej manuell inmatning)
- Definiera formel för beräknade konton:
  - Exempel: `7510 Arbetsgivaravgifter = konto_7010 * 0.3142`
  - Exempel: `7533 Särskild löneskatt = (konto_7410 + konto_7420) * 0.2426`
- Sätta visningsordning och sektionsrubrik (Personal, Lokaler, IT...)
- Lägga till förklarande not på konton

### Kontohierarki
- Gruppera konton i sektioner per bolag
- Delsummor per sektion
- Totalsumma per kostnadsställe

---

## Modul 2: Budgetering

### Budgetinmatning
- Välj bolag → kostnadsställe → år → scenario
- Tabellvy: rader = konton, kolumner = månader (jan–dec) + helår
- Direkt inmatning i celler (tab-navigering)
- Autosave (optimistic UI)
- Beräknade rader uppdateras automatiskt vid inmatning
- Kopiera värde till alla månader (fyll rad)
- Importera från föregående år (×% justering)

### Scenariohantering
- Skapa namngivna scenarier per bolag och år
- Kopiera scenario som utgångspunkt för nytt
- Visa flera scenarier sida vid sida
- Lås scenario efter godkännande (sign-off)

---

## Modul 3: Utfall & jämförelse

### Budget vs utfall
- Kolumner: Budget | Utfall | Avvikelse kr | Avvikelse %
- Perioder: vald månad, YTD, helår
- Trafikljusstatus per rad (grön ±5%, gul ±15%, röd >15%)
- Drill-down: klicka avvikelse → se underliggande verifikationer

### Historik
- Visa föregående 1–3 år utfall per konto × ks
- Jämförelsevy: Budget år N vs Utfall år N-1

---

## Modul 4: Prognos

### Prognosskapande
- Välj scenario som bas
- Prognos = Utfall YTD (faktiska siffror) + Justerat budget rest av år
- Möjlighet att manuellt justera enskilda månader/konton i prognosen
- Namnge och datera prognoser ("Prognos april 2026")

### Snapshot & jämförelse
- Frys prognos som en snapshot
- Jämför snapshots: "Prognos jan vs Prognos april"
- Spårbarhet: vem skapade, när, kommentar

---

## Modul 5: Åtkomst & administration

### Roller
| Roll | Åtkomst |
|---|---|
| Admin | Allt — alla bolag, konfiguration, användare |
| Bolagsansvarig | Sitt bolag — alla kostnadsställen, kan godkänna budget |
| KS-ansvarig | Sina kostnadsställen — inmatning och läsning |

### Användarhantering
- Koppla Entra ID-användare till bolag/kostnadsställen
- Bjud in nya användare via e-post
- Logga inloggningar och ändringar

### Budgetgodkännande
- Bolagsansvarig markerar budget som godkänd
- Godkänd budget låses — ändringar kräver admin
- Historik över godkännanden

---

## Modul 6: Rapportering

### Vyer i UI
- Månadsvy (kolumner = månader)
- Kvartalssummering
- Rullande 12 månader
- Konsoliderad vy (alla bolag summerat)

### Export
- Excel-export (formaterad med sektioner och summor)
- PDF-export för ledningsrapporter
- Schemalagd e-postrapport: budget vs utfall per bolag

### Kommentarer
- Kommentarsfält per konto × månad (synligt vid hover)
- Sammanfattning av alla kommentarer för ett kostnadsställe
- Kommentarer inkluderas i PDF-export

---

## Prioriteringsordning

| Prioritet | Funktion |
|---|---|
| P0 | Budgetinmatning, beräknade rader, budget vs utfall |
| P1 | Scenarier, kontoplanskuration, roller |
| P2 | Prognoser, snapshots, drill-down |
| P3 | Export, schemalagda rapporter, kommentarer |
