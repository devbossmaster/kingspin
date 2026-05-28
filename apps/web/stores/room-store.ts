import { create } from "zustand";
import type { LatestRoundResult } from "@kingspin/contracts";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

type RoomStore = {
  selectedChip: number;
  connectionStatus: ConnectionStatus;
  isWinnerRevealOpen: boolean;
  lastWinner: LatestRoundResult | null;
  roundLog: LatestRoundResult[];
  chipOptions: number[];
  setSelectedChip: (amount: number) => void;
  setChipOptions: (options: number[]) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  addRoundLog: (result: LatestRoundResult) => void;
  showWinner: (result: LatestRoundResult) => void;
  dismissWinner: () => void;
};

export const useRoomStore = create<RoomStore>((set) => ({
  selectedChip: 1000,
  connectionStatus: "disconnected",
  isWinnerRevealOpen: false,
  lastWinner: null,
  roundLog: [],
  chipOptions: [1000],

  setSelectedChip: (amount) => set({ selectedChip: amount }),
  setChipOptions: (chipOptions) =>
    set((state) => ({
      chipOptions,
      selectedChip: chipOptions.includes(state.selectedChip)
        ? state.selectedChip
        : (chipOptions[0] ?? state.selectedChip),
    })),
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),

  addRoundLog: (result) =>
    set((state) => ({
      roundLog: [result, ...state.roundLog].slice(0, 8),
    })),

  showWinner: (result) =>
    set((state) => ({
      lastWinner: result,
      roundLog: [result, ...state.roundLog].slice(0, 8),
      isWinnerRevealOpen: true,
    })),

  dismissWinner: () =>
    set({
      isWinnerRevealOpen: false,
    }),
}));
