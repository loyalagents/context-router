import { Module } from "@nestjs/common";
import { PrismaModule } from "@infrastructure/prisma/prisma.module";
import { PreferenceAuditService } from "./preference-audit.service";

@Module({
  imports: [PrismaModule],
  providers: [PreferenceAuditService],
  exports: [PreferenceAuditService],
})
export class PreferenceAuditModule {}
