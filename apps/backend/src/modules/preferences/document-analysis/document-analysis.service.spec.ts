import { AiError } from '../../../domains/shared/ports/ai-execution';
import { DocumentAnalysisService } from './document-analysis.service';
import { PreferenceExtractionService } from './preference-extraction.service';
import { AnalysisStatus } from './dto/document-analysis-result.dto';

describe('DocumentAnalysisService local errors', () => {
  it.each([
    ['invalid_response', AnalysisStatus.PARSE_ERROR, 'AI response could not be parsed - please try again'],
    ['unsupported', AnalysisStatus.AI_ERROR, 'AI could not analyze this uploaded file type. Please try converting it to plain text before uploading again.'],
    ['cancelled', AnalysisStatus.AI_ERROR, 'Document analysis cancelled. No proposals were published.'],
    ['deadline', AnalysisStatus.AI_ERROR, 'Document analysis reached its deadline. No proposals were published.'],
    ['input_limit', AnalysisStatus.AI_ERROR, 'Document analysis input is too large. Try a smaller document.'],
    ['context_limit', AnalysisStatus.AI_ERROR, 'Document analysis exceeds the local model context. Try a smaller document.'],
    ['busy', AnalysisStatus.AI_ERROR, 'The local model is busy. Wait for the current operation to finish.'],
    ['unavailable', AnalysisStatus.AI_ERROR, 'The local model is unavailable. Check its setup. If a model session is already configured, follow the manual recovery instructions.'],
    ['unsafe_configuration', AnalysisStatus.AI_ERROR, 'The local model configuration is unavailable. Check its setup. If a model session is already configured, follow the manual recovery instructions.'],
  ] as const)('maps %s to the retained public envelope', async (kind, status, statusReason) => {
    const extraction = { extractPreferences: jest.fn().mockRejectedValue(new AiError(kind)) };
    const service = new DocumentAnalysisService(extraction as unknown as PreferenceExtractionService, { prepare: jest.fn() } as any);
    const result = await service.analyzeDocument('user', Buffer.from('synthetic'), 'text/plain', 'synthetic.txt');
    expect(result).toMatchObject({ status, statusReason, failureCategory: kind, suggestions: [], filteredSuggestions: [], filteredCount: 0 });
    expect(result.documentSummary).toBeUndefined();
  });

  it('preserves the hosted generic failure envelope without exposing the cause', async () => {
    const extraction = { extractPreferences: jest.fn().mockRejectedValue(new Error('private provider details')) };
    const service = new DocumentAnalysisService(extraction as unknown as PreferenceExtractionService, { prepare: jest.fn() } as any);
    const result = await service.analyzeDocument('user', Buffer.from('synthetic'), 'text/plain', 'synthetic.txt');
    expect(result).toMatchObject({ status: AnalysisStatus.AI_ERROR,
      statusReason: 'AI service unavailable - please try again later', suggestions: [], filteredSuggestions: [] });
    expect(JSON.stringify(result)).not.toContain('private provider details');
  });
});

describe('DocumentAnalysisService reviewed descriptors', () => {
  it('binds displayed operation and before-state after extraction to the server review snapshot', async () => {
    const suggestion = { id: 'suggestion-1', slug: 'profile.first_name', operation: 'CREATE', newValue: 'Synthetic' };
    const extraction = { extractPreferences: jest.fn().mockResolvedValue({ suggestions: [suggestion], filteredSuggestions: [], filteredCount: 0, documentSummary: 'Synthetic' }) };
    const reviewed = { prepare: jest.fn().mockImplementation(async (_user, items) => items.map((item) => ({ ...item, operation: 'UPDATE', oldValue: 'Latest reviewed', review: { definitionId: 'definition', expectedPreferenceId: 'row', expectedRevision: 'revision' } }))) };
    const service = new DocumentAnalysisService(extraction as any, reviewed as any);
    const result = await service.analyzeDocument('owner', Buffer.from('synthetic'), 'text/plain', 'synthetic.txt');
    expect(reviewed.prepare).toHaveBeenCalledWith('owner', [expect.objectContaining({ id: `${result.analysisId}:suggestion-1` })]);
    expect(result.suggestions[0]).toMatchObject({ operation: 'UPDATE', oldValue: 'Latest reviewed', review: { expectedPreferenceId: 'row' } });
  });
});


describe('DocumentAnalysisService final publication controls', () => {
  it.each(['cancelled', 'deadline'] as const)('rejects %s after the review snapshot finishes', async (kind) => {
    const controller = new AbortController();
    const options = { signal: controller.signal, deadline: performance.now() + 10000 };
    const extraction = { extractPreferences: jest.fn().mockResolvedValue({ suggestions: [{ id: 'synthetic' }], filteredSuggestions: [], filteredCount: 0, documentSummary: 'DO NOT PUBLISH' }) };
    const reviewed = { prepare: jest.fn().mockImplementation(async (_owner, items) => {
      if (kind === 'cancelled') controller.abort(); else options.deadline = 0;
      return items;
    }) };
    const result = await new DocumentAnalysisService(extraction as any, reviewed as any).analyzeDocument('owner', Buffer.from('synthetic'), 'text/plain', 'synthetic.txt', options);
    expect(result).toMatchObject({ status: AnalysisStatus.AI_ERROR, failureCategory: kind, suggestions: [] });
    expect(JSON.stringify(result)).not.toContain('DO NOT PUBLISH');
    expect(extraction.extractPreferences).toHaveBeenCalledWith('owner', expect.any(Buffer), 'text/plain', 'synthetic.txt', options);
  });
});
