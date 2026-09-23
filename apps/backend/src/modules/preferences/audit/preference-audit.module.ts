import { Module } from "@nestjs/common";
import { PreferenceAuditQueryService } from "./preference-audit-query.service";
import { PreferenceAuditResolver } from "./preference-audit.resolver";

@Module({
  imports: [],
  providers: [
    PreferenceAuditQueryService,
    PreferenceAuditResolver,
  ],
  exports: [PreferenceAuditQueryService],
})
export class PreferenceAuditModule {}
