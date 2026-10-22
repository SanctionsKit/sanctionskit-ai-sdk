import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { generateText, isStepCount } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { sanctionsKitEvidence, SanctionsKitEvidenceError } from '../dist/index.js';
import { reviewRetainedEvidence } from '../examples/review.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/synthetic-evidence.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(fixture);
const id = fixture.result.id;
const options = { apiKey: 'sk_test_nonfunctional_fixture', resultId: id, environment: 'sandbox', allowModelAccessToEvidence: true };
const context = { toolCallId: 'fixture-call', messages: [] };
const usage = { inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 0, text: 0, reasoning: undefined } };
const generated = content => ({ content, finishReason: { unified: content[0].type === 'tool-call' ? 'tool-calls' : 'stop', raw: undefined }, usage, warnings: [] });

function harness(value = clone(), extra = {}) {
  const requests = [];
  const configured = { ...options, fetch: async (url, init) => { requests.push({ url: String(url), init }); return Response.json(value); }, ...extra };
  const tool = sanctionsKitEvidence(configured);
  return { tool, requests, configured, execute: (input = {}, execution = context) => tool.execute(input, execution) };
}
const rejectsCode = (promise, code) => assert.rejects(promise, error => error instanceof SanctionsKitEvidenceError && error.code === code);

test('published SanctionsKit SDK makes exactly one GET for the approved result, preserving full source evidence', async () => {
  const value = clone();
  value.result.coverage[0].publishedAt = '2026-09-01';
  value.result.coverage[0].sourceNotice = { text: 'Publication notice', sourceUrl: 'https://example.org/authority', limits: ['historic'] };
  value.result.futureField = { warning: 'Preserve this context' };
  value.result.matches[0].record.extensions = JSON.parse('{"constructor":"published literal","__proto__":{"marker":"source value"},"future":[null,"unknown"]}');
  const h = harness(value);
  const output = await h.execute();
  assert.deepEqual(output.evidence, value);
  assert.equal(output.evidence.result.matches[0].record.birthDates[0].precision, 'year');
  assert.equal(output.evidence.result.coverage[0].publishedAt, '2026-09-01');
  assert.equal({}.marker, undefined);
  assert.equal(output.interpretation.currentScreeningPerformed, false);
  assert.equal(output.interpretation.humanReviewRequired, true);
  assert.equal(output.interpretation.synthetic, true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, `https://www.sanctionskit.com/api/v1/results/${id}/evidence`);
  assert.equal(h.requests[0].init.method, 'GET');
  assert.equal(h.requests[0].init.redirect, 'error');
  assert.equal(h.requests[0].init.credentials, 'omit');
  assert.equal(h.requests[0].init.body, undefined);
  assert.equal(h.requests[0].init.headers.get('Authorization'), `Bearer ${options.apiKey}`);
  assert.ok(!JSON.stringify(output).includes(options.apiKey));
});

test('configuration requires explicit evidence access and separate production opt-in before networking', () => {
  let calls = 0;
  const transport = async () => { calls += 1; return Response.json(fixture); };
  for (const changes of [
    { allowModelAccessToEvidence: false }, { allowModelAccessToEvidence: undefined },
    { resultId: '../sources' }, { apiKey: 'sk_live_fixture' }, { environment: 'unknown' },
    { apiKey: 'sk_test_fixture\nsecret' }, { apiKey: '' }, { timeoutMs: 0 }, { timeoutMs: 60_001 },
    { timeoutMs: NaN }, { allowProduction: true },
    { environment: 'production', apiKey: 'sk_live_fixture' },
  ]) {
    assert.throws(() => sanctionsKitEvidence({ ...options, fetch: transport, ...changes }), error => error.code === 'invalid_configuration');
  }
  assert.equal(calls, 0);
});

test('production is supported only with explicit opt-in and matching evidence environment', async () => {
  const value = clone(); value.result.environment = 'production';
  const h = harness(value, { environment: 'production', apiKey: 'sk_live_nonfunctional_fixture', allowProduction: true });
  const output = await h.execute();
  assert.equal(output.interpretation.synthetic, false);
  assert.deepEqual(output.evidence, value);
});

test('model input cannot retarget IDs, inject credentials, or choose an endpoint', async () => {
  const h = harness();
  for (const input of [{ resultId: '00000000-0000-4000-8000-000000000999' }, { apiKey: 'secret' }, { url: 'https://example.org' }, { query: 'Real Person' }, null]) {
    await rejectsCode(h.execute(input), 'invalid_input');
  }
  assert.equal(h.requests.length, 0);
  h.configured.resultId = '00000000-0000-4000-8000-000000000999';
  h.configured.apiKey = 'sk_live_other';
  h.configured.environment = 'production';
  const output = await h.execute();
  assert.equal(output.evidence.result.id, id);
  assert.equal(h.requests[0].init.headers.get('Authorization'), `Bearer ${options.apiKey}`);
});

test('minimal-retention and no-match evidence preserve limits without claiming clearance', async () => {
  const value = clone();
  Object.assign(value, { retention: 'minimal', subject: null, request: null, reference: null, retainedInputs: false, replayLimit: 'Inputs were not retained; historical replay is unavailable.' });
  value.result.status = 'no_match'; value.result.matches = [];
  const output = await harness(value).execute();
  assert.deepEqual(output.evidence, value);
  assert.match(output.interpretation.notice, /not business approval or legal clearance/);
});

test('malformed, cross-result, cross-environment and contradictory responses fail rather than imply a result', async () => {
  const mutations = [
    v => { delete v.result.coverage; }, v => { delete v.result.versions.policy; },
    v => { delete v.result.disclaimer; }, v => { delete v.result.coverage[0].retrievedAt; },
    v => { delete v.result.matches[0].record.sourceUrl; }, v => { v.result.environment = 'production'; },
    v => { v.result.id = '00000000-0000-4000-8000-000000000999'; },
    v => { v.result.status = 'no_match'; }, v => { v.result.matches = []; },
    v => { v.retainedInputs = false; }, v => { v.retention = 'minimal'; },
    v => { delete v.replayLimit; }, v => { v.result.createdAt = 'unknown'; },
  ];
  for (const mutate of mutations) {
    const value = clone(); mutate(value);
    await rejectsCode(harness(value).execute(), 'invalid_evidence');
  }
});

test('HTTP errors are sanitized, are not retried, and never return evidence or no-match', async () => {
  for (const [status, code] of [[401, 'access_denied'], [403, 'access_denied'], [404, 'not_found'], [410, 'expired'], [429, 'rate_limited'], [500, 'upstream_error']]) {
    let count = 0;
    const h = harness(undefined, { fetch: async () => {
      count += 1;
      return Response.json({ error: { code: 'raw_provider_code', message: 'secret-key customer-input', details: { private: 'secret-key' } } }, { status });
    } });
    await assert.rejects(h.execute(), error => {
      assert.equal(error.code, code); assert.equal(error.status, status);
      assert.ok(!error.message.includes('secret-key'));
      assert.equal(error.cause, undefined); assert.equal(error.details, undefined);
      return true;
    });
    assert.equal(count, 1);
  }
});

test('redirect, HTML, malformed JSON and oversized evidence stop without truncated success', async () => {
  await rejectsCode(harness(undefined, { fetch: async () => new Response('', { status: 302, headers: { location: 'https://example.org' } }) }).execute(), 'transport_error');
  await rejectsCode(harness(undefined, { fetch: async () => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }) }).execute(), 'invalid_evidence');
  await assert.rejects(harness(undefined, { fetch: async () => new Response('{', { headers: { 'content-type': 'application/json' } }) }).execute(), SanctionsKitEvidenceError);
  await rejectsCode(harness(undefined, { fetch: async () => Response.json(fixture, { headers: { 'content-length': '2097153' } }) }).execute(), 'response_too_large');
  await rejectsCode(harness(undefined, { fetch: async () => new Response(' '.repeat(2097153), { headers: { 'content-type': 'application/json' } }) }).execute(), 'response_too_large');
});

test('caller cancellation prevents a read and timeout errors contain no raw details', async () => {
  const h = harness();
  await rejectsCode(h.execute({}, { ...context, abortSignal: AbortSignal.abort('private reason') }), 'aborted');
  assert.equal(h.requests.length, 0);
  await rejectsCode(harness(undefined, { fetch: async () => { throw new DOMException('secret detail', 'TimeoutError'); } }).execute(), 'timeout');
  await assert.rejects(harness(undefined, { fetch: async () => { throw new Error('credential or subject'); } }).execute(), error => error.code === 'transport_error' && !error.message.includes('credential or subject'));
});

test('the real SDK forwards cancellation and enforces its request timeout', async () => {
  let seenSignal;
  const waitingFetch = async (_url, init) => {
    seenSignal = init.signal;
    return new Promise((_resolve, reject) => {
      if (init.signal.aborted) reject(init.signal.reason);
      else init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
  };
  await rejectsCode(harness(undefined, { fetch: waitingFetch, timeoutMs: 10 }).execute(), 'timeout');
  assert.equal(seenSignal.aborted, true);
  const controller = new AbortController();
  const read = harness(undefined, { fetch: waitingFetch }).execute({}, { ...context, abortSignal: controller.signal });
  controller.abort('private cancellation reason');
  await rejectsCode(read, 'aborted');
});

test('empty HTTP errors preserve authentication status instead of becoming malformed evidence', async () => {
  await assert.rejects(harness(undefined, { fetch: async () => new Response(null, { status: 401 }) }).execute(), error => error.code === 'access_denied' && error.status === 401);
  await assert.rejects(harness(undefined, { fetch: async () => new Response(null, { status: 410 }) }).execute(), error => error.code === 'expired' && error.status === 410);
});

test('timeout bounds a stalled fetch and body, and normalizes native AbortError body failures', async () => {
  await rejectsCode(harness(undefined, { timeoutMs: 10, fetch: async () => new Promise(() => {}) }).execute(), 'timeout');
  let bodyCancelled = false;
  const stalled = new ReadableStream({ cancel() { bodyCancelled = true; } });
  await rejectsCode(harness(undefined, { timeoutMs: 10, fetch: async () => new Response(stalled, { headers: { 'content-type': 'application/json' } }) }).execute(), 'timeout');
  assert.equal(bodyCancelled, true);
  await rejectsCode(harness(undefined, { timeoutMs: 10, fetch: async (_url, init) => new Response(new ReadableStream({
    start(controller) { init.signal.addEventListener('abort', () => controller.error(new DOMException('private timeout detail', 'AbortError')), { once: true }); },
  }), { headers: { 'content-type': 'application/json' } }) }).execute(), 'timeout');
});

test('complete example runs the current AI SDK loop and published SDK transport with no model or API spend', async () => {
  const h = harness();
  const model = new MockLanguageModelV4({ doGenerate: [
    generated([{ type: 'tool-call', toolCallId: 'read-1', toolName: 'sanctionsKitEvidence', input: '{}' }]),
    generated([{ type: 'text', text: 'Synthetic evidence retained for human review.' }]),
  ] });
  const result = await reviewRetainedEvidence(model, h.configured);
  assert.equal(model.doGenerateCalls.length, 2);
  assert.equal(h.requests.length, 1);
  assert.equal(result.steps[0].toolResults[0].output.kind, 'retained_evidence');
  assert.deepEqual(result.steps[0].toolResults[0].output.evidence, fixture);
  const secondInput = JSON.stringify(model.doGenerateCalls[1].prompt);
  assert.ok(secondInput.includes(fixture.result.disclaimer));
  assert.ok(!secondInput.includes(options.apiKey));
  assert.equal(result.text, 'Synthetic evidence retained for human review.');
});

test('AI SDK rejects model-invented ID parameters before API access', async () => {
  const h = harness();
  const model = new MockLanguageModelV4({ doGenerate: generated([{ type: 'tool-call', toolCallId: 'bad-input', toolName: 'evidence', input: '{"resultId":"00000000-0000-4000-8000-000000000999"}' }]) });
  await generateText({ model, tools: { evidence: h.tool }, stopWhen: isStepCount(1), prompt: 'Read selected evidence.' });
  assert.equal(h.requests.length, 0);
});
