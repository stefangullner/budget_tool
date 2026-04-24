# Projektplan — On Via Budget Tool

**Senast uppdaterad:** 2026-04-24  
**Status:** Fas 0 — Planering

---

## Mål

Bygga ett internt webbaserat budgetverktyg för On Via med fyra bolag som stödjer:
- Budgetering per konto, kostnadsställe och månad
- Utfallsjämförelse mot faktiska siffror från Fortnox
- Prognoser med flera scenarier
- Beräknade rader (lönebikostnader, SLP m.m.)
- Rollbaserad åtkomst (bolag, kostnadsställe, admin)

---

## Faser

### Fas 0 — Planering *(pågående)*
- [x] Kravanalys och funktionsöversikt
- [x] Val av teknisk stack och lagring
- [ ] Datamodell (tabellstruktur i Fabric Warehouse)
- [ ] UI-val (ramverk, designsystem)
- [ ] Arkitekturbeslut (API-lager, auth-flöde)

### Fas 1 — Grund & datamodell
- [ ] Skapa Fabric Warehouse för budget-data
- [ ] Skapa grundtabeller: bolag, kostnadsställen, konton, kontokonfiguration
- [ ] Migrera/synka kontoplaner från Fortnox-data
- [ ] Autentisering via Entra ID mot Fabric

### Fas 2 — Budgetinmatning
- [ ] UI för kontoplanshantening (kuration — vilka konton är budgeterbara)
- [ ] Definiera beräknade rader med formler (lönebikostnad, SLP)
- [ ] Budgetinmatning per konto × kostnadsställe × månad
- [ ] Validering och autosave

### Fas 3 — Utfall & jämförelse
- [ ] Koppla mot utfallsdata från Fortnox bronslager
- [ ] Budget vs utfall per månad, kvartal, helår
- [ ] Avvikelseanalys (kr och %)
- [ ] Trafikljusstatus per kostnadsställe

### Fas 4 — Prognoser & scenarier
- [ ] Skapa namngivna scenarier (Bas, Optimistisk, Worst case)
- [ ] Prognos = Utfall YTD + justerat budget för resten av år
- [ ] Scenariojämförelse sida vid sida
- [ ] Frysning av scenarioversionerma (snapshot)

### Fas 5 — Åtkomstkontroll & administration
- [ ] Rollhantering: Admin, Bolagsansvarig, Kostnadsställeansvarig
- [ ] Bolagsspecifik konfiguration
- [ ] Låsning av godkänd budget (sign-off)
- [ ] Versionshistorik — vem ändrade vad och när

### Fas 6 — Rapportering & export
- [ ] Föregående års utfall-vy
- [ ] Rullande 12-månaders vy
- [ ] Kommentarsfält per rad/konto
- [ ] Export till Excel och PDF
- [ ] Schemalagda budget vs utfall-rapporter

---

## Beslut som återstår

| Beslut | Alternativ | Status |
|---|---|---|
| UI-ramverk | Next.js / React / annat | Ej beslutat |
| Designsystem | shadcn/ui, Tailwind, Fluent UI | Ej beslutat |
| API-lager | Next.js API routes, FastAPI, direkt Fabric REST | Ej beslutat |
| Hosting | Azure Static Web Apps, Vercel, Fabric | Ej beslutat |
| Deployment-pipeline | GitHub Actions, Azure DevOps | Ej beslutat |

---

## Nästa steg

1. Besluta UI-ramverk och hosting
2. Designa datamodell (se `docs/data-model.md`)
3. Sätt upp Fabric Warehouse för budgetdata
