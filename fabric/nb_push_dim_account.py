# Fabric notebook source
# Pushes shared account plan (dim_account) from silver lakehouse to Supabase budget-tool.
# Syncs: accounts (all 4 companies) + account_configs (section, is_intercompany).
# Does NOT touch is_budgetable — that is owned by the budget-tool UI.

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {
# META     "lakehouse": {
# META       "default_lakehouse": "TODO_lh_silver_id",
# META       "default_lakehouse_name": "lh_silver",
# META       "default_lakehouse_workspace_id": "febab450-3c4c-4bec-88b3-b03be0622aba",
# META       "known_lakehouses": [
# META         {
# META           "id": "TODO_lh_silver_id"
# META         }
# META       ]
# META     }
# META   }
# META }

# CELL ********************
# Config

import requests
from pyspark.sql import functions as F

SUPABASE_URL         = "https://sjzhrxzyrbtbryypcpor.supabase.co"
SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqemhyeHp5cmJ0YnJ5eXBjcG9yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzAxODUwNywiZXhwIjoyMDkyNTk0NTA3fQ.y4DDBbVAX2Z-tp9EsS4Q74KilkCf5Bo3lHgXjYM1Gj0"

# Supabase company_id per fabric_key (matches companies.fabric_key in Supabase)
COMPANY_MAP = {"bolag1": 1, "bolag2": 2, "bolag3": 3, "bolag4": 4}

BATCH_SIZE = 500

HEADERS = {
    "apikey":        SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type":  "application/json",
    "Prefer":        "resolution=merge-duplicates",
}

# Map dim_account.Kontotyp values → Supabase account_type enum (income/expense/balance).
# Adjust keys to match the actual values in your dim_account table.
KONTOTYP_MAP = {
    "intäkt":   "income",
    "intäkter": "income",
    "kostnad":  "expense",
    "kostnader":"expense",
    "tillgång": "balance",
    "tillgångar":"balance",
    "skuld":    "balance",
    "skulder":  "balance",
    "eget kapital": "balance",
}

def derive_account_type(account_number: str) -> str:
    """Fallback: derive income/expense/balance from BAS account number range."""
    try:
        n = int(float(account_number))
        if 3000 <= n <= 3999:
            return "income"
        if 4000 <= n <= 8999:
            return "expense"
    except Exception:
        pass
    return "balance"

def map_account_type(kontotyp, account_number: str) -> str:
    """Use Kontotyp if available, fall back to account number range."""
    if kontotyp:
        mapped = KONTOTYP_MAP.get(str(kontotyp).strip().lower())
        if mapped:
            return mapped
    return derive_account_type(account_number)

def to_bool(val) -> bool:
    """Normalize internkonto to Python bool regardless of source type."""
    if val is None:
        return False
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return int(val) != 0
    return str(val).strip().lower() in ("1", "true", "ja", "yes", "sant", "x")

def fmt_number(val) -> str:
    try:
        return str(int(float(val)))
    except Exception:
        return str(val)

def batch_upsert(endpoint: str, rows: list, on_conflict: str, extra_prefer: str = "") -> list:
    """POST rows in batches; return list of error strings."""
    errors = []
    prefer = "resolution=merge-duplicates"
    if extra_prefer:
        prefer += f",{extra_prefer}"
    hdrs = {**HEADERS, "Prefer": prefer}
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/{endpoint}",
            headers=hdrs,
            params={"on_conflict": on_conflict},
            json=batch,
            timeout=30,
        )
        if not resp.ok:
            errors.append(f"batch {i // BATCH_SIZE + 1}: {resp.status_code} {resp.text[:300]}")
        else:
            print(f"  {endpoint} batch {i // BATCH_SIZE + 1}: {len(batch)} rows upserted")
    return errors

print("Config loaded.")

# CELL ********************
# Read dim_account from silver lakehouse

df = spark.table("dim_account")

dim_rows = (
    df
    .filter(F.col("kontotyp").isNotNull())
    .select(
        "account_number",
        "benämning",
        "klass",
        "internkonto",
        "kontotyp",
    )
).collect()

print(f"dim_account rows (Kontotyp ej null): {len(dim_rows)}")

# CELL ********************
# Build account rows for all 4 companies (same kontoplan shared across companies)

all_errors    = []
account_rows  = []
account_id_map = {}  # (company_id, account_number) -> account_id

for row in dim_rows:
    account_number = fmt_number(row["account_number"])
    for company_id in COMPANY_MAP.values():
        account_rows.append({
            "company_id":     company_id,
            "account_number": account_number,
            "name":           row["benämning"] or "",
            "account_type":   map_account_type(row["kontotyp"], account_number),
        })

print(f"Account rows to upsert: {len(account_rows)} ({len(dim_rows)} accounts × {len(COMPANY_MAP)} companies)")

# Upsert with return=representation so we get IDs back directly — no separate fetch needed
upsert_headers = {
    **HEADERS,
    "Prefer": "resolution=merge-duplicates,return=representation",
}

for i in range(0, len(account_rows), BATCH_SIZE):
    batch = account_rows[i : i + BATCH_SIZE]
    resp  = requests.post(
        f"{SUPABASE_URL}/rest/v1/accounts",
        headers=upsert_headers,
        params={"on_conflict": "company_id,account_number"},
        json=batch,
        timeout=30,
    )
    if not resp.ok:
        all_errors.append(f"accounts batch {i // BATCH_SIZE + 1}: {resp.status_code} {resp.text[:300]}")
    else:
        for r in resp.json():
            account_id_map[(r["company_id"], r["account_number"])] = r["id"]
        print(f"  accounts batch {i // BATCH_SIZE + 1}: {len(batch)} upserted")

print(f"Account IDs collected: {len(account_id_map)}")

# CELL ********************
# Build account_config rows: section (Klass) + is_intercompany (Internkonto)
# On conflict (account_id already exists): update only section + is_intercompany.
# is_budgetable is intentionally excluded — it stays as-is in the budget tool.

config_rows = []

for row in dim_rows:
    account_number = fmt_number(row["account_number"])
    section        = row["klass"] or None
    is_ic          = to_bool(row["internkonto"])

    for company_id in COMPANY_MAP.values():
        account_id = account_id_map.get((company_id, account_number))
        if account_id is None:
            all_errors.append(f"account_id not found: company={company_id} account={account_number}")
            continue
        config_rows.append({
            "account_id":     account_id,
            "section":        section,
            "is_intercompany": is_ic,
        })

print(f"account_config rows to upsert: {len(config_rows)}")

errs = batch_upsert(
    "account_configs",
    config_rows,
    on_conflict="account_id",
)
all_errors.extend(errs)

# CELL ********************
# Write sync log

status = "success" if not all_errors else "partial_error"

requests.post(
    f"{SUPABASE_URL}/rest/v1/sync_log",
    headers={**HEADERS, "Prefer": ""},
    json={
        "sync_type":    "dim_account",
        "triggered_by": "fabric",
        "status":       status,
        "details": {
            "source_rows":    len(dim_rows),
            "account_rows":   len(account_rows),
            "config_rows":    len(config_rows),
            "errors":         all_errors[:20],  # cap to avoid huge payloads
        },
    },
    timeout=30,
)

print(f"\nDone — {status}")
if all_errors:
    print(f"Errors ({len(all_errors)}):")
    for e in all_errors[:10]:
        print(f"  {e}")
