import { useEffect, useState } from 'react';

export interface NearbyUser {
  user_id: string;
  latitude: number;
  longitude: number;
}

export function useNearbyUsers(userLat: number | null, userLng: number | null) {
  const [users, setUsers] = useState<NearbyUser[]>([]);

  useEffect(() => {
    if (!userLat || !userLng) return;

    // Fetch nearby users every 5 seconds
    const fetchInterval = setInterval(async () => {
      try {
        const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:8000';
        const res = await fetch(`${baseUrl}/users/locations?lat=${userLat}&lng=${userLng}&radius_km=5`);
        const data = await res.json();
        setUsers(data);
      } catch (e) {
        console.error('Failed to fetch nearby users', e);
      }
    }, 5_000);

    return () => {
      clearInterval(fetchInterval);
    };
  }, [userLat, userLng]);

  return users;
}