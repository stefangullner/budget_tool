-- Run AFTER add_companies_martenssons_mda.sql, as its own snippet (the editor only shows the last result).
-- Expected: 4 rows (cost_centers / accounts):
--   Martenssons Trafikskola 47 / 143, Martenssons Utbildningar 14 / 82,
--   My Driving Academy Sweden 62 / 113, My Driving Academy Trafikskolor 53 / 116.
-- no_section = accounts that exist in none of companies 1-4, so they need a section set by hand.
SELECT c.name,
       (SELECT count(*) FROM cost_centers cc WHERE cc.company_id = c.id)                              AS cost_centers,
       (SELECT count(*) FROM cost_centers cc WHERE cc.company_id = c.id AND cc.region IS NULL)        AS cc_without_region,
       (SELECT count(*) FROM accounts a WHERE a.company_id = c.id)                                    AS accounts,
       (SELECT count(*) FROM accounts a JOIN account_configs ac ON ac.account_id = a.id
         WHERE a.company_id = c.id AND ac.section IS NULL)                                            AS no_section,
       (SELECT count(*) FROM accounts a JOIN account_configs ac ON ac.account_id = a.id
         WHERE a.company_id = c.id AND ac.is_budgetable)                                              AS budgetable
FROM companies c
WHERE c.org_number IN ('556935-6370', '556643-0913', '556943-1587', '559244-2734')
ORDER BY c.id;

-- Second snippet: the accounts that still need a section.
-- SELECT c.name, a.account_number, a.name
-- FROM accounts a JOIN companies c ON c.id = a.company_id JOIN account_configs ac ON ac.account_id = a.id
-- WHERE c.org_number IN ('556935-6370','556643-0913','556943-1587','559244-2734') AND ac.section IS NULL
-- ORDER BY c.id, a.account_number::int;
