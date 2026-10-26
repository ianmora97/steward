import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { IconButton } from './IconButton';
import { useExitAnimation } from './useExitAnimation';
import { type ToastItem, type ToastTone, useToastStore } from '../stores/toast.store';

const AUTO_DISMISS_MS: Record<ToastTone, number | null> = { success: 3000, info: 4000, error: null };
const TONE_ICON: Record<ToastTone, IconName> = { success: 'checkCircle', info: 'info', error: 'xCircle' };

function ToastCard({ item }: { item: ToastItem }): React.JSX.Element {
  const dismiss = useToastStore((state) => state.dismiss);
  const { closing, requestClose } = useExitAnimation();
  const [paused, setPaused] = useState(false);
  const close = (): void => requestClose(() => dismiss(item.id));
  const closeRef = useRef(close);

  useEffect(() => {
    closeRef.current = close;
  });

  // The countdown stops while the pointer is over the toast and starts over when it leaves.
  useEffect(() => {
    const delay = AUTO_DISMISS_MS[item.tone];
    if (delay === null || paused) return;
    const timer = setTimeout(() => closeRef.current(), delay);
    return () => clearTimeout(timer);
  }, [item.tone, paused]);

  return (
    <li
      className={`toast toast--${item.tone}${closing ? ' is-closing' : ''}`}
      role={item.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <span className="toast__icon">
        <Icon name={TONE_ICON[item.tone]} size={16} />
      </span>
      <span className="toast__message">{item.message}</span>
      <IconButton icon="x" label="Dismiss" size={13} onClick={close} />
    </li>
  );
}

/** Where every toast appears: bottom right, newest at the bottom, mounted once in the app shell. */
export function ToastViewport(): React.JSX.Element {
  const toasts = useToastStore((state) => state.toasts);
  return (
    <ul className="toasts" aria-label="Notifications">
      {toasts.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </ul>
  );
}
