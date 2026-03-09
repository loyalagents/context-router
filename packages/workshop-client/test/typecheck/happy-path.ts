import { createWorkshopClient } from "../../src";

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

// @ts-expect-error catalog is user-scoped only
void base.catalog();
