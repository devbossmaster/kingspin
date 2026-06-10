import { create } from "zustand";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

type RoomStore = {
  selectedChip: number;
  connectionStatus: ConnectionStatus;
  chipOptions: number[];
  setSelectedChip: (amount: number) => void;
  setChipOptions: (options: number[]) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
};

export const useRoomStore = create<RoomStore>((set) => ({
  selectedChip: 10,
  connectionStatus: "disconnected",
  chipOptions: [10],

  setSelectedChip: (amount) => set({ selectedChip: amount }),

  setChipOptions: (chipOptions) =>
    set((state) => ({
      chipOptions,
      selectedChip: chipOptions.includes(state.selectedChip)
        ? state.selectedChip
        : (chipOptions[0] ?? state.selectedChip),
    })),

  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
}));