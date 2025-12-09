# Revised Strategy: Preference Extraction via Document Upload

## Core Philosophy: "Hybrid" Architecture
We will use a pragmatic mix of **REST** for the file infrastructure and **GraphQL** for the data application. This avoids the complexity of `graphql-upload` while maintaining the clean data graph of the application.

### The Flow
1.  **Upload (REST):** Frontend sends `POST /api/preferences/analysis` with the file.
2.  **Analyze (Stateless):** Backend streams file buffer to Vertex AI (Gemini 1.5 Flash).
3.  **Response (JSON):** Backend returns structured JSON suggestions.
4.  **Review (UI):** User reviews the "Diff" in the frontend form.
5.  **Save (GraphQL):** User accepts changes; Frontend calls `mutation createPreferences`.

---

## 1. Backend Implementation

### A. The Controller (REST)
**Location:** `apps/backend/src/modules/preferences/document-analysis/document-analysis.controller.ts`

Instead of a Resolver, we use a standard NestJS Controller to handle `multipart/form-data`. This leverages standard streams and avoids GraphQL middleware conflicts.

```typescript
import { Controller, Post, UploadedFile, UseInterceptors, UseGuards, Req } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard'; // Adjust path
import { VertexAiService } from '../../../modules/vertex-ai/vertex-ai.service'; // Adjust path

@Controller('preferences/analysis')
@UseGuards(JwtAuthGuard)
export class DocumentAnalysisController {
  constructor(private readonly vertexAiService: VertexAiService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
  }))
  async analyzeDocument(@UploadedFile() file: Express.File, @Req() req) {
    if (!file) throw new Error('File is required');
    
    // Pass the raw buffer directly to Vertex AI
    return this.vertexAiService.extractPreferences({
      fileBuffer: file.buffer,
      mimeType: file.mimetype,
      userId: req.user.id
    });
  }
}