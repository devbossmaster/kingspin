import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findActive() {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    });

    return categories.map((category) => ({
      ...category,
      minEntryAmount: category.minEntryAmount.toString(),
      maxEntryAmount: category.maxEntryAmount.toString(),
    }));
  }
}
