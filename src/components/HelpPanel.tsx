import { useEffect, useRef } from 'react'
import { X, ChevronRight } from 'lucide-react'
import { useHelp, HelpSection } from '@/context/HelpContext'
import { cn } from '@/lib/utils'

const sections: { id: HelpSection; label: string }[] = [
  { id: 'dashboard',           label: 'Översikt' },
  { id: 'budget',              label: 'Budget' },
  { id: 'budget-matrix',       label: '↳ Budgetmatris' },
  { id: 'budget-overview',     label: '↳ KS-översikt' },
  { id: 'accounts',            label: 'Konton' },
  { id: 'intercompany',        label: 'Intercompany' },
  { id: 'admin-users',         label: 'Admin / Användare' },
  { id: 'admin-scenarios',     label: 'Admin / Scenarier' },
  { id: 'admin-cost-centers',  label: 'Admin / Kostnadsställen' },
  { id: 'admin-deadlines',     label: 'Admin / Deadlines' },
  { id: 'admin-sync',          label: 'Admin / Synkronisering' },
  { id: 'admin-export',        label: 'Admin / Export' },
]

export default function HelpPanel() {
  const { isOpen, section, closeHelp, openHelp } = useHelp()
  const panelRef = useRef<HTMLDivElement>(null)

  // Scroll to section when panel opens or section changes
  useEffect(() => {
    if (!isOpen || !section) return
    const el = document.getElementById(`help-${section}`)
    if (el) {
      setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    }
  }, [isOpen, section])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeHelp() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [closeHelp])

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={closeHelp}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed top-0 right-0 h-full w-[480px] max-w-full bg-white shadow-2xl z-50 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Användarmanual</h2>
          <button
            onClick={closeHelp}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Table of contents */}
          <nav className="w-44 shrink-0 border-r border-gray-100 overflow-y-auto py-3">
            {sections.map(s => (
              <button
                key={s.id}
                onClick={() => openHelp(s.id)}
                className={cn(
                  'w-full text-left px-4 py-1.5 text-xs transition-colors',
                  s.id === section
                    ? 'text-brand-700 font-medium bg-brand-50'
                    : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50',
                  s.label.startsWith('↳') ? 'pl-6' : ''
                )}
              >
                {s.label.replace('↳ ', '')}
                {s.label.startsWith('↳') && (
                  <span className="text-gray-300 mr-1">↳ </span>
                )}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5 text-sm text-gray-700 space-y-10">

            {/* ── ÖVERSIKT ── */}
            <section id="help-dashboard">
              <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <ChevronRight size={14} className="text-brand-500" /> Översikt
              </h3>
              <p className="text-gray-500 mb-3">
                Översiktssidan kommer att visa budget mot utfall per bolag — avvikelser i kronor och procent, och trafikljusstatus per kostnadsställe.
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-amber-700 text-xs">
                Denna vy är under uppbyggnad och aktiveras när utfallsdata från Fabric är på plats.
              </div>
            </section>

            {/* ── BUDGET ── */}
            <section id="help-budget">
              <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <ChevronRight size={14} className="text-brand-500" /> Budget
              </h3>
              <p className="mb-3">
                Budgetsidan är huvudarbetsytan för att mata in budget per konto och kostnadsställe.
              </p>
              <h4 className="font-medium text-gray-800 mb-1.5">Så här börjar du</h4>
              <ol className="list-decimal list-inside space-y-1.5 text-gray-600 mb-4">
                <li>Välj <strong>bolag</strong> med bolagsflikarna längst upp.</li>
                <li>Välj ett <strong>scenario</strong> i rullgardinsmenyn (t.ex. "Budget 2026").</li>
                <li>Välj ett <strong>kostnadsställe</strong> (KS) i listan till vänster.</li>
                <li>Fyll i belopp i <strong>Matrisvyn</strong> eller se sammanfattning i <strong>KS-översikten</strong>.</li>
              </ol>
              <h4 className="font-medium text-gray-800 mb-1.5">Deadline-banner</h4>
              <p className="text-gray-600 mb-4">
                Om ett scenario har en deadline och det är 14 dagar eller färre kvar visas en gul banner längst upp. Är deadline passerad visas den i rött.
              </p>
              <h4 className="font-medium text-gray-800 mb-1.5">Visa/dölj avvikelser</h4>
              <p className="text-gray-600">
                Knappen <strong>Avvikelser</strong> i matrisvyn markerar celler som avviker från föregående års utfall med mer än 20 %.
              </p>
            </section>

            {/* ── BUDGETMATRIS ── */}
            <section id="help-budget-matrix">
              <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <ChevronRight size={14} className="text-brand-500" /> Budgetmatris
              </h3>
              <p className="mb-3">
                Matrisen visar konton som rader och månader som kolumner. Belopp sparas automatiskt när du lämnar en cell.
              </p>

              <h4 className="font-medium text-gray-800 mb-1.5">Tangentbordsnavigation</h4>
              <div className="overflow-hidden rounded-lg border border-gray-200 mb-4">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Tangent</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Funktion</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    <tr><td className="px-3 py-1.5 font-mono">Tab / →</td><td className="px-3 py-1.5 text-gray-600">Nästa månad</td></tr>
                    <tr><td className="px-3 py-1.5 font-mono">Shift+Tab / ←</td><td className="px-3 py-1.5 text-gray-600">Föregående månad</td></tr>
                    <tr><td className="px-3 py-1.5 font-mono">Enter / ↓</td><td className="px-3 py-1.5 text-gray-600">Nästa konto</td></tr>
                    <tr><td className="px-3 py-1.5 font-mono">↑</td><td className="px-3 py-1.5 text-gray-600">Föregående konto</td></tr>
                    <tr><td className="px-3 py-1.5 font-mono">Escape</td><td className="px-3 py-1.5 text-gray-600">Avbryt redigering</td></tr>
                  </tbody>
                </table>
              </div>

              <h4 className="font-medium text-gray-800 mb-1.5">Rad-verktyg</h4>
              <p className="text-gray-600 mb-2">
                Hovra över ett kontonamn för att se tre verktyg till höger om raden:
              </p>
              <ul className="space-y-2 text-gray-600 mb-4">
                <li><strong>Fördela</strong> — Ange ett årsbelopp som fördelas jämnt eller viktat över årets månader.</li>
                <li><strong>Kopiera</strong> — Kopiera beloppen från ett annat KS eller scenario till denna rad.</li>
                <li><strong>Procent</strong> — Öka eller minska alla månader med en procentsats.</li>
              </ul>

              <h4 className="font-medium text-gray-800 mb-1.5">Kommentarer</h4>
              <p className="text-gray-600 mb-4">
                Klicka på pratbubblan till höger om kontonamnet för att lägga till en kommentar på raden. Kommentarer sparas per konto och kostnadsställe.
              </p>

              <h4 className="font-medium text-gray-800 mb-1.5">Lås kostnadsställe</h4>
              <p className="text-gray-600">
                När ett KS är klart kan du klicka på <strong>Lås KS</strong>-knappen. Låsta KS går inte att redigera förrän de låses upp. Administratörer kan alltid låsa upp.
              </p>
            </section>

            {/* ── KS-ÖVERSIKT ── */}
            <section id="help-budget-overview">
              <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <ChevronRight size={14} className="text-brand-500" /> KS-översikt
              </h3>
              <p className="mb-3">
                KS-översikten visar alla kostnadsställen för valt scenario i en sammanfattning. Du ser direkt vilka KS som är klara och vilka som saknar budget.
              </p>
              <ul className="space-y-1.5 text-gray-600 mb-3">
                <li><strong>✓</strong> — KS är klart (alla budgeterbara konton har värden).</li>
                <li><strong>—</strong> — KS saknar budget för detta konto.</li>
                <li><strong>X av Y KS klara</strong> — sammanräkning längst upp.</li>
              </ul>
              <p className="text-gray-600">
                Klicka på ett KS för att hoppa direkt till matrisvyn för det kostnadsdellet.
              </p>
            </section>

            {/* ── KONTON ── */}
            <section id="help-accounts">
              <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <ChevronRight size={14} className="text-brand-500" /> Konton
              </h3>
              <p className="mb-3">
                Kontosidan styr vilka konton som syns i budgetmatrisen och hur de är organiserade.
              </p>

              <h4 className="font-medium text-gray-800 mb-1.5">Aktivera konton för budgetering</h4>
              <p className="text-gray-600 mb-4">
                Slå på <strong>Budgeterbar</strong>-reglaget för de konton du vill ska dyka upp i budgetmatrisen. Konton som inte är aktiverade syns inte i budgeten.
                Du kan använda <strong>Aktivera alla i sektionen</strong> för att slå på hela grupper på en gång.
              </p>

              <h4 className="font-medium text-gray-800 mb-1.5">Sektioner</h4>
              <p className="text-gray-600 mb-4">
                Konton grupperas i sektioner (t.ex. "Personalkostnader", "Lokalkostnader"). Sektionsnamnet sätts per konto under kontoinställningarna och används för gruppering i budgetmatrisen.
              </p>

              <h4 className="font-medium text-gray-800 mb-1.5">Intercompany-konton (IC)</h4>
              <p className="text-gray-600">
                Konton som används för transaktioner mellan bolagen markeras med den lila <strong>IC-knappen</strong>. Dessa konton visas sedan i Intercompany-vyn för avstämning. Nettot mellan bolagen ska vara noll.
              </p>
            </section>

            {/* ── INTERCOMPANY ── */}
            <section id="help-intercompany">
              <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <ChevronRight size={14} className="text-brand-500" /> Intercompany-avstämning
              </h3>
              <p className="mb-3">
                Intercompany-vyn visar budgeterade belopp för konton markerade som IC, per bolag. Nettot för varje konto ska vara noll — annars är koncernens totaler felaktiga.
              </p>

              <h4 className="font-medium text-gray-800 mb-1.5">Scenario-matchning</h4>
              <p className="text-gray-600 mb-4">
                Välj ett scenario i rullgardinsmenyn. Scenariot matchas på <em>namn</em> över alla bolag — dvs. om du väljer "Budget 2026" visas summan av alla bolag som har ett scenario med det namnet.
              </p>

              <h4 className="font-medium text-gray-800 mb-1.5">Status</h4>
              <ul className="space-y-1.5 text-gray-600 mb-3">
                <li><strong>✅ Grön</strong> — kontot är i balans (netto = 0).</li>
                <li><strong>⚠️ Gul</strong> — kontot har en avvikelse som behöver korrigeras.</li>
              </ul>
              <p className="text-gray-600">
                Filtret <strong>Bara avvikelser</strong> döljer balanserade konton så att du snabbt ser vad som behöver åtgärdas.
              </p>
            </section>

            {/* ── ADMIN: ANVÄNDARE ── */}
            <section id="help-admin-users">
              <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <ChevronRight size={14} className="text-brand-500" /> Admin / Användare
              </h3>
              <p className="mb-3">
                Administrera vilka som har tillgång till systemet och vilka behörigheter de har.
              </p>

              <h4 className="font-medium text-gray-800 mb-1.5">Bjuda in en ny användare</h4>
              <ol className="list-decimal list-inside space-y-1.5 text-gray-600 mb-4">
                <li>Klicka på <strong>Bjud in</strong> uppe till höger.</li>
                <li>Ange användarens e-postadress.</li>
                <li>Användaren får ett e-postmeddelande med en länk.</li>
                <li>När användaren klickar på länken uppmanas de att sätta ett lösenord.</li>
              </ol>

              <h4 className="font-medium text-gray-800 mb-1.5">Roller</h4>
              <div className="overflow-hidden rounded-lg border border-gray-200 mb-4">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Roll</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Behörighet</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    <tr>
                      <td className="px-3 py-1.5 font-medium">Admin</td>
                      <td className="px-3 py-1.5 text-gray-600">Full åtkomst — alla bolag, alla KS, administration</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-1.5 font-medium">Bolagsansvarig</td>
                      <td className="px-3 py-1.5 text-gray-600">Budgetera alla KS för sitt bolag</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-1.5 font-medium">KS-ansvarig</td>
                      <td className="px-3 py-1.5 text-gray-600">Budgetera sitt/sina kostnadsställen</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h4 className="font-medium text-gray-800 mb-1.5">Ta bort användare</h4>
              <p className="text-gray-600">
                Klicka på papperskorgen bredvid en användare. Åtgärden är omedelbar och kan inte ångras.
              </p>
            </section>

            {/* ── ADMIN: SCENARIER ── */}
            <section id="help-admin-scenarios">
              <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <ChevronRight size={14} className="text-brand-500" /> Admin / Scenarier
              </h3>
              <p className="mb-3">
                Scenarier är budgetperioder (t.ex. "Budget 2026" eller "Prognos Q3"). Varje scenario kopplas till ett bolag och har en start- och slutmånad.
              </p>

              <h4 className="font-medium text-gray-800 mb-1.5">Skapa scenario</h4>
              <ol className="list-decimal list-inside space-y-1.5 text-gray-600 mb-4">
                <li>Klicka <strong>Nytt scenario</strong>.</li>
                <li>Välj bolag, period och namn.</li>
                <li>Välj om scenariot ska kopieras från ett befintligt (t.ex. förra årets budget).</li>
              </ol>

              <h4 className="font-medium text-gray-800 mb-1.5">Godkänn scenario</h4>
              <p className="text-gray-600 mb-4">
                Markera ett scenario som godkänt när budgetarbetet är klart. Godkända scenarier är skrivskyddade.
              </p>

              <h4 className="font-medium text-gray-800 mb-1.5">Låsstatistik</h4>
              <p className="text-gray-600">
                I listan visas hur många kostnadsställen som har låsts för varje scenario — ett snabbt sätt att se hur långt budgetarbetet kommit.
              </p>
            </section>

            {/* ── ADMIN: KOSTNADSSTÄLLEN ── */}
            <section id="help-admin-cost-centers">
              <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <ChevronRight size={14} className="text-brand-500" /> Admin / Kostnadsställen
              </h3>
              <p className="mb-3">
                Kostnadsställen (KS) synkas automatiskt från Fortnox via Fabric. Här kan du aktivera eller inaktivera enskilda KS för budgetarbetet.
              </p>
              <p className="text-gray-600">
                Inaktiva KS syns inte i budgetvyn men bevaras i databasen. Reaktivering återställer eventuellt sparad budget.
              </p>
            </section>

            {/* ── ADMIN: DEADLINES ── */}
            <section id="help-admin-deadlines">
              <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <ChevronRight size={14} className="text-brand-500" /> Admin / Deadlines
              </h3>
              <p className="mb-3">
                Sätt en deadline per scenario. Deadlinen visas som en banner i budgetvyn för alla användare som arbetar med scenariot.
              </p>
              <ul className="space-y-1.5 text-gray-600">
                <li><strong>Gul banner</strong> — deadline om 14 dagar eller färre.</li>
                <li><strong>Röd banner</strong> — deadline har passerats.</li>
              </ul>
            </section>

            {/* ── ADMIN: SYNKRONISERING ── */}
            <section id="help-admin-sync">
              <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <ChevronRight size={14} className="text-brand-500" /> Admin / Synkronisering
              </h3>
              <p className="mb-3">
                Konton och kostnadsställen hämtas från Fortnox via Fabric. Synkroniseringen körs automatiskt varje natt men kan också triggas manuellt.
              </p>

              <h4 className="font-medium text-gray-800 mb-1.5">Manuell synk</h4>
              <ol className="list-decimal list-inside space-y-1.5 text-gray-600 mb-4">
                <li>Klicka <strong>Synka konton nu</strong>.</li>
                <li>Fabric-notebooken startar — den kan ta 1–3 minuter.</li>
                <li>Nya konton dyker upp under <em>Konton</em> när synken är klar.</li>
              </ol>

              <h4 className="font-medium text-gray-800 mb-1.5">Synklogg</h4>
              <p className="text-gray-600">
                Tabellen visar historiken över körda synkar — tidpunkt, vem som triggade och status (lyckad/fel).
              </p>
            </section>

            {/* ── ADMIN: EXPORT ── */}
            <section id="help-admin-export">
              <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <ChevronRight size={14} className="text-brand-500" /> Admin / Export
              </h3>
              <p className="mb-3">
                Exportera ett scenario som CSV-fil direkt till Microsoft Fabric (Lakehouse Bronze). Filen läggs i mappen <code className="bg-gray-100 px-1 rounded">lh_bronze/Files/forecasts/</code> och kan sedan bearbetas vidare i Fabric.
              </p>

              <h4 className="font-medium text-gray-800 mb-1.5">Exportera</h4>
              <ol className="list-decimal list-inside space-y-1.5 text-gray-600 mb-4">
                <li>Välj bolag och scenario i rullgardinsmenyerna.</li>
                <li>Klicka <strong>Exportera till Fabric</strong>.</li>
                <li>Filen namnges automatiskt: <code className="bg-gray-100 px-1 rounded">scenarionamn_datum.csv</code>.</li>
              </ol>

              <h4 className="font-medium text-gray-800 mb-1.5">Exporthistorik</h4>
              <p className="text-gray-600">
                Tabellen visar alla tidigare exporter med datum, antal rader och vem som exporterade.
              </p>
            </section>

          </div>
        </div>
      </div>
    </>
  )
}
