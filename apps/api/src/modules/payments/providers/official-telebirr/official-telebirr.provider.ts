import { Injectable } from '@nestjs/common';
import { PaymentProvider } from '@kingspin/db';

@Injectable()
export class OfficialTelebirrProvider {
  getProviderName() {
    return PaymentProvider.TELEBIRR_OFFICIAL;
  }
}
