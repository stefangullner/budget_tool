# Arkitektur — On Via Budget Tool

**Status:** Utkast — ej slutgiltigt

---

## Övergripande bild

```
┌─────────────────────────────────────────────────────────┐
│                      Webbläsare                          │
│                   (React / Next.js)                      │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTPS
┌──────────────────────▼──────────────────────────────────┐
│                     API-lager                            │
│              (Next.js API routes / FastAPI)              │
│                                                          │
│  - Autentisering via Entra ID (MSAL)                    │
│  - Auktorisering: roll → bolag/kostnadsställe           │
│  - CRUD mot Fabric Warehouse (budget-data)              │
│  - Läsning mot Fabric Lakehouse (utfallsdata/Fortnox)   │
└──────────┬───────────────────────────┬───────────────────┘
           │                           │
┌──────────▼──────────┐   ┌────────────▼────────────────┐
│  Fabric Warehouse   │   │   Fabric Lakehouse           │
│  (Budget-data)      │   │   (Fortnox utfallsdata)      │
│                     │   │                              │
│  - companies        │   │  - bronze/fortnox_*          │
│  - cost_centers     │   │  - silver/gl_transactions    │
│  - accounts         │   │                              │
│  - budgets          │   │                              │
│  - scenarios        │   │                              │
│  - forecasts        │   │                              │
└─────────────────────┘   └──────────────────────────────┘
```

---

## Autentisering

- **Provider:** Microsoft Entra ID (befintlig tenant `onvia.se`)
- **Flöde:** OAuth 2.0 Authorization Code + PKCE via MSAL
- **Token:** Används för att anropa Fabric REST API med rätt scope
- **Rollmappning:** Entra ID-grupper mappar mot approller (admin, company_manager, cost_center_manager)

---

## Dataflöde: Utfall

```
Fortnox API → Pipeline → Bronze Lakehouse → Silver (gl_transactions)
                                                    ↑
                                              Läses av API-lagret
                                              och presenteras i UI
```

---

## Dataflöde: Budget

```
Användare → UI (formulär) → API-lager → Fabric Warehouse (budget-tabeller)
                                              ↑
                                        Läses för budget vs utfall
```

---

## Teknikval (ej slutgiltiga)

| Komponent | Kandidater | Kommentar |
|---|---|---|
| Frontend | Next.js 15 (App Router) | Server Components + Client Components |
| Designsystem | shadcn/ui + Tailwind | Snabb setup, anpassningsbar |
| Auth | MSAL.js / NextAuth med Entra ID | NextAuth enklare att integrera |
| API | Next.js API Routes | Håller allt i ett repo |
| Hosting | Azure Static Web Apps | Nära Fabric, Entra ID-integration |
| CI/CD | GitHub Actions | Standard |
