import { Module, forwardRef } from '@nestjs/common';
import { RoomGateway } from '../../gateways/room.gateway';
import { AuthBridgeModule } from '../auth-bridge/auth-bridge.module';
import { PublicGameModule } from '../public-game/public-game.module';
import { RoomsModule } from '../rooms/rooms.module';
import { WalletsModule } from '../wallets/wallets.module';
import { RoundMachineLockService } from './round-machine-lock.service';
import { RoundMachineService } from './round-machine.service';
import {
  RoomPresenceController,
  RoundsController,
  WinnerFeedController,
} from './rounds.controller';
import { RoundsService } from './rounds.service';

@Module({
  imports: [
    WalletsModule,
    AuthBridgeModule,
    PublicGameModule,
    forwardRef(() => RoomsModule),
  ],
  controllers: [RoundsController, WinnerFeedController, RoomPresenceController],
  providers: [
    RoundsService,
    RoundMachineLockService,
    RoundMachineService,
    RoomGateway,
  ],
  exports: [
    RoundsService,
    RoundMachineLockService,
    RoundMachineService,
    RoomGateway,
  ],
})
export class RoundsModule {}
