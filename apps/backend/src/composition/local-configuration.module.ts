import { DynamicModule, Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { createDocumentUploadConfiguration } from "../config/document-upload.config";
import { createFormFillConfiguration } from "../config/form-fill.config";

type LocalApplicationConfiguration = Record<string, unknown>;

const LOCAL_DOCUMENT_UPLOAD_CONFIGURATION = createDocumentUploadConfiguration(
  Object.create(null),
);
Object.freeze(LOCAL_DOCUMENT_UPLOAD_CONFIGURATION.allowedMimeTypes);
Object.freeze(LOCAL_DOCUMENT_UPLOAD_CONFIGURATION);

const LOCAL_FORM_FILL_CONFIGURATION = createFormFillConfiguration(
  Object.create(null),
);
Object.freeze(LOCAL_FORM_FILL_CONFIGURATION.allowedMimeTypes);
Object.freeze(LOCAL_FORM_FILL_CONFIGURATION);

export const LOCAL_APPLICATION_CONFIGURATION = Object.freeze({
  app: Object.freeze({
    nodeEnv: "production",
    port: 0,
    isDevelopment: false,
    isProduction: true,
    enableDemoReset: false,
  }),
  graphql: Object.freeze({
    playground: false,
    debug: false,
    introspection: false,
  }),
  documentUpload: LOCAL_DOCUMENT_UPLOAD_CONFIGURATION,
  formFill: LOCAL_FORM_FILL_CONFIGURATION,
  mcp: Object.freeze({
    tools: Object.freeze({
      preferences: Object.freeze({
        maxSearchResults: 100,
      }),
    }),
  }),
});

function getOwnPath(root: Record<string, unknown>, path: string): unknown {
  let current: unknown = root;
  for (const segment of path.split(".")) {
    if (
      typeof current !== "object" ||
      current === null ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export class LocalConfigurationService {
  constructor(private readonly values: LocalApplicationConfiguration) {}

  get<T = unknown>(propertyPath: string): T | undefined;
  get<T = unknown>(propertyPath: string, defaultValue: T): T;
  get<T = unknown>(propertyPath: string, defaultValue?: T): T | undefined {
    const value = getOwnPath(this.values, propertyPath);
    return value === undefined ? defaultValue : (value as T);
  }

  getOrThrow<T = unknown>(propertyPath: string): T {
    const value = this.get<T>(propertyPath);
    if (value === undefined) {
      throw new Error("Local application configuration is incomplete");
    }
    return value;
  }
}

@Global()
@Module({})
export class LocalConfigurationModule {
  static register(): DynamicModule {
    return {
      module: LocalConfigurationModule,
      global: true,
      providers: [
        {
          provide: LocalConfigurationService,
          useFactory: () =>
            new LocalConfigurationService(LOCAL_APPLICATION_CONFIGURATION),
        },
        {
          provide: ConfigService,
          useExisting: LocalConfigurationService,
        },
      ],
      exports: [ConfigService, LocalConfigurationService],
    };
  }
}
