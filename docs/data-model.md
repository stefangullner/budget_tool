# Datamodell — On Via Budget Tool

**Status:** Utkast — ej implementerad

---

## Tabellöversikt

```
companies
    └── cost_centers
    └── accounts
            └── account_config       (kuration, formler, kategorier)

scenarios
    └── budget_entries               (budget per konto × ks × månad × scenario)

forecast_snapshots
    └── forecast_entries             (prognos per konto × ks × månad × snapshot)

users
    └── user_roles                   (koppling user → bolag/ks + roll)

budget_comments                      (kommentarer per rad)
budget_locks                         (godkänd/låst budget per bolag × år)
audit_log                            (versionshistorik)
```

---

## Tabeller

### `companies`
| Kolumn | Typ | Beskrivning |
|---|---|---|
| id | INT PK | |
| name | NVARCHAR(100) | |
| org_number | NVARCHAR(20) | |
| fiscal_year_start | TINYINT | Månad (1–12) |
| created_at | DATETIME2 | |

### `cost_centers`
| Kolumn | Typ | Beskrivning |
|---|---|---|
| id | INT PK | |
| company_id | INT FK | |
| code | NVARCHAR(20) | Kostnadsställekod |
| name | NVARCHAR(100) | |
| is_active | BIT | |

### `accounts`
| Kolumn | Typ | Beskrivning |
|---|---|---|
| id | INT PK | |
| company_id | INT FK | |
| account_number | NVARCHAR(10) | Kontonummer (från Fortnox) |
| name | NVARCHAR(200) | |
| account_type | NVARCHAR(20) | income / expense / balance |

### `account_config`
| Kolumn | Typ | Beskrivning |
|---|---|---|
| id | INT PK | |
| account_id | INT FK | |
| is_budgetable | BIT | Syns i budgetformuläret |
| is_calculated | BIT | Räknas ut automatiskt |
| formula | NVARCHAR(500) | T.ex. `account_7010 * 0.3142` |
| display_order | INT | Sorteringsordning i UI |
| section | NVARCHAR(100) | Grupprubrik (Personal, Lokaler...) |
| notes | NVARCHAR(500) | Förklaring av formel |

### `scenarios`
| Kolumn | Typ | Beskrivning |
|---|---|---|
| id | INT PK | |
| company_id | INT FK | |
| name | NVARCHAR(100) | Bas, Optimistisk, Worst case... |
| year | INT | Budgetår |
| is_approved | BIT | Låst efter sign-off |
| approved_by | NVARCHAR(200) | |
| approved_at | DATETIME2 | |
| created_by | NVARCHAR(200) | |
| created_at | DATETIME2 | |

### `budget_entries`
| Kolumn | Typ | Beskrivning |
|---|---|---|
| id | BIGINT PK | |
| scenario_id | INT FK | |
| account_id | INT FK | |
| cost_center_id | INT FK | |
| month | TINYINT | 1–12 |
| amount | DECIMAL(18,2) | |
| updated_by | NVARCHAR(200) | |
| updated_at | DATETIME2 | |

### `forecast_snapshots`
| Kolumn | Typ | Beskrivning |
|---|---|---|
| id | INT PK | |
| scenario_id | INT FK | |
| name | NVARCHAR(100) | T.ex. "Prognos mars 2026" |
| snapshot_date | DATE | |
| created_by | NVARCHAR(200) | |

### `forecast_entries`
| Kolumn | Typ | Beskrivning |
|---|---|---|
| id | BIGINT PK | |
| snapshot_id | INT FK | |
| account_id | INT FK | |
| cost_center_id | INT FK | |
| month | TINYINT | 1–12 |
| amount | DECIMAL(18,2) | |

### `users`
| Kolumn | Typ | Beskrivning |
|---|---|---|
| id | INT PK | |
| entra_oid | NVARCHAR(50) | Azure AD Object ID |
| email | NVARCHAR(200) | |
| display_name | NVARCHAR(200) | |

### `user_roles`
| Kolumn | Typ | Beskrivning |
|---|---|---|
| id | INT PK | |
| user_id | INT FK | |
| role | NVARCHAR(30) | admin / company_manager / cost_center_manager |
| company_id | INT FK NULL | NULL = alla bolag |
| cost_center_id | INT FK NULL | NULL = alla ks för bolaget |

### `budget_comments`
| Kolumn | Typ | Beskrivning |
|---|---|---|
| id | INT PK | |
| scenario_id | INT FK | |
| account_id | INT FK | |
| cost_center_id | INT FK | |
| month | TINYINT NULL | NULL = hel rad |
| comment | NVARCHAR(2000) | |
| created_by | NVARCHAR(200) | |
| created_at | DATETIME2 | |

### `audit_log`
| Kolumn | Typ | Beskrivning |
|---|---|---|
| id | BIGINT PK | |
| table_name | NVARCHAR(100) | |
| record_id | BIGINT | |
| action | NVARCHAR(10) | INSERT / UPDATE / DELETE |
| old_value | NVARCHAR(MAX) | JSON |
| new_value | NVARCHAR(MAX) | JSON |
| changed_by | NVARCHAR(200) | |
| changed_at | DATETIME2 | |

---

## Utfallsdata (Fabric Lakehouse — läsbart)

Dessa tabeller ägs av Fortnox-integrationen och läses av budgetverktyget:

- `silver.gl_transactions` — verifikat med konto, ks, datum, belopp
- Aggregeras i API-lagret till månadsutfall per konto × ks

---

## Öppna frågor

- [ ] Behöver vi hantera periodisering (t.ex. hyra som betalas kvartalsvis)?
- [ ] Ska beräknade rader räknas i databasen (triggers) eller i applikationslagret?
- [ ] Konsoliderad vy över bolag — behövs intercompany-elimineringar?
