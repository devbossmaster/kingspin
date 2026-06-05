import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { TELEBIRR_RECEIPT_HOSTNAME } from './telebirr-receipt.config';
import type {
  TelebirrReceiptConfig,
  TelebirrReceiptFetchResult,
} from './telebirr-receipt.types';

@Injectable()
export class TelebirrReceiptClient {
  private readonly logger = new Logger(TelebirrReceiptClient.name);

  async fetchReceipt(
    receiptNo: string,
    config: TelebirrReceiptConfig,
  ): Promise<TelebirrReceiptFetchResult> {
    const receiptUrl = this.buildReceiptUrl(receiptNo, config);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.httpTimeoutMs);

    try {
      const response = await fetch(receiptUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent':
            'KingSpin-TelebirrReceiptVerifier/1.0 (+server-side-verification)',
          Accept: 'text/html,text/plain;q=0.9,*/*;q=0.2',
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');

        if (location) {
          const redirected = new URL(location, receiptUrl);

          if (
            redirected.protocol !== 'https:' ||
            redirected.hostname !== new URL(config.baseUrl).hostname
          ) {
            throw new BadRequestException(
              'Telebirr receipt redirected away from the official host.',
            );
          }
        }

        throw new BadRequestException(
          'Telebirr receipt redirects are not accepted.',
        );
      }

      const contentType = response.headers.get('content-type');

      if (
        contentType &&
        !contentType.toLowerCase().includes('text/html') &&
        !contentType.toLowerCase().includes('text/plain')
      ) {
        throw new BadRequestException(
          'Telebirr receipt returned unsupported content.',
        );
      }

      const body = await this.readLimitedResponse(
        response,
        config.maxHtmlBytes,
      );
      const rawProviderHash = createHash('sha256').update(body).digest('hex');

      this.logger.log(
        `[telebirr-receipt-fetch] receiptNo=${receiptNo} status=${response.status} bytes=${body.length} hash=${rawProviderHash.slice(0, 12)}`,
      );

      return {
        receiptNo,
        url: receiptUrl.toString(),
        httpStatus: response.status,
        contentType,
        body,
        rawProviderHash,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  buildReceiptUrl(receiptNo: string, config: TelebirrReceiptConfig) {
    const baseUrl = new URL(config.baseUrl);

    if (baseUrl.protocol !== 'https:') {
      throw new BadRequestException(
        'Telebirr receipt base URL must use HTTPS.',
      );
    }

    if (baseUrl.hostname !== TELEBIRR_RECEIPT_HOSTNAME) {
      throw new BadRequestException(
        'Telebirr receipt base URL host is not allowed.',
      );
    }

    baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, '')}/${receiptNo}`;
    baseUrl.search = '';
    baseUrl.hash = '';

    return baseUrl;
  }

  private async readLimitedResponse(response: Response, maxBytes: number) {
    if (!response.body) {
      return await response.text();
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > maxBytes) {
        throw new BadRequestException(
          'Telebirr receipt response is too large.',
        );
      }

      chunks.push(value);
    }

    const merged = new Uint8Array(totalBytes);
    let offset = 0;

    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new TextDecoder('utf-8', { fatal: false }).decode(merged);
  }
}
