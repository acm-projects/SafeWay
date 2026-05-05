import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'safeway_map_session_v1';

export type MapStyleId = 'standard' | 'satellite' | 'hybrid' | 'terrain';

export type MapSessionSnapshot = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
  mapStyleType: MapStyleId;
  heatmapFilter: string;
};

export async function loadMapSession(): Promise<Partial<MapSessionSnapshot> | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<MapSessionSnapshot>;
  } catch {
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleSaveMapSession(partial: Partial<MapSessionSnapshot>, debounceMs = 450): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persistMerge(partial);
  }, debounceMs);
}

async function persistMerge(partial: Partial<MapSessionSnapshot>): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const prev = raw ? (JSON.parse(raw) as Partial<MapSessionSnapshot>) : {};
    const next = { ...prev, ...partial };
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export async function saveMapSessionImmediate(partial: Partial<MapSessionSnapshot>): Promise<void> {
  await persistMerge(partial);
}
