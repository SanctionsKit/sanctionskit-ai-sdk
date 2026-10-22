import { generateText, type LanguageModel } from 'ai';
import { sanctionsKitEvidence, type SanctionsKitEvidenceOptions, type SanctionsKitEvidenceOutput } from 'sanctionskit-ai-sdk';

declare const model: LanguageModel;
const shared = { apiKey: 'sk_test_nonfunctional_fixture', resultId: '00000000-0000-4000-8000-000000000001', allowModelAccessToEvidence: true as const };
const sandbox = sanctionsKitEvidence({ ...shared, environment: 'sandbox' });
const production = sanctionsKitEvidence({ ...shared, apiKey: 'sk_live_nonfunctional_fixture', environment: 'production', allowProduction: true });
void generateText({ model, tools: { sandbox, production }, prompt: 'Review evidence.' });
// @ts-expect-error production requires a separate explicit opt-in
const missingProductionOptIn: SanctionsKitEvidenceOptions = { ...shared, environment: 'production' };
// @ts-expect-error evidence sharing must be explicitly enabled
const missingEvidenceOptIn: SanctionsKitEvidenceOptions = { apiKey: 'sk_test_fixture', resultId: shared.resultId, environment: 'sandbox' };
declare const output: SanctionsKitEvidenceOutput;
const noCurrentCheck: false = output.interpretation.currentScreeningPerformed;
const manualReview: true = output.interpretation.humanReviewRequired;
void [missingProductionOptIn, missingEvidenceOptIn, noCurrentCheck, manualReview];
