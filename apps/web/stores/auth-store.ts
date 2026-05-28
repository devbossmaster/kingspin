"use client";

import type { CurrentUser, MeWallet, WalletSnapshot } from "@kingspin/contracts";
import { create } from "zustand";
import { apiClient } from "../lib/api-client";

type AuthStore = {
  user: CurrentUser | null;
  wallet: WalletSnapshot | null;
  loading: boolean;
  fetchMe: () => Promise<CurrentUser | null>;
  fetchWallet: () => Promise<MeWallet | null>;
  clear: () => void;
};

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  wallet: null,
  loading: false,

  fetchMe: async () => {
    set({ loading: true });

    try {
      const user = await apiClient.getMe();

      set({ user, loading: false });
      return user;
    } catch {
      set({ user: null, loading: false });
      return null;
    }
  },

  fetchWallet: async () => {
    set({ loading: true });

    try {
      const result = await apiClient.getMeWallet();

      set({ user: result.user, wallet: result.wallet, loading: false });
      return result;
    } catch {
      set({ wallet: null, loading: false });
      return null;
    }
  },

  clear: () => set({ user: null, wallet: null, loading: false }),
}));
