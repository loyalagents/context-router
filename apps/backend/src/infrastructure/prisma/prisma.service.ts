import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "./generated-client";
import { buildPrismaClientOptions } from "./prisma-client-options";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly nodeEnvironment: string;

  constructor(configService: ConfigService) {
    super(
      buildPrismaClientOptions({
        databaseUrl: configService.getOrThrow<string>("DATABASE_URL"),
        log: ["query", "info", "warn", "error"],
      }),
    );
    this.nodeEnvironment =
      configService.get<string>("app.nodeEnv") ?? "development";
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log("Database connection established");
    } catch (error) {
      this.logger.error("Failed to connect to database", error);
      throw error;
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
