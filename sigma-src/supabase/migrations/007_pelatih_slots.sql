-- Add pelatih_slot columns to events table
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS pelatih_slot_1 VARCHAR(50),
  ADD COLUMN IF NOT EXISTS pelatih_slot_2 VARCHAR(50),
  ADD COLUMN IF NOT EXISTS pelatih_slot_3 VARCHAR(50);

COMMENT ON COLUMN events.pelatih_slot_1 IS 'Nickname pelatih piket 1 untuk event ini';
COMMENT ON COLUMN events.pelatih_slot_2 IS 'Nickname pelatih piket 2 (opsional)';
COMMENT ON COLUMN events.pelatih_slot_3 IS 'Nickname pelatih piket 3 (opsional)';
