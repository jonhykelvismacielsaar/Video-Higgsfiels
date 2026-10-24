import { create } from "zustand";
import { persist } from "zustand/middleware";

import { LOCAL_MODE, getModel } from "../catalog";
import type { Surface } from "../catalog/types";
import { browserStorage } from "./browser-storage";

/** Results one press of Generate produces. Models that do not carry a count of
    their own are submitted once per result — every unit is a real platform
    request — so the ceiling is deliberately small. */
export const MAX_BATCH = 4;

/* In local mode the hosted catalog cannot produce a file, so the studio opens on
   the one model that runs here. */
const DEFAULT_MODEL = LOCAL_MODE ? "local-motion" : "seedance-2.5";

function isUsable(id: string): boolean {
  try {
    const model = getModel(id);
    return !LOCAL_MODE || model.id.startsWith("local-");
  } catch {
    return false;
  }
}

type ActiveState = {
  surface: Surface;
  model: string;
  batch: number;
  setModel: (id: string) => void;
  setBatch: (count: number) => void;
};

export const useActive = create<ActiveState>()(
  persist(
    (set) => ({
      surface: "video",
      model: DEFAULT_MODEL,
      batch: 1,
      setModel: (id) => {
        const model = getModel(id);
        set((state) =>
          state.model === model.id && state.surface === model.surface
            ? state
            : { model: model.id, surface: model.surface },
        );
      },
      setBatch: (count) =>
        set((state) => {
          const batch = Math.min(MAX_BATCH, Math.max(1, Math.round(count)));
          return state.batch === batch ? state : { batch };
        }),
    }),
    {
      name: "openhiggsfield.active.v2",
      storage: browserStorage(),
      partialize: (state) => ({ surface: state.surface, model: state.model, batch: state.batch }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (!isUsable(state.model)) state.setModel(DEFAULT_MODEL);
      },
    },
  ),
);
