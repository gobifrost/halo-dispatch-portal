import { create } from "zustand";

interface RuntimeConfigState {
  config: { resourceServer: string };
  setResourceServer: (resourceServer: string) => void;
}

export const useConfigStore = create<RuntimeConfigState>((set) => ({
  config: { resourceServer: "" },
  setResourceServer: (resourceServer) => set({ config: { resourceServer } }),
}));
