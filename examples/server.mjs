import { gateway } from 'ai';
import { reviewRetainedEvidence } from './review.mjs';

// Run only on your server, after authorizing this result for this user/model.
// The result must already exist in your synthetic sandbox. This creates no result.
const { SANCTIONSKIT_API_KEY, SANCTIONSKIT_RESULT_ID, AI_GATEWAY_MODEL, AI_GATEWAY_API_KEY } = process.env;
if (!SANCTIONSKIT_API_KEY || !SANCTIONSKIT_RESULT_ID || !AI_GATEWAY_MODEL || !AI_GATEWAY_API_KEY) {
  throw new Error('Configure a sandbox results:read key, an authorized existing sandbox result ID, and your approved AI Gateway model/key on the server.');
}
const result = await reviewRetainedEvidence(gateway(AI_GATEWAY_MODEL), {
  apiKey: SANCTIONSKIT_API_KEY,
  resultId: SANCTIONSKIT_RESULT_ID,
  environment: 'sandbox',
  allowModelAccessToEvidence: true,
});
// This is a model-generated summary, not a review decision or complete audit record.
console.log(result.text);
