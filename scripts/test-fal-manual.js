#!/usr/bin/env node
/**
 * MANUAL FAL.AI LIVE API TEST HARNESS
 * 
 * IMPORTANT NOTICE:
 * This script makes REAL, PAID network requests to the Fal.ai cloud queue.
 * It is NEVER executed automatically by `npm test` or CI pipelines.
 * 
 * Usage:
 *   node scripts/test-fal-manual.js [--confirm]
 */

import { config } from '../studio/server/config.js';
import { FalProvider } from '../studio/server/providers/fal-provider.js';

async function runManualTest() {
  console.log('='.repeat(65));
  console.log('       FAL.AI LIVE CLOUD QUEUE MANUAL TEST RUNNER       ');
  console.log('='.repeat(65));

  const falKey = config.providers.falKey;
  if (!falKey || falKey.trim().length === 0) {
    console.error('[ERROR] No FAL_KEY found in environment or .env file.');
    console.error('Please add FAL_KEY=your_key_here to .env to run live tests.');
    process.exit(1);
  }

  const maskedKey = `${falKey.slice(0, 4)}...${falKey.slice(-3)}`;
  console.log(`[INFO] Authenticated with key: ${maskedKey}`);
  console.log(`[INFO] Target Endpoint: ${config.providers.fal.endpoint}`);
  console.log(`[WARN] BILLING NOTICE: Executing this script will consume real credits on your Fal.ai account.`);

  const hasConfirmFlag = process.argv.includes('--confirm');
  if (!hasConfirmFlag) {
    console.log('\n[SAFETY BLOCK] Live generation aborted.');
    console.log('To confirm that you want to execute a real paid request, run:');
    console.log('  node scripts/test-fal-manual.js --confirm\n');
    process.exit(0);
  }

  console.log('\n[RUNNING] Submitting live job to Fal.ai Queue...');
  const provider = new FalProvider(config.providers.fal, falKey);

  const mockJob = {
    id: `live_test_${Date.now()}`,
    request_payload: {
      prompt: 'pixel art ruby gemstone dagger, 32x32, 16 bit',
      width: 512,
      height: 512,
      seed: 42
    }
  };

  const hooks = {
    onSubmitting: () => console.log(' -> [Hook] Stage: submitting to queue...'),
    onSubmitted: (job, id) => console.log(` -> [Hook] Stage: submitted! Received request ID: ${id}`),
    onPolling: (job, details) => console.log(` -> [Hook] Stage: polling status: ${details.status}`),
    onDownloading: () => console.log(' -> [Hook] Stage: downloading image buffer & verifying PNG magic bytes...')
  };

  try {
    const result = await provider.generate(mockJob, hooks);
    console.log('\n[SUCCESS] Live generation succeeded!');
    console.log(` -> Image Buffer Size: ${result.imageBuffer.length} bytes`);
    console.log(` -> Dimensions: ${result.width}x${result.height}`);
    console.log(` -> MIME Type: ${result.mimeType}`);
    console.log(` -> Request ID: ${result.metadata.requestId}`);
    console.log('='.repeat(65));
  } catch (err) {
    console.error(`\n[FAILED] Live generation error: ${err.message}`);
    process.exit(1);
  }
}

runManualTest();
