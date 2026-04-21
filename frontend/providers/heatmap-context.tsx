import React, { createContext, useContext, useState } from 'react';
import type { HeatmapFilter } from '@/lib/useCrashHeatmap';

interface HeatmapContextType {
  heatmapFilter: HeatmapFilter | 'off';
  setHeatmapFilter: (f: HeatmapFilter | 'off') => void;
  heatmapMode: 'hex' | 'road';
  setHeatmapMode: (m: 'hex' | 'road') => void;
}

const HeatmapContext = createContext<HeatmapContextType>({
  heatmapFilter: 'off',
  setHeatmapFilter: () => {},
  heatmapMode: 'road',
  setHeatmapMode: () => {},
});

export function HeatmapProvider({ children }: { children: React.ReactNode }) {
  const [heatmapFilter, setHeatmapFilter] = useState<HeatmapFilter | 'off'>('off');
  const [heatmapMode, setHeatmapMode] = useState<'hex' | 'road'>('road');

  return (
    <HeatmapContext.Provider value={{ heatmapFilter, setHeatmapFilter, heatmapMode, setHeatmapMode }}>
      {children}
    </HeatmapContext.Provider>
  );
}

export function useHeatmap() {
  return useContext(HeatmapContext);
}