import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AdminAuditAction,
  DepositStatus,
  Role,
  WithdrawalStatus,
} from '@kingspin/db';
import { AdminRbacGuard, AdminRoles } from '../auth-bridge/admin-rbac.guard';
import { AuthGuard } from '../auth-bridge/auth.guard';
import { CurrentAdmin } from '../auth-bridge/current-admin.decorator';
import type { AdminBridgeUser } from '../auth-bridge/auth.types';
import { AuditService } from '../audit/audit.service';
import { DepositsService } from './deposits.service';
import { WithdrawalsService } from './withdrawals.service';

@Controller('admin/payments')
@UseGuards(AuthGuard, AdminRbacGuard)
export class AdminPaymentsController {
  constructor(
    private readonly depositsService: DepositsService,
    private readonly withdrawalsService: WithdrawalsService,
    private readonly auditService: AuditService,
  ) {}

  @Get('deposits')
  @AdminRoles(Role.ADMIN, Role.FINANCE, Role.SUPPORT, Role.VIEWER)
  listDeposits(
    @Query('status') status?: DepositStatus,
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.depositsService.listAdminDeposits({
      status,
      userId,
      page,
      pageSize,
      q,
      from,
      to,
    });
  }

  @Get('deposits/:id')
  @AdminRoles(Role.ADMIN, Role.FINANCE, Role.SUPPORT, Role.VIEWER)
  getDeposit(@Param('id') id: string) {
    return this.depositsService.getAdminDeposit(id);
  }

  @Post('deposits/:id/approve')
  @AdminRoles(Role.ADMIN, Role.FINANCE)
  async approveReviewedDeposit(
    @CurrentAdmin() admin: AdminBridgeUser,
    @Param('id') id: string,
    @Body() body: { adminNote?: string },
  ) {
    if (!body?.adminNote?.trim()) {
      throw new BadRequestException('adminNote is required.');
    }

    const result = await this.depositsService.approveReviewedDeposit(
      id,
      body.adminNote.trim(),
    );

    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action: AdminAuditAction.DEPOSIT_APPROVED,
      targetType: 'DEPOSIT',
      targetId: id,
      after: result.deposit,
      metadata: {
        adminNote: body.adminNote.trim(),
      },
    });

    return result;
  }

  @Post('deposits/:id/reject')
  @AdminRoles(Role.ADMIN, Role.FINANCE)
  async rejectDeposit(
    @CurrentAdmin() admin: AdminBridgeUser,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    if (!body?.reason?.trim()) {
      throw new BadRequestException('reason is required.');
    }

    const result = await this.depositsService.rejectDeposit(
      id,
      body.reason.trim(),
    );

    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action: AdminAuditAction.DEPOSIT_REJECTED,
      targetType: 'DEPOSIT',
      targetId: id,
      after: result.deposit,
      metadata: {
        reason: body.reason.trim(),
      },
    });

    return result;
  }

  @Patch('deposits/:id/approve')
  @AdminRoles(Role.ADMIN, Role.FINANCE)
  async approveDeposit(
    @CurrentAdmin() admin: AdminBridgeUser,
    @Param('id') id: string,
  ) {
    const result = await this.depositsService.approveManualDeposit(id);

    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action: AdminAuditAction.DEPOSIT_APPROVED,
      targetType: 'DEPOSIT',
      targetId: id,
      after: result.deposit,
    });

    return result;
  }

  @Get('withdrawals')
  @AdminRoles(Role.ADMIN, Role.FINANCE, Role.SUPPORT, Role.VIEWER)
  listWithdrawals(
    @Query('status') status?: WithdrawalStatus,
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.withdrawalsService.listAdminWithdrawals({
      status,
      userId,
      page,
      pageSize,
      q,
      from,
      to,
    });
  }

  @Get('withdrawals/:id')
  @AdminRoles(Role.ADMIN, Role.FINANCE, Role.SUPPORT, Role.VIEWER)
  getWithdrawal(@Param('id') id: string) {
    return this.withdrawalsService.getAdminWithdrawal(id);
  }

  @Patch('withdrawals/:id/approve')
  @AdminRoles(Role.ADMIN, Role.FINANCE)
  async approveWithdrawal(
    @CurrentAdmin() admin: AdminBridgeUser,
    @Param('id') id: string,
  ) {
    const result = await this.withdrawalsService.approveWithdrawal(
      id,
      admin.id,
    );

    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action: AdminAuditAction.WITHDRAWAL_APPROVED,
      targetType: 'WITHDRAWAL',
      targetId: id,
      after: result.withdrawal,
    });

    return result;
  }

  @Patch('withdrawals/:id/process')
  @AdminRoles(Role.ADMIN, Role.FINANCE)
  async processWithdrawal(
    @CurrentAdmin() admin: AdminBridgeUser,
    @Param('id') id: string,
  ) {
    const result = await this.withdrawalsService.createPayout(id);

    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action: AdminAuditAction.WITHDRAWAL_MARKED_PROCESSING,
      targetType: 'WITHDRAWAL',
      targetId: id,
      after: result.withdrawal,
    });

    return result;
  }

  @Patch('withdrawals/:id/paid')
  @AdminRoles(Role.ADMIN, Role.FINANCE)
  async markWithdrawalPaid(
    @CurrentAdmin() admin: AdminBridgeUser,
    @Param('id') id: string,
    @Body() body: { providerReference?: string },
  ) {
    const result = await this.withdrawalsService.markPaid(
      id,
      admin.id,
      body?.providerReference,
    );

    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action: AdminAuditAction.WITHDRAWAL_MARKED_PAID,
      targetType: 'WITHDRAWAL',
      targetId: id,
      after: result.withdrawal,
    });

    return result;
  }

  @Post('withdrawals/:id/complete')
  @AdminRoles(Role.ADMIN, Role.FINANCE)
  async completeWithdrawal(
    @CurrentAdmin() admin: AdminBridgeUser,
    @Param('id') id: string,
    @Body() body: { externalReference?: string },
  ) {
    if (!body?.externalReference?.trim()) {
      throw new BadRequestException('externalReference is required.');
    }

    const result = await this.withdrawalsService.markPaid(
      id,
      admin.id,
      body.externalReference.trim(),
    );

    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action: AdminAuditAction.WITHDRAWAL_COMPLETED,
      targetType: 'WITHDRAWAL',
      targetId: id,
      after: result.withdrawal,
      metadata: {
        externalReference: body?.externalReference ?? null,
      },
    });

    return result;
  }

  @Patch('withdrawals/:id/reject')
  @AdminRoles(Role.ADMIN, Role.FINANCE)
  async rejectWithdrawal(
    @CurrentAdmin() admin: AdminBridgeUser,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    if (!body?.reason?.trim()) {
      throw new BadRequestException('reason is required.');
    }

    const result = await this.withdrawalsService.rejectWithdrawal(
      id,
      admin.id,
      body.reason.trim(),
    );

    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action: AdminAuditAction.WITHDRAWAL_REJECTED,
      targetType: 'WITHDRAWAL',
      targetId: id,
      after: result.withdrawal,
      metadata: {
        reason: body.reason.trim(),
      },
    });

    return result;
  }

  @Patch('withdrawals/:id/failed')
  @AdminRoles(Role.ADMIN, Role.FINANCE)
  async markWithdrawalFailed(
    @CurrentAdmin() admin: AdminBridgeUser,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    const result = await this.withdrawalsService.markFailed(
      id,
      admin.id,
      body?.reason ?? 'Provider payout failed.',
    );

    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action: AdminAuditAction.WITHDRAWAL_MARKED_FAILED,
      targetType: 'WITHDRAWAL',
      targetId: id,
      after: result.withdrawal,
    });

    return result;
  }
}
