-- Run once: who may register. Add more people later from the app (Settings > Account > Invite).
INSERT INTO tt_allowed_emails (email, role) VALUES ('hamdiirahal@gmail.com', 'owner') ON CONFLICT (email) DO NOTHING;
