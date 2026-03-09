# `@loyalagents/context-router-workshop-client`

Workshop-focused TypeScript client for Context Router. It wraps the existing GraphQL and upload APIs so workshop consumers do not need Apollo, handwritten GraphQL, or custom auth header logic.

In the repository, implementation context lives in `docs/package/workshop_client_context.md`.
In the repository, smoke and verification commands live in `docs/package/smoke_test.md`.

## Install From A Tarball

```bash
pnpm add ./dist/workshop-client/loyalagents-context-router-workshop-client-<version>.tgz
```

## Plain TypeScript Happy Path

```ts
import { createWorkshopClient } from "@loyalagents/context-router-workshop-client";

const base = createWorkshopClient({
  baseUrl: process.env.CONTEXT_ROUTER_BASE_URL!,
  apiKey: process.env.CONTEXT_ROUTER_API_KEY!,
});

const users = await base.users();
const client = base.withUser(users[0]!.userId);

const catalog = await client.catalog();
const chosen = [...catalog]
  .sort((left, right) => left.slug.localeCompare(right.slug))
  .find(
    (entry) =>
      entry.valueType !== "ENUM" ||
      (Array.isArray(entry.options) && entry.options.length > 0),
  );

if (!chosen) {
  throw new Error("No writable GLOBAL preference definitions are visible");
}

await client.me();
await client.activePreferences();
await client.setPreference({
  slug: chosen!.slug,
  value:
    chosen!.valueType === "ENUM"
      ? chosen!.options![0]
      : chosen!.valueType === "BOOLEAN"
        ? true
        : chosen!.valueType === "ARRAY"
          ? ["workshop-example"]
          : "workshop-example",
});
```

## Next.js Example

```ts
import { createWorkshopClient } from "@loyalagents/context-router-workshop-client";

export async function loadWorkshopData() {
  const base = createWorkshopClient({
    baseUrl: process.env.CONTEXT_ROUTER_BASE_URL!,
    apiKey: process.env.CONTEXT_ROUTER_API_KEY!,
  });

const users = await base.users();
const client = base.withUser(users[0]!.userId);
const catalog = await client.catalog();

return {
  me: await client.me(),
  catalog,
  activePreferences: await client.activePreferences(),
};
}
```

## Upload Examples

Browser `File`:

```ts
await client.analyzeDocument({
  file: input.files![0]!,
});
```

Generic `Blob`:

```ts
await client.analyzeDocument({
  file: new Blob(["example"], { type: "text/plain" }),
  filename: "example.txt",
});
```

## Maintainer Update Flow

When updating the package:

1. Edit package code in `packages/workshop-client/src/` and update tests in `packages/workshop-client/test/`.
2. Update this README and `docs/package/workshop_client_context.md` if the public API or behavior changed.
3. Bump the version in `packages/workshop-client/package.json` if you need a new tarball filename for consumers.
4. From the repo root, run:

```bash
pnpm test:workshop-client
pnpm build:workshop-client
pnpm pack:workshop-client
```

5. Distribute the generated tarball from `dist/workshop-client/`.

Notes:
- `pnpm pack:workshop-client` rebuilds before packing.
- GitHub Actions also runs the package test, build, and pack steps on pushes and pull requests.

## Notes

- v1 is global-only in public behavior. Location-scoped definitions are filtered out of `catalog()` and are not exposed through the workshop API.
- `catalog()` is selected-user-specific and async. Call `await client.catalog()` before choosing a slug.
- `catalog()` uses the selected user’s visible schema export, so personal definitions can appear when that user owns them.
- User-scoped methods automatically send `Authorization: Bearer <apiKey>` and `X-User-Id: <userId>`.
