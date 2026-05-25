import { Controller, Get, Query } from "@nestjs/common";
import { RoomsService } from "./rooms.service";

@Controller("rooms")
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Get()
  findByCategory(@Query("categorySlug") categorySlug: string) {
    return this.roomsService.findActiveByCategorySlug(categorySlug);
  }
}
