-- Sets section on the accounts of the four new companies that had no section after
-- add_companies_martenssons_mda.sql (no matching account number in companies 1-4).
--
-- Only touches rows where section IS NULL, so it is safe to re-run and never overwrites
-- a section that was copied from the existing companies or set by hand.
--
-- Left WITHOUT a section on purpose: 3000 "Nollning saldo" (zeroing account, not budgetable).
--
-- Judgement calls worth a second look (marked ? below): 4001 (Utbildningar), 4095, 4120/4122, 5941.

UPDATE account_configs ac
SET section = m.section
FROM accounts a
JOIN companies c ON c.id = a.company_id
JOIN (VALUES
  -- Extern omsättning
  (NULL,          '3056', 'Extern omsättning'),
  (NULL,          '3543', 'Extern omsättning'),
  (NULL,          '3620', 'Extern omsättning'),
  (NULL,          '3621', 'Extern omsättning'),
  -- Intern omsättning (koncernvidarefakturering)
  (NULL,          '3561', 'Intern omsättning'),
  (NULL,          '3564', 'Intern omsättning'),
  -- Övriga intäkter
  (NULL,          '3901', 'Övriga intäkter'),
  (NULL,          '3902', 'Övriga intäkter'),
  (NULL,          '3976', 'Övriga intäkter'),
  (NULL,          '3998', 'Övriga intäkter'),
  -- Fordonskostnader
  (NULL,          '4070', 'Fordonskostnader'),
  (NULL,          '4091', 'Fordonskostnader'),
  (NULL,          '4093', 'Fordonskostnader'),
  (NULL,          '4094', 'Fordonskostnader'),
  (NULL,          '4096', 'Fordonskostnader'),
  (NULL,          '4097', 'Fordonskostnader'),
  (NULL,          '4098', 'Fordonskostnader'),
  (NULL,          '5820', 'Fordonskostnader'),
  -- Fordonsleasing
  (NULL,          '4089', 'Fordonsleasing'),
  (NULL,          '4092', 'Fordonsleasing'),
  -- Utbildningsmaterial
  (NULL,          '4000', 'Utbildningsmaterial'),
  -- Halkbana (Trafikskola's 4001 is "Halkbana & Banhyra")
  ('556935-6370', '4001', 'Halkbana'),
  -- ? Utbildningar's 4001 is "Inköp utbildning" (bought-in training), 4002 is the intra-group version
  ('556643-0913', '4001', 'Övriga direkta kostnader'),
  (NULL,          '4002', 'Interna övriga direkta kostnader'),
  (NULL,          '4560', 'Övriga direkta kostnader'),
  (NULL,          '4629', 'Övriga direkta kostnader'),
  -- ? food for course participants - not Skolmåltider, which looks gymnasium-specific
  (NULL,          '4120', 'Övriga direkta kostnader'),
  (NULL,          '4122', 'Övriga direkta kostnader'),
  -- Lokalkostnader
  (NULL,          '5031', 'Lokalkostnader'),
  (NULL,          '5037', 'Lokalkostnader'),
  (NULL,          '5130', 'Lokalkostnader'),
  -- Marknadsföringskostnader
  (NULL,          '5902', 'Marknadsföringskostnader'),
  (NULL,          '5903', 'Marknadsföringskostnader'),
  -- IT kostnader (? 4095 aSTRa licence fees)
  (NULL,          '4095', 'IT kostnader'),
  (NULL,          '6231', 'IT kostnader'),
  -- Övriga omkostnader
  (NULL,          '5580', 'Övriga omkostnader'),
  (NULL,          '5790', 'Övriga omkostnader'),
  (NULL,          '5941', 'Övriga omkostnader'),   -- ? could be Marknadsföringskostnader
  (NULL,          '6042', 'Övriga omkostnader'),
  (NULL,          '6410', 'Övriga omkostnader'),
  (NULL,          '6561', 'Övriga omkostnader'),
  -- Avskrivningar / Goodwill
  (NULL,          '7810', 'Avskrivningar'),
  (NULL,          '7811', 'Avskrivningar'),
  (NULL,          '7814', 'Avskrivningar'),
  (NULL,          '7818', 'Goodwill'),
  -- Finansiella poster
  (NULL,          '8360', 'Ränteintäkter/räntekostnader och övr finansiella poster')
) AS m(org, account_number, section)
  ON m.account_number = a.account_number
 AND (m.org IS NULL OR m.org = c.org_number)
WHERE ac.account_id = a.id
  AND ac.section IS NULL
  AND c.org_number IN ('556935-6370', '556643-0913', '556943-1587', '559244-2734')
  -- a company-specific row wins over a generic one for the same account
  AND NOT (m.org IS NULL AND EXISTS (
        SELECT 1 FROM (VALUES ('556643-0913', '4001'), ('556935-6370', '4001')) s(o, n)
        WHERE s.o = c.org_number AND s.n = a.account_number));
