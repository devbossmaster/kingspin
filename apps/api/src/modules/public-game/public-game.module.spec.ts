import { MODULE_METADATA } from "@nestjs/common/constants";
import { PublicGameController } from "./public-game.controller";
import { PublicGameModule } from "./public-game.module";

describe("PublicGameModule", () => {
  it("does not register public development controllers", () => {
    const controllers =
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, PublicGameModule) ?? [];

    expect(controllers).toEqual([PublicGameController]);
    expect(
      controllers.map((controller: { name: string }) => controller.name),
    ).not.toContain("PublicDevEntriesController");
    expect(
      controllers.map((controller: { name: string }) => controller.name),
    ).not.toContain("PublicDevWalletController");
  });
});
