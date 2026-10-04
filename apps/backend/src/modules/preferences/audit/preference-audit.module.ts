import { Module } from "@nestjs/common";
import { PreferenceAuditQueryService } from "./preference-audit-query.service";
import { PreferenceAuditResolver } from "./preference-audit.resolver";
import { HistoryClearService } from './history-clear.service';

@Module({
  imports: [],
  providers: [
    PreferenceAuditQueryService,
    PreferenceAuditResolver,
    HistoryClearService,
  ],
  exports: [PreferenceAuditQueryService],
})
export class PreferenceAuditModule {}
