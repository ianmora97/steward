import { z } from 'zod';

/** The zoom steps the UI offers, in percent. A closed set: nothing else ever reaches `setZoomFactor`. */
export const ZOOM_LEVELS = [80, 90, 100, 110, 125, 150] as const;

export type ZoomLevel = (typeof ZOOM_LEVELS)[number];

export const DEFAULT_ZOOM: ZoomLevel = 100;

export const zoomLevelSchema = z.union([
  z.literal(80),
  z.literal(90),
  z.literal(100),
  z.literal(110),
  z.literal(125),
  z.literal(150)
]);

export const setZoomInputSchema = z.object({ zoom: zoomLevelSchema });

export type SetZoomInput = z.infer<typeof setZoomInputSchema>;

/** What the renderer learns about the window's zoom, on request and whenever Ctrl +/−/0 changes it. */
export interface ZoomState {
  zoom: ZoomLevel;
}

export function isZoomLevel(value: unknown): value is ZoomLevel {
  return zoomLevelSchema.safeParse(value).success;
}
