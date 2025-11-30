
- Add richer input/output DTOs under `modules/vertex-ai/dto/`.
- Inject `'AiTextGeneratorPort'` into domain services (e.g. preferences, user) for higher-level workflows (unstructured → structured → DB).
- Swap `VertexAiService` with another implementation (AI Gateway, different provider) by rebinding the `'AiTextGeneratorPort'` token in `VertexAiModule`.



Longer description:

# Vertex AI – Next Steps (DTOs + Domain Integration)

## 1. Vertex AI DTOs (modules/vertex-ai)

- [ ] Create `apps/backend/src/modules/vertex-ai/dto/ask-vertex-ai.input.ts`
  - Fields:
    - `message: string`
    - `systemPrompt?: string`
    - `temperature?: number`
    - `maxOutputTokens?: number`
- [ ] Create `apps/backend/src/modules/vertex-ai/dto/ask-vertex-ai.output.ts`
  - Fields (for now):
    - `text: string`
    - `model?: string`
    - `inputTokens?: number`
    - `outputTokens?: number`
- [ ] Update `VertexAiResolver` to:
  - Accept `AskVertexAiInput` as `input`.
  - Return `AskVertexAiOutput`.
  - Pass options through to `VertexAiService.generateText(...)`.

## 2. Use AiTextGeneratorPort in Domain Services

### Preferences example (unstructured → structured → DB)

- [ ] Create DTOs in `apps/backend/src/modules/preferences/dto/`:
  - `ingest-preferences.input.ts`
    - `userId: string`
    - `text: string` (unstructured)
  - `ingest-preferences.output.ts`
    - `preferences: PreferenceModel[]`
- [ ] Add `PreferenceIngestionService` in `apps/backend/src/modules/preferences/`:
  - Inject `'AiTextGeneratorPort'` and `PreferenceRepository`.
  - Build a prompt that asks the model to return **JSON** with a `preferences` array.
  - Call `ai.generateText(prompt)`.
  - `JSON.parse` the result and validate shape.
  - Persist via `preferenceRepository.createManyForUser(...)`.
- [ ] Wire `PreferenceIngestionService` into `PreferencesModule` providers.
- [ ] Extend `PreferenceResolver`:
  - Add `ingestPreferences(input: IngestPreferencesInput): IngestPreferencesOutput`.
  - Call `PreferenceIngestionService.ingestFromText(userId, text)`.

## 3. Later Enhancements

- [ ] Add token usage + model name into `AskVertexAiOutput`.
- [ ] Reuse `'AiTextGeneratorPort'` in other domains (e.g. locations, user profile summarization).
- [ ] Optionally add a second implementation (Claude / AI Gateway) and swap via DI.
