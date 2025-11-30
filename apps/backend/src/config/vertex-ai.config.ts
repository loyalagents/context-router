export interface VertexAiConfig {
  projectId: string;
  region: string;
  modelId: string;
}

export const getVertexAiConfig = (): VertexAiConfig => ({
  projectId: process.env.GCP_PROJECT_ID ?? '',
  region: process.env.VERTEX_REGION ?? 'us-central1',
  modelId: process.env.VERTEX_MODEL_ID ?? 'gemini-2.5-flash-lite',
});
