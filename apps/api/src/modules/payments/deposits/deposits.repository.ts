import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class DepositsRepository {
  constructor(readonly prisma: PrismaService) {}
}
