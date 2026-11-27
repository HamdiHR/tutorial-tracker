DO $$ BEGIN BEGIN INSERT INTO auth.users(email) VALUES ('stranger@x.com'); RAISE EXCEPTION 'SHOULD FAIL'; EXCEPTION WHEN SQLSTATE 'P0001' THEN RAISE NOTICE 'PASS uninvited email rejected'; END; END $$;
INSERT INTO tt_allowed_emails VALUES ('b@x.com','member');
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-000000000001','HamdiIrahal@gmail.com'),('00000000-0000-0000-0000-000000000002','b@x.com');
SELECT 'profiles', email, role FROM tt_profiles ORDER BY 2;
SET ROLE authenticated; SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
SELECT tt_apply('{"steps":{"set":[{"t":"S1-T01","k":"a","done":true,"done_at":"2026-11-21T10:00:00Z","note":"hi"},{"t":"S1-T01","k":"b","done":true}]},"tickets":{"set":[{"t":"S1-T01","ov":"doing","note":""}]},"meta":{"set":{"plan":"{}"}},"activity":[{"type":"done","t":"S1-T01","k":"a"}],"badges":[{"key":"b1","family":"f","tier":1}],"versions":[{"t":"S1-T01","k":"a","title":"x","body":"y"}],"drift":{"set":[{"t":"S1-T01","k":"a","h":"abc","state":"fixed","note":"n"}]}}') AS applied;
SELECT 'user1 state', jsonb_array_length(s->'steps') steps, jsonb_array_length(s->'tickets') tickets, jsonb_array_length(s->'activity') acts, jsonb_array_length(s->'versions') vers, jsonb_array_length(s->'badges') badges, s->'meta' meta, s->'profile'->>'role' role FROM (SELECT tt_state() s) x;
SELECT tt_apply('{"steps":{"del":[{"t":"S1-T01","k":"b"}]},"tickets":{"del":["S1-T01"]},"meta":{"del":["plan"]},"drift":{"del":[{"t":"S1-T01","k":"a","h":"abc"}]}}') AS deleted;
SELECT 'user1 after delete', jsonb_array_length(s->'steps') steps, jsonb_array_length(s->'tickets') tickets, jsonb_array_length(s->'drift') drift, s->'meta' meta FROM (SELECT tt_state() s) x;
RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
SELECT tt_apply('{"meta":{"set":{"tk:S1-T01":"{\"p\":2}"}}}');
INSERT INTO storage.objects(bucket_id, name) VALUES ('task-files', '00000000-0000-0000-0000-000000000001/S1-T01/f1');
SELECT 'tk meta persisted', tt_state()->'meta'->>'tk:S1-T01' AS v;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
DO $$ BEGIN BEGIN INSERT INTO storage.objects(bucket_id, name) VALUES ('task-files', '00000000-0000-0000-0000-000000000001/S1-T01/evil'); RAISE EXCEPTION 'SHOULD FAIL'; EXCEPTION WHEN insufficient_privilege OR check_violation THEN RAISE NOTICE 'PASS cannot upload into another folder'; END; END $$;
DO $$ BEGIN IF (SELECT count(*) FROM storage.objects) = 0 THEN RAISE NOTICE 'PASS cannot see another users files'; ELSE RAISE EXCEPTION 'SHOULD FAIL'; END IF; END $$;
SELECT 'user2 sees user1 rows?', jsonb_array_length(tt_state()->'steps') AS steps, tt_state()->'profile'->>'email' AS own_profile;
DO $$ BEGIN BEGIN INSERT INTO tt_user_steps(user_id,ticket_id,step_key) VALUES ('00000000-0000-0000-0000-000000000001','S1','a'); RAISE EXCEPTION 'SHOULD FAIL'; EXCEPTION WHEN insufficient_privilege OR check_violation THEN RAISE NOTICE 'PASS cross-user write blocked'; END; END $$;
DO $$ BEGIN BEGIN PERFORM 1 FROM tt_allowed_emails; RAISE EXCEPTION 'SHOULD FAIL'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS allowed_emails not readable'; END; END $$;
DO $$ BEGIN BEGIN UPDATE tt_profiles SET role='owner'; RAISE EXCEPTION 'SHOULD FAIL'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS no self-promotion'; END; END $$;
RESET ROLE; SET ROLE anon;
DO $$ BEGIN BEGIN PERFORM tt_state(); RAISE EXCEPTION 'SHOULD FAIL'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS anon cannot call tt_state'; END; END $$;

-- ---------- phase 4: tt_apply_v2 (idempotent saves) ----------
RESET ROLE; SET ROLE anon;
DO $$ BEGIN BEGIN PERFORM tt_apply_v2('{}', gen_random_uuid()); RAISE EXCEPTION 'SHOULD FAIL'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS anon cannot call tt_apply_v2'; END; END $$;
RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
DO $$ DECLARE r1 jsonb; r2 jsonb; op uuid := '11111111-1111-1111-1111-111111111111'; pl jsonb := '{"steps":{"set":[{"t":"S9-T01","k":"a","done":true}]},"activity":[{"type":"done","t":"S9-T01","k":"a"}],"versions":[{"t":"S9-T01","k":"a","title":"x","body":"y"}]}';
BEGIN
  r1 := tt_apply_v2(pl, op);
  IF (r1->>'applied')::boolean IS NOT TRUE OR r1->>'server_time' IS NULL THEN RAISE EXCEPTION 'FAIL first apply: %', r1; END IF;
  RAISE NOTICE 'PASS first apply saves and returns server_time';
  r2 := tt_apply_v2(pl, op);
  IF (r2->>'applied')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'FAIL replay applied again: %', r2; END IF;
  IF jsonb_array_length(tt_state()->'activity') <> 1 OR jsonb_array_length(tt_state()->'versions') <> 1 THEN RAISE EXCEPTION 'FAIL replay duplicated rows'; END IF;
  RAISE NOTICE 'PASS replaying the same operation changes nothing (no duplicate activity or history)';
  -- a replay must not undo a later change
  PERFORM tt_apply_v2('{"steps":{"set":[{"t":"S9-T01","k":"a","done":false}]}}', '22222222-2222-2222-2222-222222222222');
  PERFORM tt_apply_v2(pl, op);
  IF (SELECT done FROM tt_user_steps WHERE ticket_id='S9-T01') THEN RAISE EXCEPTION 'FAIL late replay overwrote a newer change'; END IF;
  RAISE NOTICE 'PASS a late replay does not overwrite newer changes';
  -- same op id, different user: not shared
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
  r1 := tt_apply_v2(pl, op);
  IF (r1->>'applied')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FAIL operation ids leaked between users'; END IF;
  IF (SELECT count(*) FROM tt_ops) <> 1 THEN RAISE EXCEPTION 'FAIL user sees another users operations'; END IF;
  RAISE NOTICE 'PASS operation ids and the log are per user';
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
END $$;
-- a failing save leaves no trace, so the same operation can be retried
DO $$ DECLARE op uuid := '33333333-3333-3333-3333-333333333333'; BEGIN
  BEGIN PERFORM tt_apply_v2('{"badges":[{"key":"k","family":"f","tier":"notanumber"}]}', op); RAISE EXCEPTION 'SHOULD FAIL'; EXCEPTION WHEN invalid_text_representation THEN NULL; END;
  IF EXISTS (SELECT 1 FROM tt_ops WHERE op_id = op) THEN RAISE EXCEPTION 'FAIL failed save was recorded as applied'; END IF;
  IF (tt_apply_v2('{"badges":[{"key":"k","family":"f","tier":1}]}', op)->>'applied')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FAIL retry after failure'; END IF;
  RAISE NOTICE 'PASS failed save is not recorded; the retry works';
END $$;
DO $$ BEGIN BEGIN PERFORM tt_apply_v2('{}', NULL); RAISE EXCEPTION 'SHOULD FAIL'; EXCEPTION WHEN SQLSTATE '22023' THEN RAISE NOTICE 'PASS missing operation id rejected'; END; END $$;
-- updated_at moves when a row changes (also through the old tt_apply)
DO $$ DECLARE a timestamptz; b timestamptz; BEGIN
  SELECT updated_at INTO a FROM tt_user_steps WHERE ticket_id='S9-T01';
  PERFORM pg_sleep(0.05);
  PERFORM tt_apply('{"steps":{"set":[{"t":"S9-T01","k":"a","done":true,"note":"n"}]}}');
  SELECT updated_at INTO b FROM tt_user_steps WHERE ticket_id='S9-T01';
  IF b <= a THEN RAISE EXCEPTION 'FAIL updated_at did not move'; END IF; RAISE NOTICE 'PASS updated_at moves on change';
END $$;
-- old operations are purged (30 days)
RESET ROLE;
INSERT INTO tt_ops(user_id, op_id, applied_at) VALUES ('00000000-0000-0000-0000-000000000002','44444444-4444-4444-4444-444444444444', now() - interval '31 days');
SET ROLE authenticated; SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
DO $$ BEGIN PERFORM tt_apply_v2('{}', '55555555-5555-5555-5555-555555555555');
  IF EXISTS (SELECT 1 FROM tt_ops WHERE op_id='44444444-4444-4444-4444-444444444444') THEN RAISE EXCEPTION 'FAIL old operation not purged'; END IF; RAISE NOTICE 'PASS operations older than 30 days are purged'; END $$;
