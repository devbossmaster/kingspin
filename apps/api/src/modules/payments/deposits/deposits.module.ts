import { Module } from '@nestjs/common';
import { DepositsRepository } from './deposits.repository';

@Module({
  providers: [DepositsRepository],
  exports: [DepositsRepository],
})
export class DepositsModule {}
