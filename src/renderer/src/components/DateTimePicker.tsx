import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import './datetime-picker.css';

/**
 * The one way to pick a date or a time in Steward. Native `<input type="date | time | datetime-local">` is not
 * used anywhere: its popup ignores the app's colours. Needs a date or a time? Use this.
 */
export type PickerMode = 'datetime' | 'date' | 'time';

export interface PickerPreset {
  label: string;
  /** Evaluated when clicked, so "in 1 hour" is an hour from then, not from when the page opened. */
  value: () => Date;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const POPOVER_WIDTH = 296;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes());
}

export function formatPicked(date: Date, mode: PickerMode): string {
  const day = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  return mode === 'date' ? day : mode === 'time' ? time : `${day}, ${time}`;
}

/** The 42 days (six Monday-first weeks) that cover a month. */
function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), 1 - offset + index));
}

function TimeUnit({
  label,
  value,
  max,
  onChange
}: {
  label: string;
  value: number;
  max: number;
  onChange: (next: number) => void;
}): React.JSX.Element {
  const [typed, setTyped] = useState<string | null>(null);
  const wrap = (next: number): number => (next + max + 1) % (max + 1);

  return (
    <div className="dtp-unit" role="group" aria-label={label}>
      <button type="button" className="dtp-unit__step" aria-label={`More ${label}`} onClick={() => onChange(wrap(value + 1))}>
        <Icon name="chevronUp" size={14} />
      </button>
      <input
        className="dtp-unit__input"
        inputMode="numeric"
        maxLength={2}
        value={typed ?? String(value).padStart(2, '0')}
        aria-label={label}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, '').slice(0, 2);
          setTyped(digits);
          if (digits !== '') onChange(Math.min(max, Number(digits)));
        }}
        onBlur={() => setTyped(null)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            onChange(wrap(value + 1));
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            onChange(wrap(value - 1));
          }
        }}
      />
      <button type="button" className="dtp-unit__step" aria-label={`Less ${label}`} onClick={() => onChange(wrap(value - 1))}>
        <Icon name="chevronDown" size={14} />
      </button>
    </div>
  );
}

export function DateTimePicker({
  value,
  onChange,
  mode = 'datetime',
  min,
  presets,
  placeholder = 'Pick a date',
  clearable = true,
  disabled = false,
  invalid = false,
  label
}: {
  value: Date | null;
  onChange: (next: Date | null) => void;
  mode?: PickerMode;
  /** Earlier days are greyed out and an earlier time snaps to this one. */
  min?: Date;
  presets?: PickerPreset[];
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  /** Names the control for screen readers; the visible label belongs to the caller's `<label>`. */
  label?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  // "Now" is read when the picker opens, not while rendering, so rendering stays pure.
  const [now, setNow] = useState(() => new Date());
  const [month, setMonth] = useState(() => startOfDay(value ?? new Date()));
  const [focused, setFocused] = useState(() => startOfDay(value ?? new Date()));
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const place = useCallback((): void => {
    const box = trigger.current?.getBoundingClientRect();
    if (box === undefined) return;
    const height = popover.current?.offsetHeight ?? 380;
    const roomBelow = window.innerHeight - box.bottom;
    const above = roomBelow < height + 12 && box.top > roomBelow;
    const left = Math.max(8, Math.min(box.left, window.innerWidth - POPOVER_WIDTH - 8));
    setPosition({ left, top: above ? Math.max(8, box.top - height - 6) : box.bottom + 6, above });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place, month]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent): void {
      const target = event.target as Node;
      if (popover.current?.contains(target) === true || trigger.current?.contains(target) === true) return;
      setOpen(false);
    }
    // Capture phase: Escape closes only the picker, not the dialog it sits in.
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  // Day buttons are not all tabbable (one is), so moving focus has to wait for the grid to re-render.
  const placed = position !== null;
  useEffect(() => {
    if (!open || !placed) return;
    popover.current?.querySelector<HTMLButtonElement>('[data-focus-day="true"]')?.focus({ preventScroll: true });
  }, [open, focused, placed]);

  function openPicker(): void {
    setNow(new Date());
    const base = startOfDay(value ?? min ?? new Date());
    setMonth(base);
    setFocused(base);
    setOpen(true);
  }

  function clamp(date: Date): Date {
    return min !== undefined && date < min ? min : date;
  }

  /** A fresh value starts an hour ahead, on the hour: nobody wants "now" as an expiry. */
  function fallbackTime(): { hours: number; minutes: number } {
    if (value !== null) return { hours: value.getHours(), minutes: value.getMinutes() };
    const soon = new Date(now.getTime() + 60 * 60 * 1000);
    return { hours: soon.getHours(), minutes: 0 };
  }

  function pickDay(day: Date): void {
    const { hours, minutes } = fallbackTime();
    const next = clamp(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes));
    onChange(next);
    setFocused(startOfDay(next));
    if (mode === 'date') setOpen(false);
  }

  function setTime(hours: number, minutes: number): void {
    const base = value ?? new Date();
    onChange(clamp(new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes)));
  }

  function onGridKey(event: React.KeyboardEvent): void {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = addDays(focused, step);
    setFocused(next);
    if (next.getMonth() !== month.getMonth() || next.getFullYear() !== month.getFullYear()) setMonth(startOfDay(next));
  }

  const today = now;
  const days = monthGrid(month);
  const hours = value?.getHours() ?? fallbackTime().hours;
  const minutes = value?.getMinutes() ?? fallbackTime().minutes;
  const monthTitle = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const icon = mode === 'time' ? 'clock' : 'calendar';

  return (
    <>
      <span className={`dtp-trigger${invalid ? ' dtp-trigger--invalid' : ''}`}>
        <button
          ref={trigger}
          type="button"
          className={`field__input dtp-trigger__button${value === null ? ' dtp-trigger__button--empty' : ''}`}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={label}
          onClick={() => (open ? setOpen(false) : openPicker())}
        >
          <Icon name={icon} size={15} />
          <span className="dtp-trigger__text">{value === null ? placeholder : formatPicked(value, mode)}</span>
        </button>
        {clearable && value !== null && !disabled && (
          <button type="button" className="iconbutton dtp-trigger__clear" aria-label="Clear" title="Clear" onClick={() => onChange(null)}>
            <Icon name="x" size={14} />
          </button>
        )}
      </span>

      {open &&
        createPortal(
          <div
            ref={popover}
            className={`dtp${position?.above === true ? ' dtp--above' : ''}`}
            role="dialog"
            aria-label={mode === 'time' ? 'Pick a time' : 'Pick a date'}
            style={{ left: position?.left ?? 0, top: position?.top ?? 0, width: POPOVER_WIDTH, visibility: position === null ? 'hidden' : 'visible' }}
            // A portal still bubbles React events to its parents; without this a click here would close the dialog behind.
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {mode !== 'time' && (
              <>
                <div className="dtp__head">
                  <button type="button" className="iconbutton" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
                    <Icon name="chevronLeft" size={16} />
                  </button>
                  <span id={titleId} className="dtp__title" aria-live="polite">
                    {monthTitle}
                  </span>
                  <button type="button" className="iconbutton" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
                    <Icon name="chevronRight" size={16} />
                  </button>
                </div>
                <div className="dtp__weekdays" aria-hidden="true">
                  {WEEKDAYS.map((day) => (
                    <span key={day}>{day}</span>
                  ))}
                </div>
                <div className="dtp__grid" role="grid" aria-labelledby={titleId} onKeyDown={onGridKey}>
                  {days.map((day) => {
                    const outside = day.getMonth() !== month.getMonth();
                    const selected = value !== null && sameDay(day, value);
                    const blocked = min !== undefined && startOfDay(day) < startOfDay(min);
                    const isFocus = sameDay(day, focused);
                    return (
                      <button
                        key={day.toISOString()}
                        type="button"
                        role="gridcell"
                        className={`dtp__day${outside ? ' dtp__day--outside' : ''}${selected ? ' dtp__day--selected' : ''}${sameDay(day, today) ? ' dtp__day--today' : ''}`}
                        disabled={blocked}
                        tabIndex={isFocus ? 0 : -1}
                        data-focus-day={isFocus ? 'true' : undefined}
                        aria-selected={selected}
                        aria-label={day.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                        onClick={() => pickDay(day)}
                      >
                        {day.getDate()}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {mode !== 'date' && (
              <div className="dtp__time">
                <Icon name="clock" size={15} />
                <TimeUnit label="hours" value={hours} max={23} onChange={(next) => setTime(next, minutes)} />
                <span className="dtp__colon" aria-hidden="true">
                  :
                </span>
                <TimeUnit label="minutes" value={minutes} max={59} onChange={(next) => setTime(hours, next)} />
                {mode === 'time' && value === null && (
                  <button type="button" className="button button--small" onClick={() => setTime(hours, minutes)}>
                    Set
                  </button>
                )}
              </div>
            )}

            {presets !== undefined && presets.length > 0 && (
              <div className="dtp__presets">
                {presets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="dtp__preset"
                    onClick={() => {
                      const next = clamp(preset.value());
                      onChange(next);
                      setMonth(startOfDay(next));
                      setFocused(startOfDay(next));
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            )}

            <div className="dtp__foot">
              {mode !== 'time' && (
                <button type="button" className="button button--ghost button--small" onClick={() => pickDay(startOfDay(new Date()))}>
                  Today
                </button>
              )}
              <span className="dpitem__spacer" />
              {clearable && value !== null && (
                <button type="button" className="button button--ghost button--small" onClick={() => onChange(null)}>
                  Clear
                </button>
              )}
              <button type="button" className="button button--primary button--small" onClick={() => setOpen(false)}>
                Done
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
