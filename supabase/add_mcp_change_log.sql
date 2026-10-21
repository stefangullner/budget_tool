-- Change log for the MCP server's write tools.
--
-- Every write goes through two steps: a propose_* tool stores the exact change here and returns the
-- row id as a confirm token, and apply_change executes it. That gives the MCP client one small,
-- reviewable call to ask the user about, makes a token single-use (applied_at), and leaves an audit
-- trail of what was changed through MCP and why.
--
-- Only the service role (the Edge Function) touches this table: RLS is on and there are no
-- policies, and anon/authenticated are revoked outright. DDL only.

CREATE TABLE IF NOT EXISTS public.mcp_change_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL,   -- the signed-in user who made the proposal; only they can apply it
  kind        text        NOT NULL CHECK (kind IN ('budget_changes', 'comment_changes', 'lock_changes', 'create_scenarios')),
  summary     text        NOT NULL,
  payload     jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  applied_at  timestamptz,
  result      jsonb
);

-- Upgrade path: the first version of this table (shared-token MCP) had no user_id. Proposals made
-- before OAuth belong to nobody and are void, so they are removed before the column becomes NOT NULL.
ALTER TABLE public.mcp_change_log ADD COLUMN IF NOT EXISTS user_id uuid;
DELETE FROM public.mcp_change_log WHERE user_id IS NULL;
ALTER TABLE public.mcp_change_log ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.mcp_change_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mcp_change_log FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS mcp_change_log_created_at_idx ON public.mcp_change_log (created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_change_log_user_idx ON public.mcp_change_log (user_id, created_at DESC);
