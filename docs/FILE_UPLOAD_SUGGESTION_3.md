# Revised Strategy: Preference Extraction via Document Upload

## 1. Core Optimization: Native Multimodal Processing
**Change from previous plan:** We are removing the `DocumentTextExtractionService`.
**Reason:** Vertex AI (Gemini 1.5 Flash) is multimodal. Passing the raw PDF/Image buffer directly to the model preserves layout context (checkboxes, tables, headers) that is often lost during manual text extraction.

**The Flow:**
1.  **Upload (REST):** Frontend sends file -> Backend Controller.
2.  **Stream (Memory):** Controller passes `Buffer` -> Vertex AI Service.
3.  **Analyze (AI):** Gemini reads the binary directly -> Returns JSON.
4.  **Review (UI):** User confirms changes.
5.  **Save (GraphQL):** Frontend sends approved changes -> Database.

---

## 2. Updated File Structure

Files marked with **(+)** are new. Files marked with **(M)** are modified.

### Backend (`apps/backend/src`)
```text
modules/
├── preferences/
│   ├── preferences.module.ts (M)            # Import DocumentAnalysisModule here
│   ├── preference/
│   │   ├── preference.resolver.ts (M)       # Add `applyPreferenceSuggestions` mutation
│   │   └── preference.service.ts (M)        # Add logic to handle bulk apply
│   │
│   └── document-analysis/                   # (+) NEW MODULE
│       ├── document-analysis.module.ts      # (+)
│       ├── document-analysis.controller.ts  # (+) REST Endpoint (POST /analysis)
│       ├── document-analysis.service.ts     # (+) Orchestration (File -> Vertex -> DTO)
│       └── dto/
│           ├── analysis-response.dto.ts     # (+) JSON response shape for UI
│           └── apply-suggestion.input.ts    # (+) Input for the GraphQL mutation
│
├── vertex-ai/
│   └── vertex-ai.service.ts (M)             # Update to accept `Buffer` + `MimeType`
│
└── common/interfaces/
    └── ai-model.interface.ts (M)            # Update Port to support binary input

    dashboard/profile/
├── page.tsx (M)                             # Import the new wrapper component
└── components/
    └── PreferenceAnalysis/                  # (+) NEW COMPONENT FOLDER
        ├── DocumentUpload.tsx               # (+) File picker / Drag-n-Drop area
        ├── SuggestionReview.tsx             # (+) The "Diff" View (Old vs New)
        └── SuggestionItem.tsx               # (+) Individual row with Checkbox