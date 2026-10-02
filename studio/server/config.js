import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 1. Runtime Version Guard: Node.js >= 22.13.0 required for stable built-in node:sqlite
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`[FATAL ERROR] Node.js version >= 22.13.0 is required for built-in node:sqlite support without experimental flags.`);
  console.error(`Current version: ${process.version}`);
  console.error(`Please update Node.js to version 22.13.0 or higher (recommended: 24.x LTS).`);
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '../..');

// 2. Load .env if present (simple zero-dependency parser)
export function loadEnv(envPath = path.join(ROOT_DIR, '.env')) {
  const env = {};
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx !== -1) {
        const key = line.slice(0, eqIdx).trim();
        const value = line.slice(eqIdx + 1).trim();
        env[key] = value;
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
  return env;
}

// 3. Load studio.config.json
export function loadConfig(configPath = path.join(ROOT_DIR, 'studio.config.json')) {
  loadEnv();
  let fileConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.warn(`[WARN] Failed to parse studio.config.json, using defaults: ${e.message}`);
    }
  }

  const baseDir = path.resolve(ROOT_DIR, fileConfig.storage?.baseDir || 'assets');

  return {
    server: {
      host: process.env.HOST || fileConfig.server?.host || '127.0.0.1',
      port: Number(process.env.PORT) || fileConfig.server?.port || 5178
    },
    storage: {
      baseDir,
      projectsDir: path.resolve(ROOT_DIR, fileConfig.storage?.projectsDir || 'assets/projects'),
      generatedDir: path.resolve(ROOT_DIR, fileConfig.storage?.generatedDir || 'assets/generated'),
      exportsDir: path.resolve(ROOT_DIR, fileConfig.storage?.exportsDir || 'assets/exports'),
      referencesDir: path.resolve(ROOT_DIR, fileConfig.storage?.referencesDir || 'assets/references'),
      dbPath: path.resolve(ROOT_DIR, fileConfig.storage?.dbPath || 'assets/studio.db'),
      stagingDir: path.resolve(baseDir, 'generated/.staging'),
      quarantineDir: path.resolve(baseDir, 'generated/.quarantine'),
      recoveryDir: path.resolve(baseDir, 'generated/.recovery')
    },
    providers: {
      default: fileConfig.providers?.default || 'mock',
      falKey: process.env.FAL_KEY || '',
      fal: fileConfig.providers?.fal || {
        endpoint: 'https://queue.fal.run/fal-ai/flux-lora',
        model: 'flux-lora',
        requestTimeoutMs: 15000,
        totalJobTimeoutMs: 120000,
        pollIntervalMs: 1000
      }
    },
    defaults: fileConfig.defaults || {
      palette: 'endesga-32',
      targetWidth: 32,
      targetHeight: 32,
      frameDurationMs: 125
    }
  };
}

export const config = loadConfig();
