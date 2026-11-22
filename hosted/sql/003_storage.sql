-- Private file storage for task attachments (images first). Idempotent.
-- Objects live under "<user id>/<ticket id>/<file id>", and every policy only lets a person touch their own folder.
-- Needs the Supabase `storage` schema; the migrate script treats a failure here as a warning, not a build failure.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('task-files', 'task-files', false, 26214400)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 26214400;

DROP POLICY IF EXISTS tt_files_select ON storage.objects;
DROP POLICY IF EXISTS tt_files_insert ON storage.objects;
DROP POLICY IF EXISTS tt_files_update ON storage.objects;
DROP POLICY IF EXISTS tt_files_delete ON storage.objects;
CREATE POLICY tt_files_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'task-files' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY tt_files_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'task-files' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY tt_files_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'task-files' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'task-files' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY tt_files_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'task-files' AND (storage.foldername(name))[1] = auth.uid()::text);
