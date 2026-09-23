import { Module } from "@nestjs/common";
import { PrismaModule } from "@infrastructure/prisma/prisma.module";
import { PreferenceAuditQueryService } from "./preference-audit-query.service";
import { PreferenceAuditResolver } from "./preference-audit.resolver";

@Module({
  imports: [PrismaModule],
  providers: [
    PreferenceAuditQueryService,
    PreferenceAuditResolver,
  ],
  exports: [PreferenceAuditQueryService],
})
export class PreferenceAuditModule {}
