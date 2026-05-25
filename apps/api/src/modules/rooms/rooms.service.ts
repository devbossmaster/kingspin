import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveByCategorySlug(categorySlug: string) {
    if (!categorySlug) {
      throw new BadRequestException("categorySlug is required.");
    }

    return this.prisma.room.findMany({
      where: {
        category: {
          slug: categorySlug,
          isActive: true,
        },
        status: "ACTIVE",
      },
      orderBy: [{ isPermanent: "desc" }, { code: "asc" }],
      select: {
        id: true,
        categoryId: true,
        code: true,
        name: true,
        status: true,
        isPermanent: true,
        maxPlayers: true,
        roundDurationMs: true,
        activatedAt: true,
      },
    });
  }
}
