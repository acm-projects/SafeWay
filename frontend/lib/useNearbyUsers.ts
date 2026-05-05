import { useEffect, useState } from 'react';

export interface NearbyUser {
  user_id: string;
  latitude: number;
  longitude: number;
  emoji: string;
}

const EMOJIS = ['🧑', '👩', '👨', '🧕', '👱', '🧔', '👴', '👵', '🧒', '👦', '👧'];

function randomOffset() {
  return (Math.random() - 0.5) * 0.15;
}

function generateFakeUsers(lat: number, lng: number): NearbyUser[] {
  return Array.from({ length: 8 }, (_, i) => ({
    user_id: `fake_${i}`,
    latitude: lat + (Math.random() - 0.5) * .18,
    longitude: lng + (Math.random() - 0.7) * 0.18,
    emoji: EMOJIS[i % EMOJIS.length],
  }));
}

export function useNearbyUsers(userLat: number | null, userLng: number | null): NearbyUser[] {
  const [users, setUsers] = useState<NearbyUser[]>([]);

  useEffect(() => {
    if (!userLat || !userLng) return;
    setUsers(generateFakeUsers(userLat, userLng));
  }, [userLat, userLng]);

  return users;
}