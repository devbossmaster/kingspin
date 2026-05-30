import { AdminAuditAction } from '@kingspin/db';
import { AdminRoundsController } from './admin-rounds.controller';

describe('AdminRoundsController', () => {
  function buildController() {
    const roundsService = {
      startOpenRoundForRoom: jest.fn().mockResolvedValue({
        id: 'round-1',
        status: 'OPEN',
      }),
      lockCurrentRoundForRoom: jest.fn(),
      drawCurrentRoundForRoom: jest.fn(),
      settleCurrentRoundForRoom: jest.fn(),
      cancelCurrentRoundForRoom: jest.fn().mockResolvedValue({
        currentRound: {
          id: 'round-1',
          status: 'CANCELLED',
        },
      }),
      getLatestRoundResultForRoom: jest.fn(),
    };
    const auditService = {
      recordAdminAction: jest.fn().mockResolvedValue(undefined),
    };
    const roomGateway = {
      invalidateRoomState: jest.fn(),
      broadcastRoundState: jest.fn().mockResolvedValue(undefined),
    };

    return {
      controller: new AdminRoundsController(
        roundsService as any,
        auditService as any,
        roomGateway as any,
      ),
      roundsService,
      auditService,
      roomGateway,
    };
  }

  it('broadcasts round:state after admin starts a round', async () => {
    const { controller, roundsService, auditService, roomGateway } =
      buildController();

    await controller.startRound({ id: 'admin-1' } as any, 'room-1');
    await new Promise((resolve) => setImmediate(resolve));

    expect(roundsService.startOpenRoundForRoom).toHaveBeenCalledWith('room-1');
    expect(auditService.recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        action: AdminAuditAction.ROUND_STARTED,
        targetId: 'room-1',
      }),
    );
    expect(roomGateway.invalidateRoomState).toHaveBeenCalledWith('room-1');
    expect(roomGateway.broadcastRoundState).toHaveBeenCalledWith(
      'room-1',
      'ADMIN_ROUND_STARTED',
    );
  });

  it('broadcasts round:state after admin cancels a round', async () => {
    const { controller, roundsService, auditService, roomGateway } =
      buildController();

    await controller.cancelCurrentRound({ id: 'admin-1' } as any, 'room-1');
    await new Promise((resolve) => setImmediate(resolve));

    expect(roundsService.cancelCurrentRoundForRoom).toHaveBeenCalledWith(
      'room-1',
    );
    expect(auditService.recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        action: AdminAuditAction.ROUND_CANCELLED,
        targetId: 'room-1',
      }),
    );
    expect(roomGateway.invalidateRoomState).toHaveBeenCalledWith('room-1');
    expect(roomGateway.broadcastRoundState).toHaveBeenCalledWith(
      'room-1',
      'ADMIN_ROUND_CANCELLED',
    );
  });
});
