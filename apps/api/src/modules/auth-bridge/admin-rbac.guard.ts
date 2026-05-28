import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "@kingspin/db";
import { PrismaService } from "../../prisma/prisma.service";
import type { AuthBridgeRequest } from "./auth.types";

export const ADMIN_ROLES_METADATA_KEY = "adminRoles";
export type AdminRole = Exclude<Role, "PLAYER">;

export const AdminRoles = (...roles: AdminRole[]) =>
  SetMetadata(ADMIN_ROLES_METADATA_KEY, roles);

const OWNER_ROLES = new Set<Role>([Role.OWNER, Role.SUPER_ADMIN]);
const DEFAULT_ADMIN_ROLES = new Set<Role>([
  Role.OWNER,
  Role.SUPER_ADMIN,
  Role.ADMIN,
]);

@Injectable()
export class AdminRbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthBridgeRequest>();
    const userId = request.user?.id;

    if (!userId) {
      throw new ForbiddenException("Admin session required.");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        bannedAt: true,
      },
    });

    if (!user || user.bannedAt) {
      throw new ForbiddenException("Admin session is not active.");
    }

    const requiredRoles =
      this.reflector.getAllAndOverride<AdminRole[]>(
        ADMIN_ROLES_METADATA_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? [];
    const allowedRoles =
      requiredRoles.length > 0
        ? new Set<Role>([...requiredRoles, Role.OWNER, Role.SUPER_ADMIN])
        : DEFAULT_ADMIN_ROLES;

    if (!OWNER_ROLES.has(user.role) && !allowedRoles.has(user.role)) {
      throw new ForbiddenException("Admin role is not permitted.");
    }

    request.adminUser = {
      id: user.id,
      role: user.role,
    };

    return true;
  }
}
