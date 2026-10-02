import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { resolveSafePath } from './path-jail.js';

export class StorageManager {
  constructor(storageConfig = config.storage) {
    this.config = storageConfig;
    this.ensureDirectories();
  }

  ensureDirectories() {
    const dirs = [
      this.config.baseDir,
      this.config.projectsDir,
      this.config.generatedDir,
      this.config.exportsDir,
      this.config.referencesDir,
      this.config.stagingDir,
      this.config.quarantineDir,
      this.config.recoveryDir || path.resolve(this.config.baseDir, 'generated/.recovery')
    ];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Saves a temporary file to the staging directory.
   */
  saveToStaging(jobId, filename, buffer) {
    this.ensureDirectories();
    const safeFilename = `${jobId}_${path.basename(filename)}`;
    const stagingPath = path.join(this.config.stagingDir, safeFilename);
    fs.writeFileSync(stagingPath, buffer);
    return stagingPath;
  }

  /**
   * Validates PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
   */
  isValidPng(filePath) {
    if (!fs.existsSync(filePath)) return false;
    const stats = fs.statSync(filePath);
    if (stats.size < 8) return false;

    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(8);
    fs.readSync(fd, buffer, 0, 8, 0);
    fs.closeSync(fd);

    const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    return buffer.equals(pngHeader);
  }

  /**
   * Relocates staged raw and processed files into final permanent asset directory.
   */
  relocateFromStaging(jobId, assetId, versionId) {
    const targetDir = resolveSafePath(this.config.generatedDir, path.join(assetId, versionId));
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const stagedRaw = path.join(this.config.stagingDir, `${jobId}_raw.png`);
    const stagedProcessed = path.join(this.config.stagingDir, `${jobId}_processed.png`);

    const finalRaw = path.join(targetDir, 'raw.png');
    const finalProcessed = path.join(targetDir, 'processed.png');

    if (fs.existsSync(stagedRaw)) {
      fs.renameSync(stagedRaw, finalRaw);
    }
    if (fs.existsSync(stagedProcessed)) {
      fs.renameSync(stagedProcessed, finalProcessed);
    }

    return {
      rawFilePath: finalRaw,
      processedFilePath: finalProcessed
    };
  }

  /**
   * Compensating cleanup: deletes newly created target directory and any remaining staging files
   * when database commit fails.
   */
  compensatingCleanup(jobId, assetId, versionId) {
    // 1. Clean target version directory
    if (assetId && versionId) {
      try {
        const targetDir = resolveSafePath(this.config.generatedDir, path.join(assetId, versionId));
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true });
        }
        // If parent asset folder is now empty, remove it too
        const assetDir = resolveSafePath(this.config.generatedDir, assetId);
        if (fs.existsSync(assetDir) && fs.readdirSync(assetDir).length === 0) {
          fs.rmdirSync(assetDir);
        }
      } catch (e) {
        console.warn(`[WARN] Compensating cleanup error on target dir: ${e.message}`);
      }
    }

    // 2. Clean associated staging files
    if (jobId) {
      try {
        const stagedRaw = path.join(this.config.stagingDir, `${jobId}_raw.png`);
        const stagedProcessed = path.join(this.config.stagingDir, `${jobId}_processed.png`);
        if (fs.existsSync(stagedRaw)) fs.unlinkSync(stagedRaw);
        if (fs.existsSync(stagedProcessed)) fs.unlinkSync(stagedProcessed);
      } catch (e) {
        console.warn(`[WARN] Compensating cleanup error on staging files: ${e.message}`);
      }
    }
  }
}
