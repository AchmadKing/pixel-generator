import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

/**
 * Initializes and returns the SQLite database connection.
 * Applies WAL mode, foreign keys, and executes initial schema migrations.
 */
export function initDatabase(dbPath = config.storage.dbPath) {
  const isMemory = dbPath === ':memory:';
  if (!isMemory) {
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath);

  // Enable foreign keys and WAL mode
  db.exec('PRAGMA foreign_keys = ON;');
  if (!isMemory) {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec('PRAGMA synchronous = NORMAL;');

  // Apply schema
  if (fs.existsSync(SCHEMA_PATH)) {
    const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schemaSql);
  } else {
    throw new Error(`Schema file not found at ${SCHEMA_PATH}`);
  }

  // Ensure default project exists
  ensureDefaultProject(db);

  return db;
}

/**
 * Ensures a default project exists for asset generation.
 */
export function ensureDefaultProject(db) {
  const check = db.prepare('SELECT id FROM projects WHERE id = ?').get('proj_default');
  if (!check) {
    db.prepare(`
      INSERT INTO projects (id, name, description, default_palette)
      VALUES (?, ?, ?, ?)
    `).run('proj_default', 'Default Project', 'Default workspace for pixel game assets', 'endesga-32');
  }
}

/**
 * Executes a function inside a database transaction with automatic rollback on error.
 */
export function withTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn(db);
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}
