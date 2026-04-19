import { Module } from "@nestjs/common";
import { PrismaModule } from "@infrastructure/prisma/prisma.module";
import { PreferenceAuditService } from "./preference-audit.service";
import { PreferenceAuditQueryService } from "./preference-audit-query.service";
import { PreferenceAuditResolver } from "./preference-audit.resolver";

@Module({
  imports: [PrismaModule],
  providers: [
    PreferenceAuditService,
    PreferenceAuditQueryService,
    PreferenceAuditResolver,
  ],
  exports: [PreferenceAuditService, PreferenceAuditQueryService],
})
export class PreferenceAuditModule {}
