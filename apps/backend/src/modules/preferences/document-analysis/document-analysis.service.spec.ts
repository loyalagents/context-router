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
    ['unavailable', AnalysisStatus.AI_ERROR, 'AI service unavailable - please try again later'],
  ] as const)('maps %s to the retained public envelope', async (kind, status, statusReason) => {
    const extraction = { extractPreferences: jest.fn().mockRejectedValue(new AiError(kind)) };
    const service = new DocumentAnalysisService(extraction as unknown as PreferenceExtractionService);
    const result = await service.analyzeDocument('user', Buffer.from('synthetic'), 'text/plain', 'synthetic.txt');
    expect(result).toMatchObject({ status, statusReason, suggestions: [], filteredSuggestions: [], filteredCount: 0 });
    expect(result.documentSummary).toBeUndefined();
  });
});
