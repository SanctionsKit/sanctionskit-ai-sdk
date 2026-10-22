import { readFile } from 'node:fs/promises';
import { MockLanguageModelV4 } from 'ai/test';
import { reviewRetainedEvidence } from './review.mjs';

// Official public, invented-data API-contract fixture. No keys or network calls.
const evidence = JSON.parse(await readFile(new URL('../test/fixtures/synthetic-evidence.json', import.meta.url), 'utf8'));
const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: undefined },
};
let requests = 0;
const model = new MockLanguageModelV4({
  doGenerate: [
    { content: [{ type: 'tool-call', toolCallId: 'example-read', toolName: 'sanctionsKitEvidence', input: '{}' }], finishReason: { unified: 'tool-calls', raw: undefined }, usage, warnings: [] },
    { content: [{ type: 'text', text: 'Synthetic test complete. Retained evidence was retrieved for human review; no current check or clearance decision was made.' }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] },
  ],
});
const result = await reviewRetainedEvidence(model, {
  apiKey: 'sk_test_nonfunctional_fixture',
  resultId: evidence.result.id,
  environment: 'sandbox',
  allowModelAccessToEvidence: true,
  fetch: async () => {
    requests += 1;
    return Response.json(evidence);
  },
});
if (requests !== 1 || result.steps[0].toolResults[0]?.output?.kind !== 'retained_evidence') {
  throw new Error('The offline tool workflow did not complete.');
}
console.log(JSON.stringify({ offline: true, requests, aiSdkSteps: result.steps.length, message: result.text }, null, 2));
