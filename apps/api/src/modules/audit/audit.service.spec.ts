import { Logger } from "@nestjs/common";
import { AdminAuditAction } from "@kingspin/db";
import { AuditService } from "./audit.service";

const now = new Date("2026-05-26T12:00:00.000Z");

describe("AuditService", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("records an admin action when the audit schema is available", async () => {
    const prisma = {
      adminAuditLog: {
        create: jest.fn().mockResolvedValue({
          id: "audit-1",
          createdAt: now,
        }),
      },
    };
    const service = new AuditService(prisma as any);

    const result = await service.recordAdminAction({
      actorId: "admin-1",
      action: AdminAuditAction.ROOM_ACTIVATED,
      targetType: "Room",
      targetId: "room-1",
      metadata: { source: "test" },
    });

    expect(result).toEqual({
      recorded: true,
      auditLogId: "audit-1",
      createdAt: now.toISOString(),
    });
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: "admin-1",
          action: AdminAuditAction.ROOM_ACTIVATED,
          targetType: "Room",
          targetId: "room-1",
          metadata: { source: "test" },
        }),
      }),
    );
  });

  it("fails open when an audit write cannot be recorded", async () => {
    const prisma = {
      adminAuditLog: {
        create: jest.fn().mockRejectedValue(new Error("enum missing")),
      },
    };
    const service = new AuditService(prisma as any);

    const result = await service.recordAdminAction({
      action: AdminAuditAction.ADMIN_CREDIT,
      targetType: "WalletAccount",
      targetId: "wallet-1",
    });

    expect(result).toEqual(
      expect.objectContaining({
        recorded: false,
        reason: "enum missing",
        migrationTodo: expect.stringContaining("AdminAuditAction"),
      }),
    );
  });
});
