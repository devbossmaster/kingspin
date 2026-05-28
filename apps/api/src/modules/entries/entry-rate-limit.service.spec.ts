import { HttpException } from "@nestjs/common";
import { EntryRateLimitService } from "./entry-rate-limit.service";

describe("EntryRateLimitService", () => {
  it("allows same idempotency key replays without consuming the spam bucket", async () => {
    const service = new EntryRateLimitService();
    const args = {
      userId: "user-1",
      roomId: "room-1",
      idempotencyKey: "entry-key-1",
    };

    await expect(service.assertAllowed(args)).resolves.toBeUndefined();
    await expect(service.assertAllowed(args)).resolves.toBeUndefined();
    await expect(service.assertAllowed(args)).resolves.toBeUndefined();
    await expect(service.assertAllowed(args)).resolves.toBeUndefined();
  });

  it("rate limits rapid distinct entry attempts for one user and room", async () => {
    const service = new EntryRateLimitService();

    for (let index = 0; index < 3; index += 1) {
      await expect(
        service.assertAllowed({
          userId: "user-1",
          roomId: "room-1",
          idempotencyKey: `entry-key-${index}`,
        }),
      ).resolves.toBeUndefined();
    }

    await expect(
      service.assertAllowed({
        userId: "user-1",
        roomId: "room-1",
        idempotencyKey: "entry-key-4",
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
