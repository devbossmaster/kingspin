import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  forwardRef,
} from "@nestjs/common";
import { RoundMachineService } from "../rounds/round-machine.service";
import { RoomsService } from "./rooms.service";

@Controller("rooms")
export class RoomsController {
  constructor(
    private readonly roomsService: RoomsService,
    @Inject(forwardRef(() => RoundMachineService))
    private readonly roundMachineService: RoundMachineService,
  ) {}

  @Get()
  async findByCategory(@Query("categorySlug") categorySlug: string) {
    const rooms = await this.roomsService.findActiveByCategorySlug(categorySlug);
    this.requestCatchUpForOverduePermanentRooms(rooms);

    return rooms;
  }

  @Get("live")
  async findLiveByCategory(@Query("categorySlug") categorySlug: string) {
    const rooms = await this.roomsService.findActiveByCategorySlug(categorySlug);
    this.requestCatchUpForOverduePermanentRooms(rooms);

    return rooms;
  }

  @Get(":roomId/state")
  getState(@Param("roomId") roomId: string) {
    return this.roomsService.getRoomState(roomId);
  }

  private requestCatchUpForOverduePermanentRooms(rooms: unknown[]) {
    for (const room of rooms) {
      if (!this.isOverduePermanentOpenRoom(room)) {
        continue;
      }

      if (room.currentRound.entryCount === 0) {
        this.roundMachineService.requestExpiredEmptyOpenRoundCatchUp(
          room.id,
          room.currentRound.id,
          "ROOMS_LIVE_OVERDUE_OPEN",
        );
      } else {
        this.roundMachineService.requestRoomCatchUp(
          room.id,
          "ROOMS_LIVE_OVERDUE_OPEN",
        );
      }
    }
  }

  private isOverduePermanentOpenRoom(
    room: unknown,
  ): room is {
    id: string;
    currentRound: {
      id: string;
      status: string;
      msUntilLock: number;
      entryCount: number;
    };
  } {
    if (!room || typeof room !== "object") {
      return false;
    }

    const candidate = room as {
      id?: unknown;
      isPermanent?: unknown;
      status?: unknown;
      currentRound?: {
        id?: unknown;
        status?: unknown;
        msUntilLock?: unknown;
        entryCount?: unknown;
      } | null;
    };

    return (
      typeof candidate.id === "string" &&
      candidate.isPermanent === true &&
      candidate.status === "ACTIVE" &&
      typeof candidate.currentRound?.id === "string" &&
      candidate.currentRound?.status === "OPEN" &&
      typeof candidate.currentRound?.msUntilLock === "number" &&
      typeof candidate.currentRound?.entryCount === "number" &&
      candidate.currentRound.msUntilLock <= 0
    );
  }
}
