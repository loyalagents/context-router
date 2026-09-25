import { AiError } from '../../../domains/shared/ports/ai-execution';
import { DocumentAnalysisService } from './document-analysis.service';
import { PreferenceExtractionService } from './preference-extraction.service';
import { AnalysisStatus } from './dto/document-analysis-result.dto';

describe('DocumentAnalysisService local errors', () => {
  it.each([
    ['invalid_response', AnalysisStatus.PARSE_ERROR, 'AI response could not be parsed - please try again'],
    ['unsupported', AnalysisStatus.AI_ERROR, 'AI could not analyze this uploaded file type. Please try converting it to plain text before uploading again.'],
    ['cancelled', AnalysisStatus.AI_ERROR, 'AI service unavailable - please try again later'],
    ['deadline', AnalysisStatus.AI_ERROR, 'AI service unavailable - please try again later'],
    ['input_limit', AnalysisStatus.AI_ERROR, 'Document analysis input is too large. Try a smaller document.'],
    ['context_limit', AnalysisStatus.AI_ERROR, 'Document analysis exceeds the local model context. Try a smaller document.'],
    ['busy', AnalysisStatus.AI_ERROR, 'The local model is busy. Wait for the current operation to finish.'],
    ['unavailable', AnalysisStatus.AI_ERROR, 'The local model is unavailable. Check its setup and manual session recovery instructions.'],
    ['unsafe_configuration', AnalysisStatus.AI_ERROR, 'The local model configuration is unavailable. Check its setup and manual session recovery instructions.'],
  ] as const)('maps %s to the retained public envelope', async (kind, status, statusReason) => {
    const extraction = { extractPreferences: jest.fn().mockRejectedValue(new AiError(kind)) };
    const service = new DocumentAnalysisService(extraction as unknown as PreferenceExtractionService);
    const result = await service.analyzeDocument('user', Buffer.from('synthetic'), 'text/plain', 'synthetic.txt');
    expect(result).toMatchObject({ status, statusReason, suggestions: [], filteredSuggestions: [], filteredCount: 0 });
    expect(result.documentSummary).toBeUndefined();
  });

  it('preserves the hosted generic failure envelope without exposing the cause', async () => {
    const extraction = { extractPreferences: jest.fn().mockRejectedValue(new Error('private provider details')) };
    const service = new DocumentAnalysisService(extraction as unknown as PreferenceExtractionService);
    const result = await service.analyzeDocument('user', Buffer.from('synthetic'), 'text/plain', 'synthetic.txt');
    expect(result).toMatchObject({ status: AnalysisStatus.AI_ERROR,
      statusReason: 'AI service unavailable - please try again later', suggestions: [], filteredSuggestions: [] });
    expect(JSON.stringify(result)).not.toContain('private provider details');
  });
});
