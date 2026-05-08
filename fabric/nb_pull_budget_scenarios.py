# Fabric notebook source
# Pulls budget scenarios and entries from Supabase budget-tool into a Delta table
# in the silver lakehouse (lh_silver.fact_budget).
# Partitioned by scenario_year + fabric_key. Full overwrite per partition.
# Used as input for budget vs actuals analysis in Fabric.

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

# PARAMETERS ********************

# Override when triggering from a pipeline:
#   FILTER_YEAR — pull only this year (0 = all years)

FILTER_YEAR = 0  # int, e.g. 2026

# CELL ********************
# Config & helpers

import requests
import time
from pyspark.sql import Row
from pyspark.sql import functions as F
from pyspark.sql.types import (
    StructType, StructField,
    IntegerType, StringType, DecimalType, BooleanType, DateType, TimestampType,
)
from datetime import date, datetime, timezone
from delta.tables import DeltaTable

SUPABASE_URL         = "https://sjzhrxzyrbtbryypcpor.supabase.co"
SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqemhyeHp5cmJ0YnJ5eXBjcG9yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzAxODUwNywiZXhwIjoyMDkyNTk0NTA3fQ.y4DDBbVAX2Z-tp9EsS4Q74KilkCf5Bo3lHgXjYM1Gj0"

TARGET_TABLE = "fact_budget"
PAGE_SIZE    = 1000

HEADERS = {
    "apikey":        SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type":  "application/json",
}

def get_all_pages(endpoint: str, params: dict) -> list:
    """Paginate through a PostgREST endpoint and return all rows."""
    rows, start = [], 0
    while True:
        hdrs = {
            **HEADERS,
            "Range-Unit": "items",
            "Range":      f"{start}-{start + PAGE_SIZE - 1}",
            "Prefer":     "count=none",
        }
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/{endpoint}",
            headers=hdrs, params=params, timeout=60,
        )
        resp.raise_for_status()
        page = resp.json()
        rows.extend(page)
        print(f"  {endpoint}: fetched {len(rows)} rows...", end="\r")
        if len(page) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    print(f"  {endpoint}: {len(rows)} rows total.          ")
    return rows

def log_sync(status: str, details: dict):
    requests.post(
        f"{SUPABASE_URL}/rest/v1/sync_log",
        headers={**HEADERS, "Prefer": ""},
        json={
            "sync_type":    "pull_budget_scenarios",
            "triggered_by": "fabric",
            "status":       status,
            "details":      details,
        },
        timeout=30,
    )

run_start = time.time()
synced_at = datetime.now(timezone.utc)

print(f"Parameters: FILTER_YEAR={FILTER_YEAR or 'all'}")

# CELL ********************
# Fetch companies — map Supabase company_id → fabric_key (bolag1–bolag4)

companies_raw = get_all_pages("companies", {"select": "id,fabric_key"})
company_map   = {c["id"]: c["fabric_key"] for c in companies_raw}
print(f"Company map: {company_map}")

# CELL ********************
# Read already-synced approved scenarios from fact_budget (these are final — skip them)

already_synced_approved = set()

if spark.catalog.tableExists(TARGET_TABLE):
    already_synced_approved = set(
        spark.table(TARGET_TABLE)
        .filter(F.col("scenario_is_approved") == True)
        .select("scenario_id")
        .distinct()
        .rdd.flatMap(lambda r: r)
        .collect()
    )
    print(f"Already synced as approved: {sorted(already_synced_approved)}")
else:
    print("fact_budget does not exist yet — full load.")

# CELL ********************
# Fetch all scenarios from Supabase, then filter out already-approved ones

scenario_params = {"select": "id,name,year,is_approved,company_id"}
if FILTER_YEAR:
    scenario_params["year"] = f"eq.{FILTER_YEAR}"

scenarios_raw = get_all_pages("scenarios", scenario_params)

# Skip scenarios that are approved AND already present as approved in fact_budget.
# Approved scenarios not yet in fact_budget are included once more to capture final state.
scenarios_to_sync = [
    s for s in scenarios_raw
    if not (s["is_approved"] and s["id"] in already_synced_approved)
]
skipped_approved  = [s for s in scenarios_raw if s["is_approved"] and s["id"] in already_synced_approved]

scenario_map = {s["id"]: s for s in scenarios_to_sync}

print(f"\nAll scenarios:       {len(scenarios_raw)}")
print(f"Already done (skip): {len(skipped_approved)}")
print(f"To sync:             {len(scenarios_to_sync)}")

if skipped_approved:
    print("\nSkipped (already approved & synced):")
    for s in skipped_approved:
        print(f"  [{s['id']}] {s['name']} ({s['year']}) {company_map.get(s['company_id'], '?')}")

print("\nSyncing:")
for s in sorted(scenarios_to_sync, key=lambda x: (x["year"], x["company_id"])):
    status = "✓ KLAR" if s["is_approved"] else "  pågår"
    print(f"  [{s['id']}] {s['name']:<30} {s['year']}  {company_map.get(s['company_id'], '?'):<8}  {status}")

if not scenarios_to_sync:
    print("\nAll scenarios already synced and approved — nothing to do.")
    log_sync("success", {"scenarios_total": len(scenarios_raw), "skipped_approved": len(skipped_approved), "synced": 0, "note": "all already done"})
    raise SystemExit(0)

# CELL ********************
# Fetch budget entries for matching scenarios only

scenario_ids = list(scenario_map.keys())

# PostgREST IN filter: scenario_id=in.(1,2,3)
entries_raw = get_all_pages("budget_entries", {
    "select":      "scenario_id,month,amount,accounts(account_number),cost_centers(code)",
    "scenario_id": f"in.({','.join(str(i) for i in scenario_ids)})",
})

print(f"Budget entries fetched: {len(entries_raw)}")

# CELL ********************
# Build flat rows

schema = StructType([
    StructField("scenario_id",          IntegerType(),       False),
    StructField("scenario_name",        StringType(),        False),
    StructField("scenario_year",        IntegerType(),       False),
    StructField("scenario_is_approved", BooleanType(),       False),
    StructField("fabric_key",           StringType(),        False),
    StructField("account_number",       StringType(),        False),
    StructField("cost_center_code",     StringType(),        False),
    StructField("date",                 DateType(),          True),
    StructField("amount",               DecimalType(18, 2),  False),
    StructField("synced_at",            TimestampType(),     False),
])

fact_rows = []
warnings  = []

for e in entries_raw:
    scenario = scenario_map.get(e["scenario_id"])
    if not scenario:
        warnings.append(f"unknown scenario_id={e['scenario_id']}")
        continue

    account = e.get("accounts") or {}
    cc      = e.get("cost_centers") or {}

    account_number   = account.get("account_number", "")
    cost_center_code = cc.get("code", "")

    if not account_number:
        warnings.append(f"missing account_number on entry scenario={e['scenario_id']}")
        continue

    amount = e.get("amount")
    try:
        amount = float(amount) if amount is not None else 0.0
    except (TypeError, ValueError):
        amount = 0.0

    year  = int(scenario.get("year") or 0)
    month = int(e.get("month") or 0)

    if not (year and 1 <= month <= 12):
        warnings.append(f"invalid year/month: scenario={e['scenario_id']} year={year} month={month}")
        continue

    company_id = scenario.get("company_id")
    fabric_key = company_map.get(company_id, f"bolag{company_id}")

    fact_rows.append(Row(
        scenario_id          = int(e["scenario_id"]),
        scenario_name        = scenario.get("name", ""),
        scenario_year        = year,
        scenario_is_approved = bool(scenario.get("is_approved", False)),
        fabric_key           = fabric_key,
        account_number       = account_number,
        cost_center_code     = cost_center_code,
        date                 = date(year, month, 1),
        amount               = amount,
        synced_at            = synced_at,
    ))

print(f"Rows built: {len(fact_rows)}")
if warnings:
    print(f"Warnings ({len(warnings)}):")
    for w in warnings[:10]:
        print(f"  ⚠ {w}")

# CELL ********************
# Summary per scenario

from collections import defaultdict
summary = defaultdict(lambda: {"rows": 0, "amount": 0.0})
for r in fact_rows:
    key = (r.scenario_id, r.scenario_name, r.fabric_key)
    summary[key]["rows"]   += 1
    summary[key]["amount"] += float(r.amount)

print(f"\n{'Scenario':<35} {'Bolag':<10} {'Rader':>7}  {'Summa':>14}")
print("-" * 70)
for (sid, sname, fkey), stats in sorted(summary.items()):
    print(f"[{sid}] {sname:<32} {fkey:<10} {stats['rows']:>7}  {stats['amount']:>14,.0f}")

# CELL ********************
# Write to Delta table
# Strategy: delete existing rows for synced scenario_ids, then append fresh data.
# This ensures approved scenarios that just became final get their last update,
# while already-approved (skipped) scenarios remain untouched in the table.

df = spark.createDataFrame(fact_rows, schema=schema)
synced_ids = list(scenario_map.keys())

if spark.catalog.tableExists(TARGET_TABLE):
    DeltaTable.forName(spark, TARGET_TABLE).delete(
        F.col("scenario_id").isin(synced_ids)
    )
    df.write.format("delta").mode("append").saveAsTable(TARGET_TABLE)
else:
    # First run — create partitioned table
    (
        df.write
        .format("delta")
        .mode("overwrite")
        .option("overwriteSchema", "true")
        .partitionBy("scenario_year", "fabric_key")
        .saveAsTable(TARGET_TABLE)
    )

written = df.count()
elapsed = round(time.time() - run_start, 1)
print(f"\nWritten {written} rows to {TARGET_TABLE}  ({elapsed}s)")

# CELL ********************
# Sync log

log_sync("success", {
    "scenarios_total":    len(scenarios_raw),
    "skipped_approved":   len(skipped_approved),
    "scenarios_synced":   len(scenarios_to_sync),
    "entries_pulled":     len(entries_raw),
    "rows_written":       written,
    "warnings":           len(warnings),
    "elapsed_seconds":    elapsed,
    "filter_year":        FILTER_YEAR or None,
    "target_table":       TARGET_TABLE,
})

print("Done ✓")
