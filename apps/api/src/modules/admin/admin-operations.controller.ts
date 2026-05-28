import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { AdminAuditAction, RiskEventStatus, Role } from "@kingspin/db";
import { AdminRbacGuard, AdminRoles } from "../auth-bridge/admin-rbac.guard";
import { AuthGuard } from "../auth-bridge/auth.guard";
import { CurrentAdmin } from "../auth-bridge/current-admin.decorator";
import type { AdminBridgeUser } from "../auth-bridge/auth.types";
import { AuditService } from "../audit/audit.service";
import { FraudService } from "../fraud/fraud.service";
import { AdminOperationsService } from "./admin-operations.service";

@Controller("admin")
@UseGuards(AuthGuard, AdminRbacGuard)
export class AdminOperationsController {
  constructor(
    private readonly adminOperationsService: AdminOperationsService,
    private readonly fraudService: FraudService,
    private readonly auditService: AuditService,
  ) {}

  @Get("dashboard")
  @AdminRoles(Role.ADMIN, Role.SUPPORT, Role.FINANCE, Role.RISK, Role.VIEWER)
  dashboard() {
    return this.adminOperationsService.getDashboard();
  }

  @Get("users")
  @AdminRoles(Role.ADMIN, Role.SUPPORT, Role.RISK, Role.VIEWER)
  users(@Query("search") search?: string) {
    return this.adminOperationsService.listUsers({ search });
  }

  @Get("users/:id")
  @AdminRoles(Role.ADMIN, Role.SUPPORT, Role.FINANCE, Role.RISK, Role.VIEWER)
  user(@Param("id") id: string) {
    return this.adminOperationsService.getUserProfile(id);
  }

  @Patch("users/:id/suspend")
  @AdminRoles(Role.ADMIN, Role.RISK)
  suspendUser(
    @CurrentAdmin() admin: AdminBridgeUser,
    @Param("id") id: string,
  ) {
    return this.adminOperationsService.suspendUser(id, admin.id);
  }

  @Patch("users/:id/unsuspend")
  @AdminRoles(Role.ADMIN, Role.RISK)
  unsuspendUser(
    @CurrentAdmin() admin: AdminBridgeUser,
    @Param("id") id: string,
  ) {
    return this.adminOperationsService.unsuspendUser(id, admin.id);
  }

  @Get("rooms")
  @AdminRoles(Role.ADMIN, Role.SUPPORT, Role.VIEWER)
  rooms() {
    return this.adminOperationsService.listRooms();
  }

  @Get("rounds")
  @AdminRoles(Role.ADMIN, Role.SUPPORT, Role.RISK, Role.VIEWER)
  rounds() {
    return this.adminOperationsService.listRounds();
  }

  @Get("ledger")
  @AdminRoles(Role.ADMIN, Role.FINANCE, Role.SUPPORT, Role.VIEWER)
  ledger(@Query("type") type?: string, @Query("referenceId") referenceId?: string) {
    return this.adminOperationsService.listLedgerTransactions({
      type,
      referenceId,
    });
  }

  @Get("risk")
  @AdminRoles(Role.ADMIN, Role.RISK, Role.SUPPORT, Role.VIEWER)
  risk(@Query("status") status?: RiskEventStatus) {
    return this.fraudService.listRiskEvents({ status });
  }

  @Patch("risk/:id/review")
  @AdminRoles(Role.ADMIN, Role.RISK)
  async reviewRisk(
    @CurrentAdmin() admin: AdminBridgeUser,
    @Param("id") id: string,
    @Body() body: { status?: RiskEventStatus },
  ) {
    const status = body?.status ?? RiskEventStatus.REVIEWED;
    const event = await this.fraudService.reviewRiskEvent(id, admin.id, status);
    const action =
      status === RiskEventStatus.DISMISSED
        ? AdminAuditAction.RISK_EVENT_DISMISSED
        : status === RiskEventStatus.ACTIONED
          ? AdminAuditAction.RISK_EVENT_ACTIONED
          : AdminAuditAction.RISK_EVENT_REVIEWED;

    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action,
      targetType: "RISK_EVENT",
      targetId: id,
      after: event,
    });

    return event;
  }

  @Get("audit")
  @AdminRoles(Role.ADMIN, Role.SUPPORT, Role.FINANCE, Role.RISK, Role.VIEWER)
  audit() {
    return this.adminOperationsService.listAuditLogs();
  }

  @Get("jobs")
  @AdminRoles(Role.ADMIN, Role.SUPPORT, Role.VIEWER)
  jobs() {
    return this.adminOperationsService.listWorkerJobs();
  }
}
