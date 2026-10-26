import { useEffect, useState } from 'react';
import { ZOOM_LEVELS, type ZoomLevel } from '@shared/schemas/ui';
import { useAction } from '../../../components/useAction';

/** The window's zoom. Ctrl +, − and 0 change it too, so it follows the value main announces rather than only its own clicks. */
export function ZoomSelector(): React.JSX.Element {
  const [zoom, setZoom] = useState<ZoomLevel | null>(null);
  const change = useAction((level: ZoomLevel) => window.steward.ui.setZoom({ zoom: level }), { errorTarget: 'toast' });

  useEffect(() => {
    let cancelled = false;
    void window.steward.ui.getZoom().then((result) => {
      if (!cancelled && result.success) setZoom(result.data.zoom);
    });
    const stop = window.steward.ui.onZoomChanged((event) => setZoom(event.zoom));
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  return (
    <div className="segmented" role="radiogroup" aria-label="Interface zoom">
      {ZOOM_LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={zoom === level}
          disabled={change.pending}
          className={`segmented__option${zoom === level ? ' segmented__option--active' : ''}`}
          onClick={() => void change.run(level)}
        >
          {level}%
        </button>
      ))}
    </div>
  );
}
