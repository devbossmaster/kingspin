import type { AuthBridgeUser } from "./auth.types";

declare global {
  namespace Express {
    interface Request {
      user?: AuthBridgeUser;
      authUser?: AuthBridgeUser;
    }
  }
}

export {};
