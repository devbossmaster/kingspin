import type { Request } from "express";

export type AuthBridgeUser = {
  id: string;
};

export type AuthenticatedRequestFields = {
  user?: AuthBridgeUser;
  authUser?: AuthBridgeUser;
};

export type AuthBridgeRequest = AuthenticatedRequestFields & {
  headers?: Request["headers"];
};
