-- Pixel Game Asset Studio Database Schema
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- 1. Projects
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  default_palette TEXT NOT NULL DEFAULT 'endesga-32',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 2. Assets (Parent Entity)
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('characters', 'items', 'environment', 'vfx', 'ui')),
  current_version_id TEXT, -- Wajib NULL saat draft awal sebelum versi pertama ada
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 3. Asset Versions (Immutable historical snapshots)
CREATE TABLE IF NOT EXISTS asset_versions (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  parent_version_id TEXT REFERENCES asset_versions(id) ON DELETE SET NULL,
  version_number INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  negative_prompt TEXT,
  provider_id TEXT NOT NULL,
  seed INTEGER,
  palette_id TEXT NOT NULL,
  target_width INTEGER NOT NULL,
  target_height INTEGER NOT NULL,
  raw_file_path TEXT NOT NULL,
  processed_file_path TEXT NOT NULL,
  processing_config_json TEXT NOT NULL DEFAULT '{}',
  integrity_status TEXT NOT NULL DEFAULT 'ok' CHECK(integrity_status IN ('ok', 'missing_backing_file', 'corrupted')),
  integrity_error TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(asset_id, version_number)
);

-- 4. Asset Frames (Metadata frame animasi & sprite sheet)
CREATE TABLE IF NOT EXISTS asset_frames (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES asset_versions(id) ON DELETE CASCADE,
  frame_index INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 125,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  pivot_x REAL NOT NULL DEFAULT 0.5,
  pivot_y REAL NOT NULL DEFAULT 1.0,
  file_path TEXT NOT NULL,
  UNIQUE(version_id, frame_index)
);

-- 5. Generation Jobs (Async Queue)
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  created_version_id TEXT REFERENCES asset_versions(id) ON DELETE SET NULL,
  provider_id TEXT NOT NULL,
  provider_request_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'interrupted')),
  stage TEXT NOT NULL CHECK(stage IN ('queued', 'submitting', 'polling', 'processing', 'completed', 'failed', 'interrupted')),
  error_message TEXT,
  request_payload TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Indeks
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);
CREATE INDEX IF NOT EXISTS idx_versions_asset ON asset_versions(asset_id);
CREATE INDEX IF NOT EXISTS idx_frames_version ON asset_frames(version_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

-- TRIGGER 1: Validasi current_version_id saat INSERT asset baru
CREATE TRIGGER IF NOT EXISTS validate_current_version_before_insert
BEFORE INSERT ON assets
FOR EACH ROW
WHEN NEW.current_version_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM asset_versions 
      WHERE id = NEW.current_version_id AND asset_id = NEW.id
    )
    THEN RAISE(ABORT, 'Integrity error: current_version_id must reference an existing version belonging to this asset')
  END;
END;

-- TRIGGER 2: Validasi current_version_id saat UPDATE asset
CREATE TRIGGER IF NOT EXISTS validate_current_version_before_update
BEFORE UPDATE OF current_version_id ON assets
FOR EACH ROW
WHEN NEW.current_version_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM asset_versions 
      WHERE id = NEW.current_version_id AND asset_id = NEW.id
    )
    THEN RAISE(ABORT, 'Integrity error: current_version_id must reference an existing version belonging to this asset')
  END;
END;

-- TRIGGER 3: Proteksi Penghapusan Versi Aktif Langsung
CREATE TRIGGER IF NOT EXISTS prevent_delete_active_version
BEFORE DELETE ON asset_versions
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM assets 
      WHERE id = OLD.asset_id AND current_version_id = OLD.id
    )
    THEN RAISE(ABORT, 'Integrity error: Cannot delete the currently active version directly. Unlink current_version_id or use safe asset deletion.')
  END;
END;
