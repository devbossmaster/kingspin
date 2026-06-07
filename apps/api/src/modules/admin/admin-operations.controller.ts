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

  @Get("dashboard/summary")
  @AdminRoles(Role.ADMIN, Role.SUPPORT, Role.FINANCE, Role.RISK, Role.VIEWER)
  dashboardSummary() {
    return this.adminOperationsService.getDashboardSummary();
  }

  @Get("dashboard/recent")
  @AdminRoles(Role.ADMIN, Role.SUPPORT, Role.FINANCE, Role.RISK, Role.VIEWER)
  dashboardRecent() {
    return this.adminOperationsService.getDashboardRecentActivity();
  }

  @Get("dashboard")
  @AdminRoles(Role.ADMIN, Role.SUPPORT, Role.FINANCE, Role.RISK, Role.VIEWER)
  dashboard() {
    return this.adminOperationsService.getDashboard();
  }

  @Get("users")
  @AdminRoles(Role.ADMIN, Role.SUPPORT, Role.RISK, Role.VIEWER)
  users(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("q") q?: string,
    @Query("search") search?: string,
    @Query("status") status?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.adminOperationsService.listUsers({
      page,
      pageSize,
      q: q ?? search,
      status,
      from,
      to,
    });
  }

  @Get("players")
  @AdminRoles(Role.ADMIN, Role.SUPPORT, Role.RISK, Role.VIEWER)
  players(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("q") q?: string,
    @Query("status") status?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.adminOperationsService.listUsers({
      page,
      pageSize,
      q,
      status,
      from,
      to,
    });
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

  @Get("rounds")
  @AdminRoles(Role.ADMIN, Role.SUPPORT, Role.RISK, Role.VIEWER)
  rounds(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("q") q?: string,
    @Query("status") status?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.adminOperationsService.listRounds({
      page,
      pageSize,
      q,
      status,
      from,
      to,
    });
  }

  @Get("entries")
  @AdminRoles(Role.ADMIN, Role.SUPPORT, Role.RISK, Role.VIEWER)
  entries(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("q") q?: string,
    @Query("status") status?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.adminOperationsService.listEntries({
      page,
      pageSize,
      q,
      status,
      from,
      to,
    });
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
  risk(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("q") q?: string,
    @Query("status") status?: string,
    @Query("severity") severity?: string,
    @Query("type") type?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.adminOperationsService.listRiskEvents({
      page,
      pageSize,
      q,
      status,
      severity,
      type,
      from,
      to,
    });
  }

  @Patch("risk/:id/review")
  @AdminRoles(Role.ADMIN, Role.RISK)
  async reviewRisk(
    @CurrentAdmin() admin: AdminBridgeUser,
    @Param("id") id: string,
    @Body() body: { status?: RiskEventStatus; note?: string },
  ) {
    const status = body?.status ?? RiskEventStatus.REVIEWED;
    const event = await this.fraudService.reviewRiskEvent(
      id,
      admin.id,
      status,
      body?.note,
    );
    const action =
      status === RiskEventStatus.DISMISSED
        ? AdminAuditAction.RISK_EVENT_DISMISSED
        : status === RiskEventStatus.ACTIONED ||
            status === RiskEventStatus.RESOLVED
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
  audit(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("q") q?: string,
    @Query("action") action?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.adminOperationsService.listAuditLogs({
      page,
      pageSize,
      q,
      action,
      from,
      to,
    });
  }

  @Get("health/summary")
  @AdminRoles(Role.ADMIN, Role.SUPPORT, Role.VIEWER)
  healthSummary() {
    return this.adminOperationsService.getHealthSummary();
  }

  @Get("settings")
  @AdminRoles(Role.ADMIN, Role.SUPPORT, Role.FINANCE, Role.RISK, Role.VIEWER)
  settings() {
    return this.adminOperationsService.getSettingsSummary();
  }

  @Get("jobs")
  @AdminRoles(Role.ADMIN, Role.SUPPORT, Role.VIEWER)
  jobs() {
    return this.adminOperationsService.listWorkerJobs();
  }
}
