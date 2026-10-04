import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveSafePath } from './path-jail.js';
import { ensureDefaultProject } from '../db/database.js';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const IHDR_CHUNK = Buffer.from([0x49, 0x48, 0x44, 0x52]);
const VALID_CATEGORIES = new Set(['characters', 'items', 'environment', 'vfx', 'ui']);

/**
 * Extracts width and height from PNG header without buffering the whole file in RAM.
 * Compliant with RAM 4 GB constraint and lightweight asset inspection.
 */
export function readPngDimensions(filePath) {
  let fd = null;
  try {
    const stats = fs.statSync(filePath);
    if (stats.size < 24) return null;

    fd = fs.openSync(filePath, 'r');
    const headerBuffer = Buffer.alloc(24);
    const bytesRead = fs.readSync(fd, headerBuffer, 0, 24, 0);
    if (bytesRead < 24) return null;

    if (!headerBuffer.subarray(0, 8).equals(PNG_HEADER)) {
      return null;
    }
    if (!headerBuffer.subarray(12, 16).equals(IHDR_CHUNK)) {
      return null;
    }

    const width = headerBuffer.readUInt32BE(16);
    const height = headerBuffer.readUInt32BE(20);

    return { width, height, size: stats.size, mtimeMs: stats.mtimeMs };
  } catch (_) {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (_) {}
    }
  }
}

/**
 * Converts a slug into a title-cased display name.
 * e.g., 'health-potion' -> 'Health Potion'
 */
function slugToTitle(slug) {
  return slug
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase()) || slug;
}

/**
 * Infers an asset category from slug or folder name.
 */
function inferCategory(slug) {
  const lower = slug.toLowerCase();
  for (const cat of VALID_CATEGORIES) {
    if (lower.includes(cat) || lower.startsWith(cat.slice(0, -1))) {
      return cat;
    }
  }
  if (lower.includes('weapon') || lower.includes('sword') || lower.includes('potion') || lower.includes('shield')) {
    return 'items';
  }
  if (lower.includes('hero') || lower.includes('monster') || lower.includes('boss') || lower.includes('samurai') || lower.includes('warrior')) {
    return 'characters';
  }
  if (lower.includes('tile') || lower.includes('ground') || lower.includes('tree') || lower.includes('dungeon')) {
    return 'environment';
  }
  return 'items';
}

/**
 * Scans generated directory on disk and synchronizes discovered assets and versions into SQLite.
 *
 * @param {object} db - SQLite database instance
 * @param {object} storageConfig - Storage configuration
 * @returns {object} Scan summary { scannedAssets, addedAssets, addedVersions, updatedVersions, errors }
 */
export function scanAndSyncAssets(db, storageConfig) {
  const generatedDir = storageConfig.generatedDir;
  const result = {
    scannedAssets: 0,
    addedAssets: 0,
    addedVersions: 0,
    updatedVersions: 0,
    errors: []
  };

  if (!fs.existsSync(generatedDir)) {
    return result;
  }

  ensureDefaultProject(db);

  let dirEntries;
  try {
    dirEntries = fs.readdirSync(generatedDir, { withFileTypes: true });
  } catch (err) {
    result.errors.push(`Failed to read generated directory: ${err.message}`);
    return result;
  }

  for (const entry of dirEntries) {
    // Skip non-directories and hidden/staging folders (.staging, .quarantine, .recovery, etc.)
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue;
    }

    const assetSlug = entry.name;

    // Validate slug to prevent path traversal or unsafe characters
    if (!/^[a-zA-Z0-9_-]+$/.test(assetSlug)) {
      continue;
    }

    let assetDir;
    try {
      assetDir = resolveSafePath(generatedDir, assetSlug);
    } catch (_) {
      continue;
    }

    result.scannedAssets++;

    // Check version folders inside assetDir
    let versionEntries;
    try {
      versionEntries = fs.readdirSync(assetDir, { withFileTypes: true });
    } catch (err) {
      result.errors.push(`Error reading ${assetSlug}: ${err.message}`);
      continue;
    }

    // Identify versions: folders like v1, v2, ver_xxx, or UUIDs
    const versionFolders = versionEntries.filter(e => e.isDirectory() && !e.name.startsWith('.'));

    // If there are no subdirectories, check if images are directly in assetDir (single-version fallback)
    const directImages = versionEntries.filter(e => e.isFile() && e.name.toLowerCase().endsWith('.png'));

    const versionsToProcess = [];

    if (versionFolders.length > 0) {
      for (const vFolder of versionFolders) {
        const vPath = path.join(assetDir, vFolder.name);
        let vNumber = 1;
        const vMatch = vFolder.name.match(/^v(\d+)$/i);
        if (vMatch) {
          vNumber = parseInt(vMatch[1], 10);
        }

        versionsToProcess.push({
          folderName: vFolder.name,
          dirPath: vPath,
          versionNumber: vNumber
        });
      }
    } else if (directImages.length > 0) {
      versionsToProcess.push({
        folderName: 'v1',
        dirPath: assetDir,
        versionNumber: 1
      });
    }

    if (versionsToProcess.length === 0) {
      continue;
    }

    // Sort versions ascending by versionNumber
    versionsToProcess.sort((a, b) => a.versionNumber - b.versionNumber);

    // Look for parent-level metadata if present
    let parentMetadata = {};
    const parentMetaPath = path.join(assetDir, 'metadata.json');
    if (fs.existsSync(parentMetaPath)) {
      try {
        parentMetadata = JSON.parse(fs.readFileSync(parentMetaPath, 'utf8'));
      } catch (_) {}
    }

    // Also inspect version metadata for asset name and category if parent metadata lacks them
    let candidateName = parentMetadata.name;
    let candidateCategory = parentMetadata.category;
    if (!candidateName || !candidateCategory) {
      for (const vInfo of versionsToProcess) {
        const vMetaPath = path.join(vInfo.dirPath, 'metadata.json');
        if (fs.existsSync(vMetaPath)) {
          try {
            const vm = JSON.parse(fs.readFileSync(vMetaPath, 'utf8'));
            if (!candidateName && vm.name) candidateName = vm.name;
            if (!candidateCategory && vm.category) candidateCategory = vm.category;
          } catch (_) {}
        }
      }
    }

    const assetName = candidateName || slugToTitle(assetSlug);
    let assetCategory = candidateCategory || inferCategory(assetSlug);
    if (!VALID_CATEGORIES.has(assetCategory)) {
      assetCategory = 'items';
    }

    let existingAsset = db.prepare('SELECT id, current_version_id FROM assets WHERE id = ?').get(assetSlug);
    let latestVersionId = null;
    let assetCreated = Boolean(existingAsset);

    for (const vInfo of versionsToProcess) {
      // Find candidate images in the version directory
      const processedCandidates = ['processed.png', 'image.png', 'sprite.png'];
      let processedPath = null;
      for (const cand of processedCandidates) {
        const p = path.join(vInfo.dirPath, cand);
        if (fs.existsSync(p)) {
          processedPath = p;
          break;
        }
      }

      const rawCandidates = ['raw.png', 'reference.png'];
      let rawPath = null;
      for (const cand of rawCandidates) {
        const p = path.join(vInfo.dirPath, cand);
        if (fs.existsSync(p)) {
          rawPath = p;
          break;
        }
      }

      // If no candidate was found, search for any .png file in directory
      if (!processedPath) {
        try {
          const files = fs.readdirSync(vInfo.dirPath);
          const pngFiles = files.filter(f => f.toLowerCase().endsWith('.png') && !f.endsWith('.tmp'));
          if (pngFiles.length > 0) {
            processedPath = path.join(vInfo.dirPath, pngFiles[0]);
          }
        } catch (_) {}
      }

      if (!processedPath) {
        continue;
      }

      // Read dimensions using fast header parser
      const processedDims = readPngDimensions(processedPath);
      if (!processedDims) {
        // File is either locked, empty, or corrupted PNG
        continue;
      }

      // Fallback raw path to processed path if raw not explicitly present
      if (!rawPath || !fs.existsSync(rawPath)) {
        rawPath = processedPath;
      }

      // Read version metadata if available
      let versionMeta = { ...parentMetadata };
      const vMetaPath = path.join(vInfo.dirPath, 'metadata.json');
      if (fs.existsSync(vMetaPath)) {
        try {
          const loaded = JSON.parse(fs.readFileSync(vMetaPath, 'utf8'));
          versionMeta = { ...versionMeta, ...loaded };
        } catch (_) {}
      }

      const prompt = versionMeta.prompt || `Pixel art ${assetName}`;
      const negPrompt = versionMeta.negative_prompt || null;
      const paletteId = versionMeta.palette_id || 'endesga-32';
      const providerId = versionMeta.source_tool || versionMeta.provider_id || 'ai-agent';
      const seed = typeof versionMeta.seed === 'number' ? versionMeta.seed : null;
      const targetWidth = versionMeta.target_width || processedDims.width;
      const targetHeight = versionMeta.target_height || processedDims.height;
      const notes = versionMeta.change_summary || versionMeta.notes || null;

      // Ensure parent asset entity exists before adding version
      if (!assetCreated) {
        db.prepare(`
          INSERT INTO assets (id, project_id, name, category, current_version_id)
          VALUES (?, 'proj_default', ?, ?, NULL)
        `).run(assetSlug, assetName, assetCategory);
        result.addedAssets++;
        assetCreated = true;
      }

      // Check if version exists in SQLite
      const existingVersion = db.prepare(`
        SELECT id FROM asset_versions 
        WHERE asset_id = ? AND version_number = ?
      `).get(assetSlug, vInfo.versionNumber);

      let versionId;
      if (existingVersion) {
        versionId = existingVersion.id;
        db.prepare(`
          UPDATE asset_versions
          SET raw_file_path = ?,
              processed_file_path = ?,
              target_width = ?,
              target_height = ?,
              palette_id = ?,
              prompt = ?,
              provider_id = ?,
              integrity_status = 'ok',
              notes = ?
          WHERE id = ?
        `).run(
          rawPath,
          processedPath,
          targetWidth,
          targetHeight,
          paletteId,
          prompt,
          providerId,
          notes,
          versionId
        );
        result.updatedVersions++;
      } else {
        versionId = `ver_${assetSlug}_v${vInfo.versionNumber}`;
        // Verify unique ID
        const checkId = db.prepare('SELECT id FROM asset_versions WHERE id = ?').get(versionId);
        if (checkId) {
          versionId = `ver_${assetSlug}_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
        }

        db.prepare(`
          INSERT INTO asset_versions (
            id, asset_id, parent_version_id, version_number, prompt, negative_prompt,
            provider_id, seed, palette_id, target_width, target_height,
            raw_file_path, processed_file_path, processing_config_json, integrity_status, notes, created_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, '{}', 'ok', ?, unixepoch()
          )
        `).run(
          versionId,
          assetSlug,
          latestVersionId,
          vInfo.versionNumber,
          prompt,
          negPrompt,
          providerId,
          seed,
          paletteId,
          targetWidth,
          targetHeight,
          rawPath,
          processedPath,
          notes
        );
        result.addedVersions++;
      }

      latestVersionId = versionId;
    }

    // Set the latest version as current_version_id
    if (latestVersionId) {
      db.prepare(`
        UPDATE assets
        SET current_version_id = ?, updated_at = unixepoch()
        WHERE id = ?
      `).run(latestVersionId, assetSlug);
    }
  }

  // Check integrity of existing asset versions in SQLite: mark missing if files on disk were removed
  try {
    const allVersions = db.prepare(`SELECT id, processed_file_path, raw_file_path FROM asset_versions`).all();
    for (const v of allVersions) {
      const processedExists = v.processed_file_path && fs.existsSync(v.processed_file_path);
      if (!processedExists) {
        db.prepare(`UPDATE asset_versions SET integrity_status = 'missing_backing_file' WHERE id = ?`).run(v.id);
      }
    }
  } catch (_) {}

  return result;
}
