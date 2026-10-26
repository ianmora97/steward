import { DEFAULT_ZOOM, ZOOM_LEVELS, isZoomLevel, type ZoomLevel, type ZoomState } from '@shared/schemas/ui';
import { getSetting, setSetting } from '../db/app-settings.repo';
import type { SqlDatabase } from '../db/driver';

const ZOOM_KEY = 'ui.zoom';

export interface UiSettingsService {
  getZoom: () => ZoomLevel;
  setZoom: (zoom: ZoomLevel) => ZoomLevel;
  /** One step up (`1`) or down (`-1`) the zoom levels, stopping at the ends. */
  stepZoom: (direction: 1 | -1) => ZoomLevel;
  resetZoom: () => ZoomLevel;
  /** Puts the stored zoom on the window, e.g. after it loads. */
  applyCurrent: () => void;
}

/**
 * The window's zoom: stored in `app_settings`, applied to the window and announced to the renderer
 * so its selector stays in step when the keyboard changes it. A missing or invalid stored value is 100 %.
 */
export function createUiSettingsService({
  db,
  apply,
  emit
}: {
  db: SqlDatabase;
  apply: (zoom: ZoomLevel) => void;
  emit: (event: ZoomState) => void;
}): UiSettingsService {
  function getZoom(): ZoomLevel {
    const stored = getSetting(db, ZOOM_KEY);
    return isZoomLevel(stored) ? stored : DEFAULT_ZOOM;
  }

  function setZoom(zoom: ZoomLevel): ZoomLevel {
    setSetting(db, ZOOM_KEY, zoom);
    apply(zoom);
    emit({ zoom });
    return zoom;
  }

  return {
    getZoom,
    setZoom,
    stepZoom: (direction) => {
      const index = ZOOM_LEVELS.indexOf(getZoom());
      const next = ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, index + direction))] ?? DEFAULT_ZOOM;
      return setZoom(next);
    },
    resetZoom: () => setZoom(DEFAULT_ZOOM),
    applyCurrent: () => apply(getZoom())
  };
}
