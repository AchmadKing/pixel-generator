import path from 'node:path';

/**
 * Resolves a target path safely within a base directory, strictly preventing path traversal attacks.
 * Throws a Security Violation error if the target resolves outside baseDir.
 */
export function resolveSafePath(baseDir, relativePath) {
  if (!baseDir || typeof baseDir !== 'string') {
    throw new Error('Base directory must be a valid non-empty string');
  }
  if (!relativePath || typeof relativePath !== 'string') {
    throw new Error('Relative path must be a valid non-empty string');
  }

  // Reject paths containing null bytes
  if (relativePath.includes('\0')) {
    throw new Error('Security Violation: Null byte detected in path');
  }

  const safeBase = path.resolve(baseDir);
  const resolved = path.resolve(safeBase, relativePath);

  // Check if resolved path is within safeBase
  if (!resolved.startsWith(safeBase + path.sep) && resolved !== safeBase) {
    throw new Error(`Security Violation: Path traversal detected outside safe root: ${relativePath}`);
  }

  return resolved;
}
