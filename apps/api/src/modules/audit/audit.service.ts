import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { AdminAuditAction, Prisma } from '@kingspin/db';
import { PrismaService } from '../../prisma/prisma.service';

export type RecordAdminAuditInput = {
  actorId?: string | null;
  action: AdminAuditAction;
  targetType: string;
  targetId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
};

export type RecordAdminAuditResult = {
  recorded: true;
  auditLogId: string;
  createdAt: string;
};

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordAdminAction(
    input: RecordAdminAuditInput,
  ): Promise<RecordAdminAuditResult> {
    try {
      const auditLog = await this.prisma.adminAuditLog.create({
        data: {
          actorId: input.actorId ?? null,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId ?? null,
          before: input.before ?? undefined,
          after: input.after ?? undefined,
          metadata: input.metadata ?? undefined,
        },
        select: {
          id: true,
          createdAt: true,
        },
      });

      return {
        recorded: true,
        auditLogId: auditLog.id,
        createdAt: auditLog.createdAt.toISOString(),
      };
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'Unknown audit write error';

      this.logger.warn(
        `Admin audit write failed for ${input.action} on ${input.targetType}:${input.targetId ?? 'unknown'}: ${reason}`,
      );

      throw new InternalServerErrorException(
        `Admin audit write failed. Mutation result requires manual review: ${reason}`,
      );
    }
  }

  getMigrationTodos() {
    return [
      'Add audit actor resolution from real admin auth once Better Auth/admin roles are fully wired.',
      'Consider replacing the AdminAuditAction enum with a string action field or broaden the enum before adding many operational actions.',
      'Add requestId, ipAddress, userAgent, and correlation metadata columns for production audit investigations.',
      'Add retention/export strategy for compliance-grade audit logs.',
    ];
  }
}
