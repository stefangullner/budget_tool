-- Adds cost center + chart of accounts for Halkspecialisten i Sverige AB (org.nr 559126-0087).
-- The company row already exists (id 7, fabric_key bolag7), so it is looked up by org_number and
-- NOT inserted - inserting is what created duplicate companies last time.
--
-- Source: Fortnox via Accountie, P&L accounts (3000-8999, excl. 8999) with at least one posting
-- 2025-09-01 .. 2026-08-31; fetched 2026-10-20. 34 accounts.
--
-- Fortnox has NO cost centers for this company, and the budget tool budgets per cost center, so a
-- single cost center is created (code 1, "Halkspecialisten"), like the single KS on companies 1 and 3.
-- Change code/name if you prefer something else. Region is left NULL (invisible to region managers).
--
-- Account config: copied from the same account number in companies 1-4 where it exists (On Via TS,
-- id 4, preferred). The section mapping in step 4 only fills accounts that still have no section.
-- Idempotent; DDL/DML only.

-- 1. Cost center
INSERT INTO cost_centers (company_id, code, name, is_active)
SELECT c.id, '1', 'Halkspecialisten', true
FROM companies c
WHERE c.org_number = '559126-0087'
ON CONFLICT (company_id, code) DO NOTHING;

-- 2. Accounts  (number|name, rows separated by ;)
INSERT INTO accounts (company_id, account_number, name, account_type)
SELECT c.id,
       btrim(split_part(item, '|', 1)),
       btrim(split_part(item, '|', 2)),
       CASE WHEN btrim(split_part(item, '|', 1))::int < 4000 THEN 'income' ELSE 'expense' END
FROM (VALUES
  ('559126-0087', '3004|Periodiserade intäkter bokslut (ej moms);3005|Periodiserade intäkter bokslut Koncernintern ( ej moms ) ;3042|Försäljning R2 Bil Koncernintern ;3044|Fsg R2 Bil;3045|Försäljning Optima koncernflytt (del av 3044);3047|Körkortsjakten;3072|Periodiserad intäkt koncernintern;3740|Öres- och kronutjämning;3990|Övriga ersättningar och intäkter;4001|Banhyror;4011|Elevinternet STR;4012|Hyra Easydrift;4014|Parkeringsavgifter ;4015|Bil Leasing ;4100|Inköp tjänst Körkortsjakten;5410|Förbrukningsinventarier;5420|Hemsida och programvaror;5460|Förbrukningsmaterial;5611|Drivmedel för personbilar;5612|Försäkring och skatt fordon och lokal;5613|Reparation och underhåll av personbilar;5615|Leasing av personbilar;6040|Kontokortsavgifter;6420|Ersättningar till revisor;6540|IT-tjänster;6570|Bank & avgifter;6590|Övriga externa tjänster;6950|Tillsynsavgifter myndigheter;6990|Övriga externa kostnader;6991|Övriga externa kostnader, avdragsgilla;7810|Avskrivningar på immateriella anläggningstillgångar;7824|Avskrivningar på markanläggningar;8314|Skattefria ränteintäkter;8422|Dröjsmålsräntor för leverantörsskulder;8423|Räntekostnader för skatter och avgifter')
) AS raw(org, s)
JOIN companies c ON c.org_number = raw.org
CROSS JOIN LATERAL regexp_split_to_table(raw.s, ';') AS item
ON CONFLICT (company_id, account_number) DO NOTHING;

-- 3. Account configuration - copied from companies 1-4 when the account number exists there
INSERT INTO account_configs (account_id, is_budgetable, display_order, section, is_intercompany)
SELECT a.id,
       COALESCE(r.is_budgetable,
                a.account_number::int BETWEEN 3000 AND 7799
                AND a.account_number NOT IN ('3000', '3100', '3740')),
       COALESCE(r.display_order, a.account_number::int),
       r.section,
       COALESCE(r.is_intercompany, false)
FROM accounts a
JOIN companies c ON c.id = a.company_id
LEFT JOIN LATERAL (
  SELECT ac.is_budgetable, ac.display_order, ac.section, ac.is_intercompany
  FROM account_configs ac
  JOIN accounts ra ON ra.id = ac.account_id
  WHERE ra.account_number = a.account_number
    AND ra.company_id IN (1, 2, 3, 4)
  ORDER BY (ra.company_id = 4) DESC, ra.company_id
  LIMIT 1
) r ON true
WHERE c.org_number = '559126-0087'
ON CONFLICT (account_id) DO NOTHING;

-- 4. Sections for accounts that still have none (never overwrites an existing section).
--    ? = judgement call: 3047, 4011, 4012, 4100.
UPDATE account_configs ac
SET section = m.section
FROM accounts a
JOIN companies c ON c.id = a.company_id
JOIN (VALUES
  ('3005', 'Förändring av förskott'),
  ('3042', 'Intern omsättning'),
  ('3044', 'Lätt Behörighet'),
  ('3045', 'Intern omsättning'),
  ('3047', 'Extern omsättning'),                      -- ? Körkortsjakten (lead/marketplace revenue)
  ('3990', 'Övriga intäkter'),
  ('4001', 'Halkbana'),
  ('4011', 'Övriga direkta kostnader'),               -- ? Elevinternet STR
  ('4012', 'IT kostnader'),                           -- ? Hyra Easydrift
  ('4014', 'Fordonskostnader'),
  ('4015', 'Fordonsleasing'),
  ('4100', 'Övriga direkta kostnader'),               -- ? Inköp tjänst Körkortsjakten
  ('5420', 'IT kostnader'),
  ('5612', 'Fordonskostnader'),
  ('5615', 'Fordonsleasing'),
  ('6420', 'Redovisning/revision'),
  ('6540', 'IT kostnader'),
  ('7810', 'Avskrivningar'),
  ('7824', 'Avskrivningar')
) AS m(account_number, section) ON m.account_number = a.account_number
WHERE ac.account_id = a.id
  AND ac.section IS NULL
  AND c.org_number = '559126-0087';
