import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // Verify caller is authenticated
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  const { data: { user } } = await admin.auth.getUser(token ?? '')
  if (!user) return new Response('Unauthorized', { status: 401, headers: cors })

  // Verify caller is admin
  const { data: callerRoles } = await admin.from('user_roles').select('role').eq('user_id', user.id)
  if (!callerRoles?.some((r) => r.role === 'admin'))
    return new Response('Forbidden', { status: 403, headers: cors })

  const url = new URL(req.url)
  const segments = url.pathname.split('/').filter(Boolean)
  const last = segments[segments.length - 1]

  try {
    // GET /admin-users — list all users
    if (req.method === 'GET') {
      const { data: { users }, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
      if (error) throw error

      const ids = users.map((u) => u.id)
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        admin.from('user_profiles').select('user_id, display_name').in('user_id', ids),
        admin.from('user_roles').select('*').in('user_id', ids),
      ])

      const nameMap = new Map(profiles?.map((p) => [p.user_id, p.display_name]) ?? [])
      const rolesMap = new Map<string, typeof roles>()
      roles?.forEach((r) => {
        if (!rolesMap.has(r.user_id)) rolesMap.set(r.user_id, [])
        rolesMap.get(r.user_id)!.push(r)
      })

      return json(
        users.map((u) => ({
          id: u.id,
          email: u.email ?? '',
          display_name: nameMap.get(u.id) ?? u.email ?? '',
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at ?? null,
          roles: rolesMap.get(u.id) ?? [],
        })),
      )
    }

    // POST /admin-users/invite — invite user by email
    if (req.method === 'POST' && last === 'invite') {
      const { email } = await req.json()
      if (!email) return json({ error: 'email required' }, 400)
      const siteUrl = Deno.env.get('SITE_URL') ?? 'https://budget-tool-sage.vercel.app'
      const { error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${siteUrl}/dashboard`,
      })
      if (error) throw error
      return json({ ok: true })
    }

    // DELETE /admin-users/:userId — delete user
    if (req.method === 'DELETE' && last !== 'admin-users') {
      const { error } = await admin.auth.admin.deleteUser(last)
      if (error) throw error
      return json({ ok: true })
    }

    return new Response('Not Found', { status: 404, headers: cors })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
