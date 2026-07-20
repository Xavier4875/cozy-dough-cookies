import { useState } from 'react';
import {
  PICKUP_WEEKDAY_LABELS as WEEKDAY_LABELS,
  PICKUP_OPEN_MINUTES as OPEN_MINUTES,
  PICKUP_CLOSE_MINUTES as CLOSE_MINUTES,
  PICKUP_MIN_NOTICE_MS as MIN_NOTICE_MS,
  PICKUP_MAX_MONTHS_AHEAD as MAX_MONTHS_AHEAD,
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

function isSameDay(a, b) {
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

// A date is selectable if it has at least one time slot (10:00am-7:00pm,
// 15-min increments) that's still at least 24 hours out. The latest possible
// slot on any given day is 7:00pm, so checking just that slot against the
// 24-hour floor is enough to decide the whole day — no need to check every
// slot individually. This is what makes "today" always non-clickable (24
// hours from any moment always lands on a later calendar date) and, on the
// rare day where even tomorrow's close time doesn't clear the bar, correctly
// pushes the earliest selectable day out to the day after.
function isDateSelectable(date, now) {
  const dayClose = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    Math.floor(CLOSE_MINUTES / 60),
    CLOSE_MINUTES % 60
  );
  return dayClose.getTime() - now.getTime() >= MIN_NOTICE_MS;
}

function getTimeSlots(date, now) {
  const slots = [];
  for (let minutes = OPEN_MINUTES; minutes <= CLOSE_MINUTES; minutes += 15) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const slotDateTime = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
    slots.push({
      time: `${pad2(hour)}:${pad2(minute)}`,
      enabled: slotDateTime.getTime() - now.getTime() >= MIN_NOTICE_MS,
    });
  }
  return slots;
}

function PickupScheduleModal({ isOpen, orders = [], onCancel, onConfirm }) {
  const [step, setStep] = useState('date');
  const [viewedMonth, setViewedMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);

  if (!isOpen) return null;

  function handleCancel() {
    setStep('date');
    setViewedMonth(startOfMonth(new Date()));
    setSelectedDate(null);
    setSelectedTime(null);
    onCancel();
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
        <h2>Schedule Pickup</h2>

        {step === 'date' && (
          <>
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
                const selectable = isDateSelectable(date, now);
                const selected = selectedDate && isSameDay(date, selectedDate);
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
                      setStep('time');
                    }}
                  >
                    {date.getDate()}
                  </button>
                );
              })}
            </div>

            <div className="pickup-schedule-actions">
              <button type="button" className="pickup-schedule-cancel-btn" onClick={handleCancel}>
                Cancel
              </button>
            </div>
          </>
        )}

        {step === 'time' && selectedDate && (
          <>
            <p className="pickup-schedule-subtitle">{formatDateLong(selectedDate)}</p>
            <div className="pickup-schedule-time-grid">
              {getTimeSlots(selectedDate, now).map((slot) => (
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
                        {item.cookie.flavor} ({item.cookie.sizeLabel}) × {item.qty}
                      </span>
                      <span>${(item.cookie.price * item.qty).toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="cart-total">Total: ${grandTotal.toFixed(2)}</p>
            <p className="pickup-schedule-subtitle">
              Pickup: {formatDateLong(selectedDate)} at {formatTime12h(selectedTime)}
            </p>
            <div className="pickup-schedule-actions">
              <button type="button" className="pickup-schedule-cancel-btn" onClick={() => setStep('time')}>
                Back
              </button>
              <button
                type="button"
                className="checkout-btn"
                onClick={() => onConfirm(toDateKey(selectedDate), selectedTime)}
              >
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
