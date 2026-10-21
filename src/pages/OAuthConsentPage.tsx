import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

/**
 * Consent screen for the OAuth 2.1 server in Supabase Auth.
 *
 * An MCP client (Claude Code, Claude.ai ...) sends the user here with an `authorization_id`. The user is
 * already signed in — App.tsx shows the login page first and keeps this URL — and decides whether the
 * client may act as them. Supabase issues the tokens after `approveAuthorization`; the MCP function
 * then runs every request as this user, so row level security and section permissions apply as usual.
 *
 * The OAuth methods are called through a cast: they only exist in recent supabase-js versions, and a
 * missing typing must not break the build that deploys this page.
 */

type AuthorizationDetails = {
  authorization_id?: string
  redirect_url?: string
  redirect_uri?: string
  client?: { name?: string; uri?: string }
  scope?: string
}

type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>
  approveAuthorization: (id: string) => Promise<{ data: { redirect_url: string } | null; error: { message: string } | null }>
  denyAuthorization: (id: string) => Promise<{ data: { redirect_url: string } | null; error: { message: string } | null }>
}

const SCOPE_LABELS: Record<string, string> = {
  openid: 'Din identitet (inloggning)',
  email: 'Din e-postadress',
  profile: 'Ditt namn',
  phone: 'Ditt telefonnummer',
}

export default function OAuthConsentPage() {
  const [searchParams] = useSearchParams()
  const authorizationId = searchParams.get('authorization_id')

  const [details, setDetails] = useState<AuthorizationDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const oauth = (supabase.auth as unknown as { oauth?: OAuthApi }).oauth

  useEffect(() => {
    async function load() {
      if (!authorizationId) {
        setError('Begäran saknar authorization_id.')
        setLoading(false)
        return
      }
      if (!oauth) {
        setError('Den installerade versionen av Supabase-klienten saknar stöd för OAuth. Uppdatera @supabase/supabase-js.')
        setLoading(false)
        return
      }

      const { data, error: detailsError } = await oauth.getAuthorizationDetails(authorizationId)
      if (detailsError || !data) {
        setError(detailsError?.message ?? 'Ogiltig eller utgången begäran.')
        setLoading(false)
        return
      }

      // The user has already approved this client before: Supabase hands back the redirect directly.
      if (!data.authorization_id && data.redirect_url) {
        window.location.href = data.redirect_url
        return
      }

      setDetails(data)
      setLoading(false)
    }
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorizationId])

  async function decide(approve: boolean) {
    if (!authorizationId || !oauth) return
    setBusy(true)
    setError(null)
    const { data, error: decisionError } = approve
      ? await oauth.approveAuthorization(authorizationId)
      : await oauth.denyAuthorization(authorizationId)
    if (decisionError || !data) {
      setError(decisionError?.message ?? 'Beslutet kunde inte registreras.')
      setBusy(false)
      return
    }
    window.location.href = data.redirect_url
  }

  const scopes = (details?.scope ?? '').split(' ').filter(Boolean)

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-gray-900">On Via</h1>
          <p className="mt-1 text-sm text-gray-500">Budget & Prognos</p>
        </div>

        {loading && (
          <div className="flex justify-center py-6">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {!loading && details && (
          <>
            <h2 className="text-lg font-medium text-gray-900">
              Ge {details.client?.name ?? 'ett program'} åtkomst?
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              Programmet kommer åt budgetverktyget <strong>som du</strong>. Det ser samma bolag,
              kostnadsställen och sektioner som du gör i appen, och ändringar sparas i ditt namn.
            </p>

            <ul className="mt-4 space-y-2 text-sm text-gray-700">
              <li className="flex gap-2">
                <span className="text-green-600">✓</span>
                <span>Läsa budget, utfall, kommentarer och internhandel du har behörighet till</span>
              </li>
              <li className="flex gap-2">
                <span className="text-green-600">✓</span>
                <span>Föreslå ändringar. <strong>Inget sparas</strong> förrän du själv godkänner det i programmet.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-red-600">✗</span>
                <span>Det kan aldrig skriva i godkända scenarier eller låsta kostnadsställen</span>
              </li>
            </ul>

            <dl className="mt-5 rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 text-xs text-gray-600 space-y-1">
              <div className="flex justify-between gap-4">
                <dt className="font-medium">Program</dt>
                <dd className="text-right break-all">{details.client?.name ?? 'Okänt'}</dd>
              </div>
              {details.redirect_uri && (
                <div className="flex justify-between gap-4">
                  <dt className="font-medium">Skickar dig tillbaka till</dt>
                  <dd className="text-right break-all">{details.redirect_uri}</dd>
                </div>
              )}
              {scopes.length > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="font-medium">Begärda rättigheter</dt>
                  <dd className="text-right">{scopes.map((s) => SCOPE_LABELS[s] ?? s).join(', ')}</dd>
                </div>
              )}
            </dl>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => void decide(false)}
                disabled={busy}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Neka
              </button>
              <button
                onClick={() => void decide(true)}
                disabled={busy}
                className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
              >
                {busy ? 'Vänta...' : 'Godkänn'}
              </button>
            </div>
            <p className="mt-4 text-xs text-gray-400 text-center">
              Godkänn bara om du själv startade kopplingen. Du kan stänga av den senare genom att logga ut överallt.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
