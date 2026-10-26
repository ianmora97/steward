import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { arrow, autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';

const SHOW_DELAY_MS = 300;
/** Moving from one tooltip to the next within this time skips the wait, like a toolbar. */
const GROUP_WINDOW_MS = 450;

interface Target {
  host: Element;
  text: string;
  /** Puts back what was lifted off the element while its tooltip was pending or showing. */
  restore: () => void;
}

/** The nearest element that has something to say: `data-tooltip`, or a `title` (which every screen already uses). */
function findHost(node: EventTarget | null): Element | null {
  return node instanceof Element ? node.closest('[data-tooltip], [title]') : null;
}

/**
 * Takes over an element's `title` so the browser's own tooltip never shows. An icon-only element keeps its accessible
 * name (the title was it) as an `aria-label` for as long as the title is away.
 */
function capture(host: Element): Target | null {
  const title = host.getAttribute('title');
  const text = (host.getAttribute('data-tooltip') ?? title ?? '').trim();
  if (text === '') return null;

  let labelled = false;
  if (title !== null) {
    host.removeAttribute('title');
    if (!host.hasAttribute('aria-label') && !host.hasAttribute('aria-labelledby') && (host.textContent ?? '').trim() === '') {
      host.setAttribute('aria-label', text);
      labelled = true;
    }
  }

  return {
    host,
    text,
    restore: () => {
      // A re-render may have set a newer title meanwhile: that one wins.
      if (title !== null && !host.hasAttribute('title')) host.setAttribute('title', title);
      if (labelled) host.removeAttribute('aria-label');
    }
  };
}

/**
 * One tooltip for the whole window, positioned by Floating UI. Every element with a `title` or `data-tooltip` gets it on
 * hover and on keyboard focus, so screens just keep writing `title="…"`. Mount it once, next to the toast viewport.
 */
export function TooltipLayer(): React.JSX.Element {
  const tipRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tip = tipRef.current;
    const body = bodyRef.current;
    const arrowEl = arrowRef.current;
    if (tip === null || body === null || arrowEl === null) return;

    let current: Target | null = null;
    let showTimer: number | undefined;
    let stopFollowing: (() => void) | null = null;
    let visible = false;
    let lastHiddenAt = 0;

    async function place(host: Element): Promise<void> {
      if (tip === null || arrowEl === null) return;
      const { x, y, placement, middlewareData } = await computePosition(host, tip, {
        strategy: 'fixed',
        placement: 'top',
        middleware: [offset(10), flip({ padding: 8 }), shift({ padding: 8 }), arrow({ element: arrowEl, padding: 8 })]
      });
      if (current?.host !== host) return;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
      tip.dataset['placement'] = placement.split('-')[0] ?? 'top';
      const { x: arrowX, y: arrowY } = middlewareData.arrow ?? {};
      arrowEl.style.left = arrowX !== undefined ? `${arrowX}px` : '';
      arrowEl.style.top = arrowY !== undefined ? `${arrowY}px` : '';
    }

    function deactivate(): void {
      window.clearTimeout(showTimer);
      stopFollowing?.();
      stopFollowing = null;
      current?.restore();
      current = null;
      if (visible && tip !== null) {
        visible = false;
        lastHiddenAt = Date.now();
        tip.dataset['state'] = 'hidden';
      }
    }

    function show(target: Target): void {
      if (body === null) return;
      body.textContent = target.text;
      // Placed while still hidden and shifted away, then revealed: the entrance starts from the right spot.
      void place(target.host).then(() => {
        if (current !== target || tip === null) return;
        void tip.offsetWidth;
        tip.dataset['state'] = 'visible';
        visible = true;
        stopFollowing = autoUpdate(target.host, tip, () => {
          if (!target.host.isConnected) deactivate();
          else void place(target.host);
        });
      });
    }

    function activate(host: Element): void {
      if (current?.host === host) return;
      deactivate();
      const target = capture(host);
      if (target === null) return;
      current = target;
      const delay = Date.now() - lastHiddenAt < GROUP_WINDOW_MS ? 0 : SHOW_DELAY_MS;
      showTimer = window.setTimeout(() => show(target), delay);
    }

    function onPointerOver(event: PointerEvent): void {
      if (event.pointerType === 'touch') return;
      const host = findHost(event.target);
      if (host === null) deactivate();
      else activate(host);
    }

    function onFocusIn(event: FocusEvent): void {
      const host = findHost(event.target);
      // A click that focuses a button should not pop a tooltip; Tab should.
      if (host !== null && event.target instanceof Element && event.target.matches(':focus-visible')) activate(host);
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') deactivate();
    }

    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('pointerdown', deactivate);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', deactivate);
    document.addEventListener('keydown', onKeyDown);
    document.documentElement.addEventListener('pointerleave', deactivate);
    window.addEventListener('blur', deactivate);
    return () => {
      deactivate();
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointerdown', deactivate);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', deactivate);
      document.removeEventListener('keydown', onKeyDown);
      document.documentElement.removeEventListener('pointerleave', deactivate);
      window.removeEventListener('blur', deactivate);
    };
  }, []);

  return createPortal(
    <div ref={tipRef} className="tooltip" data-state="hidden" data-placement="top" aria-hidden="true">
      <div ref={bodyRef} className="tooltip__body" />
      <div ref={arrowRef} className="tooltip__arrow" />
    </div>,
    document.body
  );
}
