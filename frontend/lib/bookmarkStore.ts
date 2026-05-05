// Shared in-memory store so destination.tsx can write bookmarks
// that index.tsx reads immediately on focus — no backend required.

export type LocalBookmark = {
  id: string;
  title: string;
  address: string;
  lat: number;
  lng: number;
  place_id?: string;
};

const store: LocalBookmark[] = [];
const listeners: (() => void)[] = [];

function notify() {
  listeners.forEach(fn => fn());
}

export const bookmarkStore = {
  getAll(): LocalBookmark[] {
    return [...store];
  },
  add(bm: LocalBookmark) {
    if (!store.find(b => b.title === bm.title)) {
      store.push(bm);
      notify();
    }
  },
  remove(id: string) {
    const idx = store.findIndex(b => b.id === id);
    if (idx !== -1) { store.splice(idx, 1); notify(); }
  },
  has(title: string): boolean {
    return !!store.find(b => b.title === title);
  },
  subscribe(fn: () => void): () => void {
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i !== -1) listeners.splice(i, 1);
    };
  },
};