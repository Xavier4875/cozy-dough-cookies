import { useState } from 'react';
import {
  PICKUP_WEEKDAY_LABELS as WEEKDAY_LABELS,
  PICKUP_OPEN_MINUTES as OPEN_MINUTES,
  PICKUP_CLOSE_MINUTES as CLOSE_MINUTES,
  PICKUP_MAX_MONTHS_AHEAD as MAX_MONTHS_AHEAD,
  PICKUP_EXTENDED_NOTICE_MS as EXTENDED_NOTICE_MS,
  sizeLabelWithMarker,
  dietaryMarker,
} from '../constants.js';
import './PickupScheduleModal.css';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, n) {
  return new Date(date.getFullYear(), date.getMonth() + n, 1);
}

function isSameCalendarDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function toDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatMonthYear(date) {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function formatDateLong(date) {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime12h(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${pad2(m)} ${period}`;
}

// Today is deliberately excluded from the normal calendar — same-day pickup
// only goes through the "Request same day pickup" link below (see
// handleSameDayClick), which is itself hidden when minNoticeMs rules same-day
// out entirely (48 hours can never fit inside "today"). Past dates (earlier
// this month) are excluded too. minNoticeMs is 0 for a regular order (any
// future date is selectable outright) or PICKUP_EXTENDED_NOTICE_MS for an
// order containing a gluten-free/sugar-free item, in which case a date is
// only selectable if its closing time actually clears the floor.
function isDateSelectable(date, now, minNoticeMs) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (date.getTime() <= today.getTime()) return false;
  if (minNoticeMs === 0) return true;
  const dayClose = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    Math.floor(CLOSE_MINUTES / 60),
    CLOSE_MINUTES % 60
  );
  return dayClose.getTime() - now.getTime() >= minNoticeMs;
}

function getTimeSlots(date, now, minNoticeMs) {
  const slots = [];
  for (let minutes = OPEN_MINUTES; minutes <= CLOSE_MINUTES; minutes += 15) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const slotDateTime = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
    slots.push({
      time: `${pad2(hour)}:${pad2(minute)}`,
      enabled: slotDateTime.getTime() - now.getTime() >= minNoticeMs,
    });
  }
  return slots;
}

// Re-checks a selected slot against a freshly-read Date.now(), not the
// possibly-minutes-stale `now` the time grid was rendered with — the grid's
// "enabled" flags only get recomputed on a re-render, so a slot picked while
// valid can still tip past the floor (or into the past) if the customer
// idles on the confirm step before actually submitting. The server
// independently re-validates this exact rule regardless
// (validatePickupDateTime/validateExtendedPickupNotice in backend/index.js),
// so this is purely about failing fast in the UI instead of letting a stale
// click reach the network first.
function isSlotStillValid(date, time, minNoticeMs) {
  const [hour, minute] = time.split(':').map(Number);
  const slotDateTime = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
  return slotDateTime.getTime() - Date.now() >= minNoticeMs;
}

function PickupScheduleModal({ isOpen, orders = [], onCancel, onConfirm }) {
  const [step, setStep] = useState('date');
  const [viewedMonth, setViewedMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);
  const [sameDayPickup, setSameDayPickup] = useState(false);
  const [timeError, setTimeError] = useState('');

  if (!isOpen) return null;

  function handleCancel() {
    setStep('date');
    setViewedMonth(startOfMonth(new Date()));
    setSelectedDate(null);
    setSelectedTime(null);
    setSameDayPickup(false);
    setTimeError('');
    onCancel();
  }

  // Gluten-free/sugar-free batches need real lead time to bake — see
  // PICKUP_EXTENDED_NOTICE_MS. `orders` covers whichever order(s) are being
  // scheduled here (a single order at a time, or all of them at once — see
  // CartDrawerContent), so this flag applies for the whole modal session
  // rather than per date/slot.
  const requiresExtendedNotice = orders.some((order) =>
    order.items.some((item) => dietaryMarker(item.cookie.type))
  );
  const minNoticeMs = requiresExtendedNotice ? EXTENDED_NOTICE_MS : 0;

  // Re-validated right here rather than trusting whatever was true when the
  // time grid last rendered — see isSlotStillValid's comment. A slot that's
  // since slipped past the floor (or into the past) bounces the customer
  // back to the time step with an explanation instead of submitting a
  // doomed request.
  function handleConfirmClick() {
    if (!isSlotStillValid(selectedDate, selectedTime, minNoticeMs)) {
      setSelectedTime(null);
      setTimeError(
        requiresExtendedNotice
          ? 'That time no longer clears the 48-hour notice window — please pick a later one.'
          : 'That time has since passed — please pick a new one.'
      );
      setStep('time');
      return;
    }
    onConfirm(toDateKey(selectedDate), selectedTime);
  }

  // The normal calendar never allows selecting today (see isDateSelectable
  // above) — this is the only way to get today's date into selectedDate.
  // Not offered at all when requiresExtendedNotice — see the render below.
  function handleSameDayClick() {
    setSelectedDate(new Date());
    setSameDayPickup(true);
    setStep('time');
  }

  const now = new Date();
  const currentRealMonth = startOfMonth(now);
  const maxMonth = addMonths(currentRealMonth, MAX_MONTHS_AHEAD);
  const canGoPrevMonth = viewedMonth.getTime() > currentRealMonth.getTime();
  const canGoNextMonth = viewedMonth.getTime() < maxMonth.getTime();

  const daysInMonth = new Date(viewedMonth.getFullYear(), viewedMonth.getMonth() + 1, 0).getDate();
  const firstWeekday = viewedMonth.getDay();
  const dayCells = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(viewedMonth.getFullYear(), viewedMonth.getMonth(), i + 1)),
  ];

  const grandTotal = orders.reduce((sum, order) => sum + order.total, 0);

  return (
    <div className="pickup-schedule-overlay" onClick={handleCancel}>
      <div className="pickup-schedule-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Request a Pickup Time</h2>

        {step === 'date' && (
          <>
            {requiresExtendedNotice && (
              <p className="pickup-schedule-notice-note">
                Gluten-free/sugar-free orders need at least 48 hours notice for pickup.
              </p>
            )}
            <div className="pickup-schedule-calendar-header">
              <button
                type="button"
                className="pickup-schedule-month-nav"
                onClick={() => setViewedMonth((m) => addMonths(m, -1))}
                disabled={!canGoPrevMonth}
                aria-label="Previous month"
              >
                ◀
              </button>
              <span className="pickup-schedule-month-label">{formatMonthYear(viewedMonth)}</span>
              <button
                type="button"
                className="pickup-schedule-month-nav"
                onClick={() => setViewedMonth((m) => addMonths(m, 1))}
                disabled={!canGoNextMonth}
                aria-label="Next month"
              >
                ▶
              </button>
            </div>

            <div className="pickup-schedule-weekdays">
              {WEEKDAY_LABELS.map((label) => (
                <span key={label} className="pickup-schedule-weekday">
                  {label}
                </span>
              ))}
            </div>

            <div className="pickup-schedule-grid">
              {dayCells.map((date, i) => {
                if (!date) return <span key={`blank-${i}`} />;
                const selectable = isDateSelectable(date, now, minNoticeMs);
                const selected = selectedDate && isSameCalendarDay(date, selectedDate);
                return (
                  <button
                    type="button"
                    key={toDateKey(date)}
                    className={
                      'pickup-schedule-day' +
                      (selected ? ' pickup-schedule-day--selected' : '') +
                      (!selectable ? ' pickup-schedule-day--disabled' : '')
                    }
                    disabled={!selectable}
                    onClick={() => {
                      setSelectedDate(date);
                      setSameDayPickup(false);
                      setStep('time');
                    }}
                  >
                    {date.getDate()}
                  </button>
                );
              })}
            </div>

            {!requiresExtendedNotice && (
              <button type="button" className="pickup-schedule-same-day-link" onClick={handleSameDayClick}>
                Request same day pickup
              </button>
            )}

            <div className="pickup-schedule-actions">
              <button type="button" className="pickup-schedule-cancel-btn" onClick={handleCancel}>
                Cancel
              </button>
            </div>
          </>
        )}

        {step === 'time' && selectedDate && (
          <>
            <p className="pickup-schedule-subtitle">
              {sameDayPickup ? 'Same Day Pickup' : formatDateLong(selectedDate)}
            </p>
            {timeError && <p className="pickup-schedule-time-error">{timeError}</p>}
            <div className="pickup-schedule-time-grid">
              {getTimeSlots(selectedDate, now, minNoticeMs).map((slot) => (
                <button
                  type="button"
                  key={slot.time}
                  className={
                    'pickup-schedule-time-slot' +
                    (slot.time === selectedTime ? ' pickup-schedule-time-slot--selected' : '') +
                    (!slot.enabled ? ' pickup-schedule-time-slot--disabled' : '')
                  }
                  disabled={!slot.enabled}
                  onClick={() => {
                    setSelectedTime(slot.time);
                    setTimeError('');
                    setStep('confirm');
                  }}
                >
                  {formatTime12h(slot.time)}
                </button>
              ))}
            </div>
            <div className="pickup-schedule-actions">
              <button type="button" className="pickup-schedule-cancel-btn" onClick={() => setStep('date')}>
                Back
              </button>
            </div>
          </>
        )}

        {step === 'confirm' && selectedDate && selectedTime && (
          <>
            {orders.map((order, i) => (
              <div key={order.id}>
                {orders.length > 1 && (
                  <p className="pickup-schedule-order-label">Order {i + 1}</p>
                )}
                <ul className="cart-list">
                  {order.items.map((item) => (
                    <li key={item.cookie.id}>
                      <span>
                        {item.cookie.flavor} ({sizeLabelWithMarker(item.cookie)}) × {item.qty}
                      </span>
                      <span>${(item.cookie.price * item.qty).toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="cart-total">Total: ${grandTotal.toFixed(2)}</p>
            <p className="pickup-schedule-subtitle">
              {sameDayPickup
                ? `Same Day Pickup: ${formatTime12h(selectedTime)}`
                : `Pickup: ${formatDateLong(selectedDate)} at ${formatTime12h(selectedTime)}`}
            </p>
            <div className="pickup-schedule-actions">
              <button type="button" className="pickup-schedule-cancel-btn" onClick={() => setStep('time')}>
                Back
              </button>
              <button type="button" className="checkout-btn" onClick={handleConfirmClick}>
                Confirm &amp; Place Order
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default PickupScheduleModal;
