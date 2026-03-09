import { createWorkshopClient, type WorkshopPreference } from "../../src";

const base = createWorkshopClient({
  baseUrl: "https://api.example.com",
  apiKey: "group-key",
  fetch: globalThis.fetch,
});

void base.users();
const client = base.withUser("user-1");
void client.catalog();
void client.me();
void client.activePreferences();
void client.setPreference({ slug: "system.response_tone", value: "casual" });
void client.analyzeDocument({
  file: new Blob(["profile"]),
  filename: "profile.txt",
});

const nullablePreference: WorkshopPreference = {
  id: "pref-1",
  userId: "user-1",
  locationId: null,
  slug: "system.response_tone",
  definitionId: "def-1",
  value: "casual",
  status: "ACTIVE",
  sourceType: "USER",
  confidence: null,
  evidence: null,
  createdAt: "2026-03-08T00:00:00.000Z",
  updatedAt: "2026-03-08T00:00:00.000Z",
  category: null,
  description: null,
};

void nullablePreference;

// @ts-expect-error catalog is user-scoped only
void base.catalog();
