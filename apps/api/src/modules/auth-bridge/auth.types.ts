import type { Request } from "express";
import type { Role } from "@kingspin/db";

export type AuthBridgeUser = {
  id: string;
};

export type AdminBridgeUser = {
  id: string;
  role: Role;
};

export type AuthenticatedRequestFields = {
  user?: AuthBridgeUser;
  authUser?: AuthBridgeUser;
  adminUser?: AdminBridgeUser;
};

export type AuthBridgeRequest = AuthenticatedRequestFields & {
  headers?: Request["headers"];
};
