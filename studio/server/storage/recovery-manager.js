import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Recursively canonicalizes an object by sorting all dictionary keys alphabetically.
 */
export function canonicalizeJson(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  const sortedKeys = Object.keys(value).sort();
  const result = {};
  for (const key of sortedKeys) {
    result[key] = canonicalizeJson(value[key]);
  }
  return result;
}

/**
 * Deterministic JSON stringifier with sorted keys.
 */
export function canonicalStringify(payload) {
  return JSON.stringify(canonicalizeJson(payload));
}

/**
 * Writes an entire Buffer to a file descriptor synchronously, looping if partial writes occur.
 * Throws RecoveryPartialWriteError if 0 bytes are written before buffer completion.
 */
export function writeAllSync(fd, buffer) {
  let offset = 0;
  const totalLength = buffer.length;
  while (offset < totalLength) {
    const bytesWritten = fs.writeSync(fd, buffer, offset, totalLength - offset);
    if (bytesWritten === 0) {
      const zeroErr = new Error(`RecoveryPartialWriteError: fs.writeSync returned 0 bytes written at offset ${offset}/${totalLength}`);
      zeroErr.bytesWritten = offset;
      zeroErr.totalLength = totalLength;
      throw zeroErr;
    }
    offset += bytesWritten;
  }
  return offset;
}

/**
 * Evaluates the liveness and ownership status of a primary lock file.
 * Distinguishes active, stale, and indeterminate locks with strict Windows safety.
 * 
 * @param {string} lockPath - Absolute path to .primary.lock file
 * @returns {{ status: 'not_found'|'active'|'stale'|'indeterminate', metadata?: object, reason?: string }}
 */
export function evaluateLockStatus(lockPath) {
  let stats;
  try {
    stats = fs.statSync(lockPath);
  } catch (err) {
    if (err.code === 'ENOENT') return { status: 'not_found' };
    return { status: 'indeterminate', reason: `stat_failed_${err.code || 'UNKNOWN'}` };
  }

  let content;
  try {
    content = fs.readFileSync(lockPath, 'utf8');
  } catch (err) {
    return { status: 'indeterminate', reason: `read_failed_${err.code || 'UNKNOWN'}` };
  }

  let metadata;
  try {
    metadata = JSON.parse(content);
  } catch (parseErr) {
    return { status: 'indeterminate', reason: 'unparseable_metadata' };
  }

  if (!metadata || metadata.lock_version !== 1 || typeof metadata.created_at !== 'number' || typeof metadata.pid !== 'number') {
    return { status: 'indeterminate', reason: 'invalid_metadata_schema' };
  }

  const leaseTtl = metadata.lease_ttl_ms || 30000;
  const age = Date.now() - metadata.created_at;

  // 1. Lease still valid: definitely active
  if (age < leaseTtl) {
    return { status: 'active', metadata };
  }

  // 2. Lease expired: evaluate PID liveness
  try {
    process.kill(metadata.pid, 0); // Signal 0: check process existence
    // Process is alive (or PID was recycled by OS for another process):
    return { status: 'indeterminate', metadata, reason: 'pid_alive_or_recycled' };
  } catch (err) {
    if (err.code === 'ESRCH') {
      // Process definitively does NOT exist on the operating system
      return { status: 'stale', metadata };
    }
    // EPERM: Process exists but owned by system/another user (PID recycled)
    return { status: 'indeterminate', metadata, reason: `pid_check_${err.code}` };
  }
}

/**
 * Verifies existence, accessibility, semantic structure, envelope compliance,
 * and cryptographic integrity of a recovery record file.
 */
export function verifyFilePayload(filePath, expectedJobId = null, expectedPayloadHash = null) {
  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch (statErr) {
    if (statErr.code === 'ENOENT') return { status: 'not_found' };
    return { status: 'inaccessible', error: statErr, code: statErr.code || 'UNKNOWN' };
  }

  if (stats.size === 0) {
    return { status: 'corrupted', reason: 'empty_file' };
  }

  let rawBuffer;
  try {
    rawBuffer = fs.readFileSync(filePath);
  } catch (readErr) {
    if (readErr.code === 'ENOENT') return { status: 'not_found', transition: 'disappeared_during_read' };
    return { status: 'inaccessible', error: readErr, code: readErr.code || 'UNKNOWN' };
  }

  let rawJson;
  try {
    rawJson = JSON.parse(rawBuffer.toString('utf8'));
  } catch (parseErr) {
    return { status: 'corrupted', reason: 'invalid_json', details: parseErr.message };
  }

  if (rawJson && rawJson.envelope_version === 1 && rawJson.integrity && rawJson.payload) {
    const { algorithm, payload_sha256 } = rawJson.integrity;
    if (algorithm !== 'sha256' || typeof payload_sha256 !== 'string' || payload_sha256.length !== 64) {
      return { status: 'corrupted', reason: 'invalid_integrity_envelope_header' };
    }

    const payload = rawJson.payload;
    const canonicalPayloadString = canonicalStringify(payload);
    const computedHash = crypto.createHash('sha256').update(Buffer.from(canonicalPayloadString, 'utf8')).digest('hex');

    if (computedHash !== payload_sha256) {
      return {
        status: 'corrupted',
        reason: 'hash_mismatch',
        details: { expectedInEnvelope: payload_sha256, computedFromPayload: computedHash }
      };
    }

    if (expectedPayloadHash && computedHash !== expectedPayloadHash) {
      return {
        status: 'corrupted',
        reason: 'caller_hash_mismatch',
        details: { expectedByCaller: expectedPayloadHash, computedFromPayload: computedHash }
      };
    }

    if (expectedJobId && payload.job_id !== expectedJobId) {
      return {
        status: 'corrupted',
        reason: 'job_id_mismatch',
        details: { expectedJobId, foundJobId: payload.job_id }
      };
    }

    return {
      status: 'valid',
      envelopeVersion: 1,
      data: payload,
      hash: computedHash,
      envelope: rawJson
    };
  }

  if (rawJson && typeof rawJson === 'object' && rawJson.job_id) {
    if (expectedJobId && rawJson.job_id !== expectedJobId) {
      return { status: 'corrupted', reason: 'job_id_mismatch', details: { expectedJobId, foundJobId: rawJson.job_id } };
    }
    return { status: 'legacy_unverified', envelopeVersion: 0, data: rawJson, warning: 'missing_integrity_envelope' };
  }

  return { status: 'corrupted', reason: 'unrecognized_schema' };
}

/**
 * Persists an emergency recovery record with Conservative Non-Deletion Policy,
 * pre-unlink identity verification, isolated lock cleanup, and multi-stage fallback.
 */
export function persistEmergencyRecoveryRecord(recoveryDir, jobId, payload) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(jobId)) {
    throw new Error(`SecurityError: Invalid jobId format: ${jobId}`);
  }

  fs.mkdirSync(recoveryDir, { recursive: true });
  const attemptedDestinations = [];

  const canonicalPayloadString = canonicalStringify(payload);
  const payloadSha256 = crypto.createHash('sha256').update(Buffer.from(canonicalPayloadString, 'utf8')).digest('hex');

  const envelope = {
    envelope_version: 1,
    integrity: {
      algorithm: 'sha256',
      payload_sha256: payloadSha256
    },
    payload: canonicalizeJson(payload)
  };
  const envelopeBuffer = Buffer.from(JSON.stringify(envelope, null, 2), 'utf8');

  // 1. Exclusive temporary allocation ('wx') with provenance tracking
  const MAX_TEMP_ALLOC_RETRIES = 3;
  let tempPath = null;
  let fd = null;
  let fileCreated = false;
  let openError = null;

  for (let attempt = 0; attempt < MAX_TEMP_ALLOC_RETRIES; attempt++) {
    const tempNonce = `${Date.now()}_${process.hrtime.bigint()}_${crypto.randomBytes(8).toString('hex')}`;
    const candidateTempPath = path.join(recoveryDir, `${jobId}.tmp.${tempNonce}`);
    try {
      fd = fs.openSync(candidateTempPath, 'wx');
      tempPath = candidateTempPath;
      fileCreated = true;
      break;
    } catch (err) {
      if (err.code === 'EEXIST') continue;
      openError = err;
      break;
    }
  }

  if (!fileCreated || fd === null) {
    const allocErr = new Error(`RecoveryOpenError: Failed to create exclusive temporary recovery file for ${jobId}: ${openError ? openError.message : 'collision retries exhausted'}`);
    allocErr.cause = openError;
    allocErr.jobId = jobId;
    throw allocErr;
  }

  // 2. Full write and flush
  let writeOrFlushError = null;
  let closeError = null;

  try {
    writeAllSync(fd, envelopeBuffer);
    try {
      fs.fsyncSync(fd);
    } catch (syncErr) {
      writeOrFlushError = new Error(`RecoveryFlushError: Failed to flush recovery record for ${jobId}: ${syncErr.message}`);
      writeOrFlushError.cause = syncErr;
    }
  } catch (err) {
    writeOrFlushError = err;
  } finally {
    try {
      fs.closeSync(fd);
    } catch (closeErr) {
      closeError = closeErr;
      if (writeOrFlushError) writeOrFlushError.closeError = closeErr;
    }
  }

  // 3. Post-write tempPath physical verification
  const tempVerification = verifyFilePayload(tempPath, jobId, payloadSha256);

  if (closeError && !writeOrFlushError) {
    if (tempVerification.status === 'valid') {
      return {
        status: 'temp_preserved',
        path: tempPath,
        verified: true,
        hash: payloadSha256,
        closeError: closeError.message
      };
    } else {
      const closeFailure = new Error(`RecoveryCloseError: Failed to close descriptor for ${tempPath} and payload is unverified: ${closeError.message}`);
      closeFailure.cause = closeError;
      closeFailure.tempPath = tempPath;
      closeFailure.recoveryStatus = tempVerification.status;
      throw closeFailure;
    }
  }

  if (writeOrFlushError) {
    if (tempVerification.status === 'valid') {
      return {
        status: 'temp_preserved',
        path: tempPath,
        verified: true,
        hash: payloadSha256,
        writeError: writeOrFlushError.message
      };
    } else if (tempVerification.status === 'inaccessible') {
      const inaccErr = new Error(`RecoveryWriteError: Failed during write and tempPath is inaccessible at ${tempPath}`);
      inaccErr.cause = writeOrFlushError;
      inaccErr.tempPath = tempPath;
      inaccErr.recoveryStatus = 'inaccessible';
      if (closeError) inaccErr.closeError = closeError;
      throw inaccErr;
    } else {
      const corruptErr = new Error(`RecoveryWriteError: Write failed and temporary file is unverified at: ${tempPath}`);
      corruptErr.cause = writeOrFlushError;
      corruptErr.tempPath = tempPath;
      corruptErr.recoveryStatus = tempVerification.status;
      if (closeError) corruptErr.closeError = closeError;
      throw corruptErr;
    }
  }

  if (tempVerification.status !== 'valid') {
    const unverifiedErr = new Error(`RecoveryWriteError: Temporary file verification failed at: ${tempPath}`);
    unverifiedErr.tempPath = tempPath;
    unverifiedErr.recoveryStatus = tempVerification.status;
    throw unverifiedErr;
  }

  // 4. Helper publication with Conservative Non-Deletion Policy
  function attemptAtomicPublish(srcPath, dstPath, isPrimarySlot = false) {
    attemptedDestinations.push(dstPath);
    try {
      fs.copyFileSync(srcPath, dstPath, fs.constants.COPYFILE_EXCL);
    } catch (copyErr) {
      if (copyErr.code === 'EEXIST') {
        return { success: false, reason: 'collision' };
      }
      if (copyErr.code === 'EXDEV' || copyErr.code === 'ENOTSUP') {
        let directFd = null;
        let directCreated = false;
        let directWriteError = null;
        let directCloseError = null;
        try {
          directFd = fs.openSync(dstPath, 'wx');
          directCreated = true;
          writeAllSync(directFd, envelopeBuffer);
          try {
            fs.fsyncSync(directFd);
          } catch (syncErr) {
            const flushErr = new Error(`RecoveryFlushError: Failed to flush direct recovery record for ${jobId}: ${syncErr.message}`);
            flushErr.cause = syncErr;
            throw flushErr;
          }
        } catch (directErr) {
          directWriteError = directErr;
        } finally {
          if (directFd !== null) {
            try {
              fs.closeSync(directFd);
            } catch (closeErr) {
              directCloseError = closeErr;
              if (directWriteError) directWriteError.closeError = closeErr;
            }
          }
        }

        // Independent source & destination evaluation after direct-write fallback
        const directDstCheck = verifyFilePayload(dstPath, jobId, payloadSha256);
        const directSrcCheck = verifyFilePayload(srcPath, jobId, payloadSha256);

        if (directWriteError || directCloseError) {
          if (directWriteError && directWriteError.code === 'EEXIST') {
            return { success: false, reason: 'collision' };
          }

          // Rule 1: Destination valid despite close error -> DO NOT DELETE!
          if (directDstCheck.status === 'valid') {
            console.warn(`[RECOVERY_DIRECT_VALID_DESPITE_CLOSE_ERROR]: Direct destination ${dstPath} is valid despite close error.`);
            if (directSrcCheck.status === 'valid') {
              try { fs.unlinkSync(srcPath); } catch (_) {}
            }
            return {
              success: true,
              verifiedPath: dstPath,
              hash: directDstCheck.hash,
              closeError: directCloseError ? directCloseError.message : undefined
            };
          }

          // Rule 2: Destination inaccessible -> DO NOT DELETE!
          if (directDstCheck.status === 'inaccessible') {
            console.warn(`[RECOVERY_DIRECT_INACCESSIBLE_PRESERVED]: Direct destination ${dstPath} is inaccessible. Preserving source and destination.`);
            return { success: false, reason: 'destination_inaccessible', error: directWriteError || directCloseError };
          }

          // Rule 3: Only delete if proven created by this call, corrupted, and source is valid
          if (directCreated && directDstCheck.status === 'corrupted' && directSrcCheck.status === 'valid') {
            try {
              fs.unlinkSync(dstPath);
            } catch (unlinkErr) {
              console.warn(`[RECOVERY_FALLBACK_CLEANUP_FAIL]: Failed to unlink partial candidate ${dstPath}: ${unlinkErr.message}`);
            }
          }
          return { success: false, reason: 'copy_failed', error: directWriteError || directCloseError };
        }
      } else {
        // Non-EEXIST error in copyFileSync (e.g. ENOSPC, EIO, EBUSY)
        console.warn(`[RECOVERY_COPY_FAILED]: copyFileSync failed for ${dstPath}: ${copyErr.message} (code: ${copyErr.code})`);
        
        const srcCheck = verifyFilePayload(srcPath, jobId, payloadSha256);
        const dstCheck = verifyFilePayload(dstPath, jobId, payloadSha256);

        // Conservative Non-Deletion: never delete primary slot without identity proof
        if (isPrimarySlot) {
          console.warn(`[RECOVERY_PRIMARY_NON_DELETION]: Copy to primary slot failed. Preserving ${dstPath} without deletion to prevent removing foreign files. Source ${srcPath} preserved.`);
        } else if (srcCheck.status === 'valid' && dstCheck.status === 'corrupted') {
          // Collision candidate with unique nonce in name: clean if proven corrupted
          try {
            fs.unlinkSync(dstPath);
          } catch (unlinkErr) {
            console.warn(`[RECOVERY_PARTIAL_DEST_UNLINK_FAIL]: Failed to unlink partial destination ${dstPath}: ${unlinkErr.message}`);
          }
        }

        return {
          success: false,
          reason: 'copy_failed',
          error: copyErr,
          sourceStatus: srcCheck.status,
          destinationStatus: dstCheck.status
        };
      }
    }

    // Verify destination before any action on source
    const dstVerification = verifyFilePayload(dstPath, jobId, payloadSha256);
    if (dstVerification.status === 'valid') {
      // Pre-unlink source verification
      const srcPreUnlinkCheck = verifyFilePayload(srcPath, jobId, payloadSha256);
      if (srcPreUnlinkCheck.status === 'valid') {
        try {
          fs.unlinkSync(srcPath);
        } catch (unlinkErr) {
          console.warn(`[RECOVERY_TEMP_UNLINK_WARN]: Destination verified but temp unlinking failed: ${unlinkErr.message}`);
        }
      } else {
        console.warn(`[RECOVERY_SRC_IDENTITY_MISMATCH]: srcPath ${srcPath} status changed (${srcPreUnlinkCheck.status}). Source NOT unlinked.`);
      }
      return { success: true, verifiedPath: dstPath, hash: dstVerification.hash };
    } else {
      console.warn(`[RECOVERY_PUBLISH_VERIFY_FAILED]: Destination ${dstPath} verification failed (${dstVerification.status}). Preserving independent source ${srcPath}.`);
      return { success: false, reason: dstVerification.status, details: dstVerification };
    }
  }

  // 5. Primary slot claim via primary lock with nonce verification
  const primaryDestination = path.join(recoveryDir, `${jobId}.json`);
  const primaryLockPath = path.join(recoveryDir, `${jobId}.primary.lock`);
  let publicationResult = null;
  let primaryLockFd = null;
  let primaryLockCreated = false;
  let primaryLockCloseError = null;
  let primaryLockUnlinkError = null;

  const primaryLockNonce = crypto.randomBytes(16).toString('hex');
  const lockMetadata = {
    lock_version: 1,
    job_id: jobId,
    pid: process.pid,
    created_at: Date.now(),
    lease_ttl_ms: 30000,
    nonce: primaryLockNonce
  };
  const lockBuffer = Buffer.from(JSON.stringify(lockMetadata, null, 2), 'utf8');

  try {
    primaryLockFd = fs.openSync(primaryLockPath, 'wx');
    primaryLockCreated = true;
    writeAllSync(primaryLockFd, lockBuffer);
    try { fs.fsyncSync(primaryLockFd); } catch (_) {}
    
    const pubRes = attemptAtomicPublish(tempPath, primaryDestination, true);
    if (pubRes.success) {
      publicationResult = pubRes;
    }
  } catch (lockOrCopyErr) {
    console.warn(`[RECOVERY_PRIMARY_SLOT_UNAVAILABLE]: Primary lock/destination unavailable for ${jobId}: ${lockOrCopyErr.message}`);
  } finally {
    if (primaryLockFd !== null) {
      try {
        fs.closeSync(primaryLockFd);
      } catch (closeErr) {
        primaryLockCloseError = closeErr;
        console.warn(`[RECOVERY_LOCK_CLOSE_FAIL]: Failed to close primary lock descriptor: ${closeErr.message}`);
      }
    }

    if (primaryLockCreated) {
      let canUnlink = false;
      try {
        const currentLockContent = fs.readFileSync(primaryLockPath, 'utf8');
        const parsedLock = JSON.parse(currentLockContent);
        if (parsedLock && parsedLock.nonce === primaryLockNonce) {
          canUnlink = true;
        } else {
          console.warn(`[RECOVERY_LOCK_NONCE_MISMATCH]: Lock file on ${primaryLockPath} was replaced by another process! Unlink aborted.`);
        }
      } catch (readErr) {
        console.warn(`[RECOVERY_LOCK_READ_FAIL]: Could not verify lock identity before unlink (${readErr.message}). Preserving lock file.`);
      }

      if (canUnlink) {
        try {
          fs.unlinkSync(primaryLockPath);
        } catch (unlinkErr) {
          primaryLockUnlinkError = unlinkErr;
          console.warn(`[RECOVERY_LOCK_UNLINK_FAIL]: Failed to unlink primary lock file: ${unlinkErr.message}`);
        }
      }
    }
  }

  // 6. Collision destination retries if primary slot failed
  if (!publicationResult) {
    const MAX_COLLISION_RETRIES = 10;
    for (let i = 0; i < MAX_COLLISION_RETRIES; i++) {
      const collisionNonce = `${Date.now()}_${process.hrtime.bigint()}_${crypto.randomBytes(8).toString('hex')}`;
      const candidate = path.join(recoveryDir, `${jobId}_retry_${collisionNonce}.json`);
      const pubRes = attemptAtomicPublish(tempPath, candidate, false);
      if (pubRes.success) {
        publicationResult = pubRes;
        break;
      }
    }
  }

  // 7. Uncommitted fallback if collision loop failed
  if (!publicationResult) {
    const uncommittedNonce = `${Date.now()}_${process.hrtime.bigint()}_${crypto.randomBytes(8).toString('hex')}`;
    const uncommittedCandidate = path.join(recoveryDir, `uncommitted_${jobId}_${uncommittedNonce}.json`);
    try {
      const pubRes = attemptAtomicPublish(tempPath, uncommittedCandidate, false);
      if (pubRes.success) {
        publicationResult = pubRes;
      }
    } catch (uncommittedErr) {
      console.warn(`[RECOVERY_FALLBACK_COPY_FAIL]: Fallback publishing failed: ${uncommittedErr.message}`);
    }
  }

  // 8. Reconciliation evaluation across all candidates
  if (publicationResult && publicationResult.success) {
    const isUncommitted = publicationResult.verifiedPath.includes('uncommitted_');
    console.info(`[RECOVERY_RECORD_COMMITTED]: Record verified and published at ${publicationResult.verifiedPath}`);
    return {
      status: isUncommitted ? 'uncommitted_fallback' : 'committed',
      path: publicationResult.verifiedPath,
      verified: true,
      hash: publicationResult.hash,
      ...(primaryLockCloseError ? { lockCloseError: primaryLockCloseError.message } : {}),
      ...(primaryLockUnlinkError ? { lockUnlinkError: primaryLockUnlinkError.message } : {})
    };
  }

  const reconciliationReport = [];
  for (const attempted of attemptedDestinations) {
    const attVerify = verifyFilePayload(attempted, jobId, payloadSha256);
    reconciliationReport.push({ path: attempted, ...attVerify });
    if (attVerify.status === 'valid') {
      return {
        status: attempted.includes('uncommitted_') ? 'uncommitted_fallback' : 'committed',
        path: attempted,
        verified: true,
        hash: attVerify.hash
      };
    }
  }

  const finalTempVerify = verifyFilePayload(tempPath, jobId, payloadSha256);
  reconciliationReport.push({ path: tempPath, ...finalTempVerify });

  if (finalTempVerify.status === 'valid') {
    return {
      status: 'temp_preserved',
      path: tempPath,
      verified: true,
      hash: finalTempVerify.hash
    };
  } else if (finalTempVerify.status === 'inaccessible') {
    return {
      status: 'temp_preserved',
      path: tempPath,
      verified: false,
      hash: payloadSha256,
      inaccessibleError: finalTempVerify.error ? finalTempVerify.error.message : 'inaccessible'
    };
  }

  const inaccessibleCandidate = reconciliationReport.find(r => r.status === 'inaccessible');
  if (inaccessibleCandidate) {
    const verifErr = new Error(`RecoveryVerificationError: Recovery status uncertain: candidate ${inaccessibleCandidate.path} is inaccessible. Physical data is preserved on disk.`);
    verifErr.cause = inaccessibleCandidate.error;
    verifErr.reconciliationReport = reconciliationReport;
    throw verifErr;
  }

  const dataLossErr = new Error(`RecoveryVerificationError: Critical failure: no surviving valid recovery record verified on disk for job ${jobId}`);
  dataLossErr.attemptedDestinations = attemptedDestinations;
  dataLossErr.reconciliationReport = reconciliationReport;
  throw dataLossErr;
}
