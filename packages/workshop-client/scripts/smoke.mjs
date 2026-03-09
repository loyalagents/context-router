import { createWorkshopClient } from "../dist/index.js";

const baseUrl = requireEnv("WORKSHOP_CLIENT_SMOKE_BASE_URL");
const apiKey = requireEnv("WORKSHOP_CLIENT_SMOKE_API_KEY");
const explicitUserId = process.env.WORKSHOP_CLIENT_SMOKE_USER_ID;

async function main() {
  const base = createWorkshopClient({ baseUrl, apiKey });
  const users = await base.users();
  if (users.length === 0) {
    throw new Error("Smoke failed: users() returned no users");
  }

  const chosenUserId = explicitUserId ?? users[0]?.userId;
  if (!chosenUserId) {
    throw new Error("Smoke failed: could not choose a userId");
  }

  const client = base.withUser(chosenUserId);
  const me = await client.me();
  const catalog = await client.catalog();
  const preferences = await client.activePreferences();

  if (catalog.length === 0) {
    throw new Error("Smoke failed: catalog() returned no global definitions");
  }

  const targetEntry = pickWritableCatalogEntry(catalog);
  if (!targetEntry) {
    throw new Error("Smoke failed: could not choose a catalog entry");
  }

  const preference = await client.setPreference({
    slug: targetEntry.slug,
    value: exampleValueForCatalogEntry(targetEntry),
  });

  console.log(
    JSON.stringify(
      {
        userCount: users.length,
        selectedUserId: chosenUserId,
        me,
        catalogCount: catalog.length,
        activePreferenceCount: preferences.length,
        setPreferenceSlug: preference.slug,
      },
      null,
      2,
    ),
  );
}

function exampleValueForCatalogEntry(entry) {
  switch (entry.valueType) {
    case "BOOLEAN":
      return true;
    case "ARRAY":
      return ["workshop-smoke"];
    case "ENUM":
      return entry.options?.[0] ?? "example";
    case "STRING":
    default:
      return "workshop-smoke";
  }
}

function pickWritableCatalogEntry(catalog) {
  return [...catalog]
    .sort((left, right) => left.slug.localeCompare(right.slug))
    .find(
      (entry) =>
        entry.valueType !== "ENUM" ||
        (Array.isArray(entry.options) && entry.options.length > 0),
    );
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
