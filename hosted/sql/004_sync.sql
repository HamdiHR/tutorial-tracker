-- Tutorial Tracker v0.40 phase 4 (database part): safe-to-repeat saves for offline sync. Idempotent: safe to re-run.
-- Nothing here changes what the app does today: tt_apply and tt_state are untouched; the new pieces are used by the sync client later.

-- ---------- operations already applied (so a retried upload never duplicates anything) ----------
CREATE TABLE IF NOT EXISTS tt_ops (
  user_id uuid NOT NULL, op_id uuid NOT NULL, applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, op_id)
);
CREATE INDEX IF NOT EXISTS tt_ops_applied ON tt_ops(applied_at);
ALTER TABLE tt_ops ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own ON tt_ops;
CREATE POLICY own ON tt_ops FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
REVOKE ALL ON tt_ops FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON tt_ops TO authenticated;

-- ---------- when each row last changed (lets the client detect two devices editing the same thing) ----------
ALTER TABLE tt_user_steps   ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE tt_user_tickets ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE tt_meta         ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE OR REPLACE FUNCTION tt_touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['tt_user_steps','tt_user_tickets','tt_meta'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tt_touch ON %I', t);
    EXECUTE format('CREATE TRIGGER tt_touch BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION tt_touch()', t);
  END LOOP;
END $$;

-- ---------- tt_apply_v2: tt_apply, but each operation id is applied at most once ----------
-- Returns { ok, applied, server_time }: applied=false means "this operation was already saved earlier" (nothing changed now).
-- server_time lets the device correct its clock. The check and the save happen in one transaction.
CREATE OR REPLACE FUNCTION tt_apply_v2(p jsonb, p_op uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); n int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '28000'; END IF;
  IF p_op IS NULL THEN RAISE EXCEPTION 'Missing operation id.' USING ERRCODE = '22023'; END IF;
  INSERT INTO tt_ops (user_id, op_id) VALUES (uid, p_op) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN jsonb_build_object('ok', true, 'applied', false, 'server_time', now()); END IF;
  PERFORM tt_apply(p);
  DELETE FROM tt_ops WHERE user_id = uid AND applied_at < now() - interval '30 days';   -- housekeeping
  RETURN jsonb_build_object('ok', true, 'applied', true, 'server_time', now());
END $$;
REVOKE ALL ON FUNCTION tt_apply_v2(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tt_apply_v2(jsonb, uuid) TO authenticated;

-- ---------- tt_state with "last changed" times on steps and tickets (conflict detection). Same as 001 plus the 'ua' keys; extra keys are ignored by older code. ----------
CREATE OR REPLACE FUNCTION tt_state(p_days int DEFAULT 400) RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'profile',  (SELECT to_jsonb(p) - 'user_id' FROM tt_profiles p WHERE p.user_id = auth.uid()),
    'steps',    COALESCE((SELECT jsonb_agg(jsonb_build_object('t',ticket_id,'k',step_key,'done',done,'done_at',done_at,'note',note,'title',title,'body',body,'ua',updated_at)) FROM tt_user_steps WHERE user_id = auth.uid()), '[]'),
    'tickets',  COALESCE((SELECT jsonb_agg(jsonb_build_object('t',ticket_id,'ov',status_override,'note',note,'ua',updated_at)) FROM tt_user_tickets WHERE user_id = auth.uid()), '[]'),
    'drift',    COALESCE((SELECT jsonb_agg(jsonb_build_object('t',ticket_id,'k',step_key,'h',hash,'state',state,'note',note)) FROM tt_drift WHERE user_id = auth.uid()), '[]'),
    'versions', COALESCE((SELECT jsonb_agg(jsonb_build_object('t',ticket_id,'k',step_key,'ts',ts,'title',title,'body',body,'label',label) ORDER BY id) FROM tt_step_versions WHERE user_id = auth.uid()), '[]'),
    'activity', COALESCE((SELECT jsonb_agg(jsonb_build_object('ts',ts,'type',type,'t',ticket_id,'k',step_key,'info',info) ORDER BY id) FROM tt_activity WHERE user_id = auth.uid() AND ts > now() - make_interval(days => p_days)), '[]'),
    'badges',   COALESCE((SELECT jsonb_agg(jsonb_build_object('key',key,'family',family,'tier',tier,'at',unlocked_at)) FROM tt_badges WHERE user_id = auth.uid()), '[]'),
    'meta',     COALESCE((SELECT jsonb_object_agg(key, value) FROM tt_meta WHERE user_id = auth.uid()), '{}')
  )
$$;
REVOKE ALL ON FUNCTION tt_state(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tt_state(int) TO authenticated;
