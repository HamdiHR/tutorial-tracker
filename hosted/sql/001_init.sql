-- Tutorial Tracker v0.39 hosted schema (Supabase Postgres, "public" schema so the REST API exposes it by default).
-- The tutorial text ships with the app; the database only stores what each person does, keyed by
-- (ticket id, step key) and protected by row-level security (auth.uid()). Idempotent: safe to re-run.

-- ---------- people + invites ----------
CREATE TABLE IF NOT EXISTS tt_allowed_emails (      -- invite-only sign-up: only these emails may register
  email text PRIMARY KEY CHECK (email = lower(email)), role text NOT NULL DEFAULT 'member',
  invited_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tt_profiles (
  user_id uuid PRIMARY KEY, email text NOT NULL, role text NOT NULL DEFAULT 'member',   -- 'owner' | 'member'
  start_mode text,                                   -- NULL until the first-login question is answered: 'zero' | 'point'
  start_ticket text, marked_previous boolean, onboarded_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- per-user state ----------
CREATE TABLE IF NOT EXISTS tt_user_steps (
  user_id uuid NOT NULL, ticket_id text NOT NULL, step_key text NOT NULL,
  done boolean NOT NULL DEFAULT false, done_at timestamptz, note text NOT NULL DEFAULT '',
  title text, body text,                              -- the person's own edit (NULL = follow the shared text)
  PRIMARY KEY (user_id, ticket_id, step_key)
);
CREATE TABLE IF NOT EXISTS tt_user_tickets (
  user_id uuid NOT NULL, ticket_id text NOT NULL, status_override text, note text NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, ticket_id)
);
CREATE TABLE IF NOT EXISTS tt_drift (
  user_id uuid NOT NULL, ticket_id text NOT NULL, step_key text NOT NULL, hash text NOT NULL,
  state text NOT NULL DEFAULT 'open', note text NOT NULL DEFAULT '', PRIMARY KEY (user_id, ticket_id, step_key, hash)
);
CREATE TABLE IF NOT EXISTS tt_step_versions (
  id bigserial PRIMARY KEY, user_id uuid NOT NULL, ticket_id text NOT NULL, step_key text NOT NULL,
  ts timestamptz NOT NULL DEFAULT now(), title text NOT NULL, body text NOT NULL, label text NOT NULL DEFAULT 'edit'
);
CREATE INDEX IF NOT EXISTS tt_versions_user ON tt_step_versions(user_id, ticket_id, step_key, id);
CREATE TABLE IF NOT EXISTS tt_activity (
  id bigserial PRIMARY KEY, user_id uuid NOT NULL, ts timestamptz NOT NULL DEFAULT now(),
  type text NOT NULL, ticket_id text, step_key text, info text
);
CREATE INDEX IF NOT EXISTS tt_activity_user_ts ON tt_activity(user_id, ts);
CREATE TABLE IF NOT EXISTS tt_badges (
  user_id uuid NOT NULL, key text NOT NULL, family text NOT NULL, tier int NOT NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS tt_meta (                -- timeline plan, last position
  user_id uuid NOT NULL, key text NOT NULL, value text NOT NULL, PRIMARY KEY (user_id, key)
);

-- ---------- row-level security + grants ----------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['tt_user_steps','tt_user_tickets','tt_drift','tt_step_versions','tt_activity','tt_badges','tt_meta'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS own ON %I', t);
    EXECUTE format('CREATE POLICY own ON %I FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())', t);
    EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', t);
  END LOOP;
END $$;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
ALTER TABLE tt_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_read ON tt_profiles;
CREATE POLICY own_read ON tt_profiles FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON tt_profiles FROM anon, authenticated; GRANT SELECT ON tt_profiles TO authenticated;
ALTER TABLE tt_allowed_emails ENABLE ROW LEVEL SECURITY;     -- no policy and no grant: only the server (service role) touches it
REVOKE ALL ON tt_allowed_emails FROM anon, authenticated;

-- ---------- invite-only sign-up ----------
CREATE OR REPLACE FUNCTION tt_on_user_created() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r text;
BEGIN
  SELECT role INTO r FROM tt_allowed_emails WHERE email = lower(NEW.email);
  IF r IS NULL THEN RAISE EXCEPTION 'This email has not been invited.' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO tt_profiles (user_id, email, role) VALUES (NEW.id, lower(NEW.email), r) ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tt_on_user_created ON auth.users;
CREATE TRIGGER tt_on_user_created BEFORE INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION tt_on_user_created();

-- ---------- one round trip to read everything a request needs ----------
CREATE OR REPLACE FUNCTION tt_state(p_days int DEFAULT 400) RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'profile',  (SELECT to_jsonb(p) - 'user_id' FROM tt_profiles p WHERE p.user_id = auth.uid()),
    'steps',    COALESCE((SELECT jsonb_agg(jsonb_build_object('t',ticket_id,'k',step_key,'done',done,'done_at',done_at,'note',note,'title',title,'body',body)) FROM tt_user_steps WHERE user_id = auth.uid()), '[]'),
    'tickets',  COALESCE((SELECT jsonb_agg(jsonb_build_object('t',ticket_id,'ov',status_override,'note',note)) FROM tt_user_tickets WHERE user_id = auth.uid()), '[]'),
    'drift',    COALESCE((SELECT jsonb_agg(jsonb_build_object('t',ticket_id,'k',step_key,'h',hash,'state',state,'note',note)) FROM tt_drift WHERE user_id = auth.uid()), '[]'),
    'versions', COALESCE((SELECT jsonb_agg(jsonb_build_object('t',ticket_id,'k',step_key,'ts',ts,'title',title,'body',body,'label',label) ORDER BY id) FROM tt_step_versions WHERE user_id = auth.uid()), '[]'),
    'activity', COALESCE((SELECT jsonb_agg(jsonb_build_object('ts',ts,'type',type,'t',ticket_id,'k',step_key,'info',info) ORDER BY id) FROM tt_activity WHERE user_id = auth.uid() AND ts > now() - make_interval(days => p_days)), '[]'),
    'badges',   COALESCE((SELECT jsonb_agg(jsonb_build_object('key',key,'family',family,'tier',tier,'at',unlocked_at)) FROM tt_badges WHERE user_id = auth.uid()), '[]'),
    'meta',     COALESCE((SELECT jsonb_object_agg(key, value) FROM tt_meta WHERE user_id = auth.uid()), '{}')
  )
$$;

-- ---------- one round trip to save only what changed (atomic) ----------
-- p = { steps:{set:[{t,k,done,done_at,note,title,body}], del:[{t,k}]}, tickets:{set:[{t,ov,note}], del:[t]},
--       drift:{set:[{t,k,h,state,note}], del:[{t,k,h}]}, versions:[{t,k,ts,title,body,label}], activity:[{ts,type,t,k,info}],
--       badges:[{key,family,tier}], meta:{set:{key:value}, del:[key]}, prune_versions:[{t,k}] }
CREATE OR REPLACE FUNCTION tt_apply(p jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '28000'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p#>'{steps,set}','[]')) LOOP
    INSERT INTO tt_user_steps (user_id, ticket_id, step_key, done, done_at, note, title, body)
    VALUES (uid, r->>'t', r->>'k', COALESCE((r->>'done')::boolean,false), (r->>'done_at')::timestamptz, COALESCE(r->>'note',''), r->>'title', r->>'body')
    ON CONFLICT (user_id, ticket_id, step_key) DO UPDATE SET done = EXCLUDED.done, done_at = EXCLUDED.done_at, note = EXCLUDED.note, title = EXCLUDED.title, body = EXCLUDED.body;
  END LOOP;
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p#>'{steps,del}','[]')) LOOP
    DELETE FROM tt_user_steps WHERE user_id = uid AND ticket_id = r->>'t' AND step_key = r->>'k';
  END LOOP;
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p#>'{tickets,set}','[]')) LOOP
    INSERT INTO tt_user_tickets (user_id, ticket_id, status_override, note) VALUES (uid, r->>'t', r->>'ov', COALESCE(r->>'note',''))
    ON CONFLICT (user_id, ticket_id) DO UPDATE SET status_override = EXCLUDED.status_override, note = EXCLUDED.note;
  END LOOP;
  DELETE FROM tt_user_tickets WHERE user_id = uid AND ticket_id IN (SELECT jsonb_array_elements_text(COALESCE(p#>'{tickets,del}','[]')));
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p#>'{drift,set}','[]')) LOOP
    INSERT INTO tt_drift (user_id, ticket_id, step_key, hash, state, note) VALUES (uid, r->>'t', r->>'k', r->>'h', COALESCE(r->>'state','open'), COALESCE(r->>'note',''))
    ON CONFLICT (user_id, ticket_id, step_key, hash) DO UPDATE SET state = EXCLUDED.state, note = EXCLUDED.note;
  END LOOP;
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p#>'{drift,del}','[]')) LOOP
    DELETE FROM tt_drift WHERE user_id = uid AND ticket_id = r->>'t' AND step_key = r->>'k' AND hash = r->>'h';
  END LOOP;
  INSERT INTO tt_step_versions (user_id, ticket_id, step_key, ts, title, body, label)
    SELECT uid, v->>'t', v->>'k', COALESCE((v->>'ts')::timestamptz, now()), v->>'title', v->>'body', COALESCE(v->>'label','edit') FROM jsonb_array_elements(COALESCE(p->'versions','[]')) v;
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p->'prune_versions','[]')) LOOP   -- keep the newest 100 per step
    DELETE FROM tt_step_versions WHERE user_id = uid AND ticket_id = r->>'t' AND step_key = r->>'k'
      AND id NOT IN (SELECT id FROM tt_step_versions WHERE user_id = uid AND ticket_id = r->>'t' AND step_key = r->>'k' ORDER BY id DESC LIMIT 100);
  END LOOP;
  INSERT INTO tt_activity (user_id, ts, type, ticket_id, step_key, info)
    SELECT uid, COALESCE((a->>'ts')::timestamptz, now()), a->>'type', a->>'t', a->>'k', a->>'info' FROM jsonb_array_elements(COALESCE(p->'activity','[]')) a;
  INSERT INTO tt_badges (user_id, key, family, tier) SELECT uid, b->>'key', b->>'family', (b->>'tier')::int FROM jsonb_array_elements(COALESCE(p->'badges','[]')) b ON CONFLICT DO NOTHING;
  INSERT INTO tt_meta (user_id, key, value) SELECT uid, e.key, e.value FROM jsonb_each_text(COALESCE(p#>'{meta,set}','{}')) e
    ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value;
  DELETE FROM tt_meta WHERE user_id = uid AND key IN (SELECT jsonb_array_elements_text(COALESCE(p#>'{meta,del}','[]')));
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION tt_state(int), tt_apply(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tt_state(int), tt_apply(jsonb) TO authenticated;
