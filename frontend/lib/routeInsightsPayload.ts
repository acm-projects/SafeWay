import type { ModeRouteData } from '@/components/RouteInsightsPage';

export type RouteInsightsPayload = {
  activeData: ModeRouteData | null;
  originLat?: number;
  originLng?: number;
  destLat?: number;
  destLng?: number;
};

let pending: RouteInsightsPayload | null = null;

export function setRouteInsightsPayload(p: RouteInsightsPayload): void {
  pending = p;
}

export function peekRouteInsightsPayload(): RouteInsightsPayload | null {
  return pending;
}

export function consumeRouteInsightsPayload(): RouteInsightsPayload | null {
  const x = pending;
  pending = null;
  return x;
}
