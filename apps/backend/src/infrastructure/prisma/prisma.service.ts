import {
  Inject,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "./generated-client";

type DirectPrismaClientOptions = Extract<
  Prisma.PrismaClientOptions,
  { adapter: unknown }
>;

export const PRISMA_SERVICE_CONFIGURATION =
  "context-router.prisma-service-configuration";

export interface PrismaServiceConfiguration {
  clientOptions: DirectPrismaClientOptions;
  nodeEnvironment: string;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly nodeEnvironment: string;

  constructor(
    @Inject(PRISMA_SERVICE_CONFIGURATION)
    configuration: PrismaServiceConfiguration,
  ) {
    super(configuration.clientOptions);
    this.nodeEnvironment = configuration.nodeEnvironment;
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log("Database connection established");
    } catch {
      this.logger.error("Failed to connect to database");
      throw new Error("Database connection failed");
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log("Database connection closed");
  }

  async cleanDatabase() {
    if (this.nodeEnvironment === "production") {
      throw new Error("Cannot clean database in production");
    }

    const models = Reflect.ownKeys(this).filter(
      (key) => typeof key === "string" && key[0] !== "_" && key[0] !== "$",
    );

    return Promise.all(
      models.map((modelKey) => {
        const model = this[modelKey as string];
        if (model && typeof model.deleteMany === "function") {
          return model.deleteMany();
        }
      }),
    );
  }
}
