import { create } from "zustand";
import type { SocketMachineEvent } from "@kingspin/contracts";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

type RoomStore = {
  selectedChip: number;
  connectionStatus: ConnectionStatus;
  isWinnerRevealOpen: boolean;
  lastWinner: SocketMachineEvent | null;
  setSelectedChip: (amount: number) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  showWinner: (payload: SocketMachineEvent) => void;
  dismissWinner: () => void;
};

export const useRoomStore = create<RoomStore>((set) => ({
  selectedChip: 1000,
  connectionStatus: "disconnected",
  isWinnerRevealOpen: false,
  lastWinner: null,

  setSelectedChip: (amount) => set({ selectedChip: amount }),
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),

  showWinner: (payload) =>
    set({
      lastWinner: payload,
      isWinnerRevealOpen: true,
    }),

  dismissWinner: () =>
    set({
      isWinnerRevealOpen: false,
    }),
}));
