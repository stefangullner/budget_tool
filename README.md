# Budget Tool — On Via

Internt budgetverktyg för On Via med stöd för budget, utfall, prognos och scenarioanalys.

## Bolag som omfattas
- Bolag 1–4 (olika kostnadsställen, konton och användare per bolag)

## Snabblänkar
- [Projektplan](docs/project-plan.md)
- [Arkitektur](docs/architecture.md)
- [Datamodell](docs/data-model.md)
- [Funktionsspecifikation](docs/features.md)

## Mappar

| Mapp | Innehåll |
|---|---|
| `docs/` | Dokumentation — plan, arkitektur, datamodell, features |
| `src/` | Webbapplikationens källkod |
| `fabric/` | SQL-skript, notebook-definitioner och Fabric-specifik kod |

## Teknisk stack (beslutad)
- **Lagring:** Microsoft Fabric Warehouse
- **Auth:** Entra ID (befintlig tenant)
- **Utfallsdata:** Fortnox via befintligt bronslager i Fabric

## Status
Se [Projektplan](docs/project-plan.md) för aktuell fas och nästa steg.
