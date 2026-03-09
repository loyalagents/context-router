import { mapCatalogEntries, validatePreferenceValue } from "./catalog";
import {
  executeGraphql,
  executeUpload,
  resolveClientConfig,
  type ResolvedWorkshopClientConfig,
} from "./http";
import {
  ACTIVE_PREFERENCES_QUERY,
  EXPORT_PREFERENCE_SCHEMA_QUERY,
  GROUP_USERS_QUERY,
  ME_QUERY,
  SET_PREFERENCE_MUTATION,
} from "./operations";
import {
  WorkshopBaseClient,
  WorkshopClientConfig,
  WorkshopClientError,
  WorkshopDocumentAnalysisResult,
  WorkshopPreference,
  WorkshopUser,
  WorkshopUserClient,
} from "./types";

interface GroupUsersResponse {
  groupUsers: WorkshopUser[];
}

interface MeResponse {
  me: WorkshopUser;
}

interface ExportPreferenceSchemaResponse {
  exportPreferenceSchema: Array<{
    slug: string;
    displayName?: string | null;
    ownerUserId?: string | null;
    description: string;
    valueType: "STRING" | "BOOLEAN" | "ENUM" | "ARRAY";
    scope: "GLOBAL" | "LOCATION";
    options?: unknown;
  }>;
}

interface ActivePreferencesResponse {
  activePreferences: WorkshopPreference[];
}

interface SetPreferenceResponse {
  setPreference: WorkshopPreference;
}

class WorkshopBaseClientImpl implements WorkshopBaseClient {
  constructor(private readonly config: ResolvedWorkshopClientConfig) {}

  async users(): Promise<WorkshopUser[]> {
    const data = await executeGraphql<GroupUsersResponse>(this.config, {
      operation: "users",
      query: GROUP_USERS_QUERY,
      variables: { apiKey: this.config.apiKey },
    });
    return data.groupUsers;
  }

  withUser(userId: string): WorkshopUserClient {
    if (typeof userId !== "string" || userId.trim() === "") {
      throw new WorkshopClientError({
        kind: "config",
        message: "userId is required",
        operation: "withUser",
      });
    }

    return new WorkshopUserClientImpl(this.config, userId.trim());
  }
}

class WorkshopUserClientImpl implements WorkshopUserClient {
  constructor(
    private readonly config: ResolvedWorkshopClientConfig,
    private readonly userId: string,
  ) {}

  async catalog() {
    const data = await executeGraphql<ExportPreferenceSchemaResponse>(this.config, {
      operation: "catalog",
      query: EXPORT_PREFERENCE_SCHEMA_QUERY,
      variables: { scope: "ALL" },
      userId: this.userId,
    });
    return mapCatalogEntries(data.exportPreferenceSchema);
  }

  async me(): Promise<WorkshopUser> {
    const data = await executeGraphql<MeResponse>(this.config, {
      operation: "me",
      query: ME_QUERY,
      userId: this.userId,
    });
    return data.me;
  }

  async activePreferences(): Promise<WorkshopPreference[]> {
    const data = await executeGraphql<ActivePreferencesResponse>(this.config, {
      operation: "activePreferences",
      query: ACTIVE_PREFERENCES_QUERY,
      userId: this.userId,
    });
    return data.activePreferences;
  }

  async setPreference(input: {
    slug: string;
    value: unknown;
  }): Promise<WorkshopPreference> {
    const catalog = await this.catalog();
    validatePreferenceValue(catalog, input);

    const data = await executeGraphql<SetPreferenceResponse>(this.config, {
      operation: "setPreference",
      query: SET_PREFERENCE_MUTATION,
      variables: {
        input: {
          slug: input.slug,
          value: input.value,
        },
      },
      userId: this.userId,
    });
    return data.setPreference;
  }

  async analyzeDocument(input: {
    file: Blob;
    filename?: string;
  }): Promise<WorkshopDocumentAnalysisResult> {
    const filename = resolveFilename(input.file, input.filename);
    const formData = new FormData();
    formData.append("file", input.file, filename);

    return executeUpload<WorkshopDocumentAnalysisResult>(this.config, {
      operation: "analyzeDocument",
      userId: this.userId,
      body: formData,
    });
  }
}

export function createWorkshopClient(
  config: WorkshopClientConfig,
): WorkshopBaseClient {
  return new WorkshopBaseClientImpl(resolveClientConfig(config));
}

function resolveFilename(file: Blob, filename?: string): string {
  if (typeof filename === "string" && filename.trim() !== "") {
    return filename.trim();
  }

  const maybeNamedFile = file as Blob & { name?: string };
  if (typeof maybeNamedFile.name === "string" && maybeNamedFile.name !== "") {
    return maybeNamedFile.name;
  }

  throw new WorkshopClientError({
    kind: "config",
    message: "analyzeDocument requires filename when file.name is unavailable",
    operation: "analyzeDocument",
  });
}
