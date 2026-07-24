import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/useAuth.js';
import Mascot from '../components/Mascot.jsx';
import OrderHistoryList from '../components/OrderHistoryList.jsx';
import { PICKUP_OPEN_MINUTES, PICKUP_CLOSE_MINUTES } from '../constants.js';
import './OrderTracking.css';

// Time-slot options for the staff pickup-time edit form — same grid-of-
// buttons approach as the customer's PickupScheduleModal, just built inline
// here rather than imported, since this list is otherwise unused this file.
const PICKUP_TIME_SLOTS = [];
for (let minutes = PICKUP_OPEN_MINUTES; minutes <= PICKUP_CLOSE_MINUTES; minutes += 15) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  PICKUP_TIME_SLOTS.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
}

// pickupDate/time are plain wall-clock strings (see formatPickupDateTime
// below) — built as a local Date the same way, so this compares apples to
// apples against the real current moment.
function isSlotBeforeNow(pickupDate, time) {
  if (!pickupDate) return false;
  const [year, month, day] = pickupDate.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute).getTime() < Date.now();
}

function formatOrderDate(isoString) {
  return new Date(isoString).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// pickupDate/pickupTime are plain "YYYY-MM-DD"/"HH:MM" wall-clock strings
// (no timezone info — see PickupScheduleModal), so this builds a local Date
// directly from the components rather than parsing them as an ISO instant.
function formatPickupDateTime(pickupDate, pickupTime) {
  const [year, month, day] = pickupDate.split('-').map(Number);
  const [hour, minute] = pickupTime.split(':').map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  return date.toLocaleString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatShippingAddress(shippingAddress) {
  // Legacy orders (placed before structured addresses existed) stored this
  // as a plain free-text string — render it as-is rather than crashing.
  if (typeof shippingAddress === 'string') return shippingAddress;
  const { line1, line2, city, state, zip } = shippingAddress;
  return [line1, line2, `${city}, ${state} ${zip}`].filter(Boolean).join(', ');
}

function formatTime12h(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

// A pickup date equal to the order's own placement date can only happen via
// the "Request same day pickup" link (PickupScheduleModal's normal calendar
// never allows selecting today), so this comparison alone tells same-day
// requests apart from ordinary ones — no separate flag stored on the order,
// and it stays correct even after staff edit the pickup time here.
function isSameDayPickup(order) {
  const placed = new Date(order.createdAt);
  const placedKey = `${placed.getFullYear()}-${String(placed.getMonth() + 1).padStart(2, '0')}-${String(placed.getDate()).padStart(2, '0')}`;
  return order.fulfillment.pickupDate === placedKey;
}

// order.status progresses placed -> confirmed -> ready -> completed for both
// fulfillment methods; STAGE_LABELS is the only place that method-specific
// wording lives (the backend just tracks generic stage names). Used both for
// the stage-pill button text and the "current stage" label in Recent Orders.
const STAGE_LABELS = {
  pickup: {
    placed: 'Placed',
    confirmed: 'Confirmed',
    ready: 'Ready for Pickup',
    completed: 'Picked Up',
    canceled: 'Canceled',
  },
  shipping: {
    placed: 'Placed',
    confirmed: 'Confirmed',
    ready: 'Shipped',
    completed: 'Delivered',
    canceled: 'Canceled',
  },
};

// The three stages staff can freely move an order between (in either
// direction) right up until it's completed — completion is a separate,
// one-way action, not one of these.
const ACTIVE_STAGES = ['placed', 'confirmed', 'ready'];

// Color/checkmark treatment for each stage, same across both fulfillment
// methods: gray (nothing's happened yet) -> green checkmark -> blue
// checkmark. 'completed' reuses 'ready's blue — it's the same milestone
// tier, just the final step of it. 'canceled' gets its own red/✕ treatment
// (see StatusBadge) since it isn't a "step completed successfully" the way
// the others are.
const STAGE_BADGE_CLASS = {
  placed: 'order-tracking-status-badge--placed',
  confirmed: 'order-tracking-status-badge--confirmed',
  ready: 'order-tracking-status-badge--ready',
  completed: 'order-tracking-status-badge--ready',
  canceled: 'order-tracking-status-badge--canceled',
};

// Plain colored text, not a button — this is a status indicator, not a
// control (the actual control is the "Change Order Status" button next to
// it in the active-order row).
function StatusBadge({ status, label }) {
  const prefix = status === 'placed' ? '' : status === 'canceled' ? '✕ ' : '✓ ';
  return (
    <span className={'order-tracking-status-badge ' + STAGE_BADGE_CLASS[status]}>
      {prefix}
      {label}
    </span>
  );
}

// The pickup row is purely about the requested time — confirming/adjusting
// it is decoupled from the order's overall stage (that lives in
// OrderStatusCell below), so Edit is always available here regardless of
// stage, right up until the order is completed (readOnly).
function PickupTimeCell({
  order,
  readOnly,
  isEditing,
  editForm,
  onEditFormChange,
  isSaving,
  error,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
}) {
  if (!readOnly && isEditing) {
    return (
      <div className="order-tracking-edit-form">
        <label>
          Date
          <input
            type="date"
            value={editForm.pickupDate}
            onChange={(e) => onEditFormChange({ ...editForm, pickupDate: e.target.value })}
          />
        </label>
        <label>
          Time
          <div className="order-tracking-time-grid">
            {PICKUP_TIME_SLOTS.map((time) => {
              const isSelected = time === editForm.pickupTime;
              // The order's already-selected time stays clickable/visible
              // even if it's since slipped into the past — only other past
              // slots gray out, since disabling the current value would make
              // an existing past-dated edit look stuck.
              const isPast = !isSelected && isSlotBeforeNow(editForm.pickupDate, time);
              return (
                <button
                  type="button"
                  key={time}
                  disabled={isPast}
                  className={
                    'order-tracking-time-slot' +
                    (isSelected ? ' order-tracking-time-slot--selected' : '') +
                    (isPast ? ' order-tracking-time-slot--disabled' : '')
                  }
                  onClick={() => onEditFormChange({ ...editForm, pickupTime: time })}
                >
                  {formatTime12h(time)}
                </button>
              );
            })}
          </div>
        </label>
        <label>
          Note to customer (optional)
          <textarea
            value={editForm.note}
            onChange={(e) => onEditFormChange({ ...editForm, note: e.target.value })}
            placeholder="e.g. We're closed at that time — moved you to 2:00 PM."
          />
        </label>
        {error && <p className="order-tracking-action-error">{error}</p>}
        <div className="order-tracking-edit-actions">
          <button type="button" onClick={onCancelEdit} disabled={isSaving}>
            Cancel
          </button>
          <button type="button" className="order-tracking-save-btn" onClick={onSaveEdit} disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="order-tracking-stage-value">
        <span>
          {order.fulfillment.pickupDate && order.fulfillment.pickupTime
            ? isSameDayPickup(order)
              ? `Same Day Pickup: ${formatTime12h(order.fulfillment.pickupTime)}`
              : formatPickupDateTime(order.fulfillment.pickupDate, order.fulfillment.pickupTime)
            : 'Not yet scheduled'}
        </span>
        {/* order.confirmedAt, not order.status !== 'placed' — a canceled
            order can reach a non-'placed' status without ever having
            actually been confirmed (e.g. canceled directly from Placed). */}
        {order.confirmedAt && <span className="order-tracking-confirmed-badge">Confirmed ✓</span>}
      </div>
      {order.fulfillment.staffNote && (
        <p className="order-tracking-staff-note">Note: {order.fulfillment.staffNote}</p>
      )}
      {!readOnly && error && <p className="order-tracking-action-error">{error}</p>}
      {!readOnly && (
        <div className="order-tracking-stage-actions">
          <button type="button" onClick={onStartEdit} disabled={isSaving}>
            Edit
          </button>
        </div>
      )}
    </>
  );
}

// The modal behind "Change Order Status" — lists the three freely-correctable
// stages (forward or backward), pre-highlighting whichever comes right after
// the order's current one as a "Suggested" default. Every option stays
// clickable regardless (staff can pick any of them, not just the suggestion);
// clicking one applies it immediately and closes the modal, same single-click
// convention as every other staff action in this file.
function ChangeStatusModal({ status, labels, isSaving, error, onSelect, onClose }) {
  const currentIndex = ACTIVE_STAGES.indexOf(status);
  const nextStage = ACTIVE_STAGES[currentIndex + 1];

  return (
    <div className="change-status-overlay" onClick={onClose}>
      <div className="change-status-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Change Order Status</h2>
        {error && <p className="order-tracking-action-error">{error}</p>}
        <div className="change-status-options">
          {ACTIVE_STAGES.map((stage) => (
            <button
              key={stage}
              type="button"
              className={
                'change-status-option' +
                (stage === status ? ' change-status-option--current' : '') +
                (stage === nextStage ? ' change-status-option--suggested' : '')
              }
              onClick={() => onSelect(stage)}
              disabled={isSaving || stage === status}
            >
              {labels[stage]}
              {stage === nextStage && <span className="change-status-suggested-tag">Suggested</span>}
            </button>
          ))}
        </div>
        <div className="change-status-actions">
          <button type="button" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// The general stage control, shared by both fulfillment methods: a badge
// showing the current stage, and a single "Change Order Status" button that
// opens ChangeStatusModal — the recovery path for misclicks (undoing an
// accidental Confirm is just picking "Placed" there). Once an order reaches
// 'ready', a separate, distinctly-styled button appears for the one
// remaining one-way action: marking it Picked Up/Delivered, which completes
// the order and ends this free-editing window. That action stays outside
// the modal on purpose — it's not one of the freely-correctable stages.
function OrderStatusCell({ order, method, readOnly, isSaving, error, onSetStatus, onComplete }) {
  const { status } = order;
  const labels = STAGE_LABELS[method];
  const [isModalOpen, setIsModalOpen] = useState(false);

  if (readOnly) {
    return (
      <div className="order-tracking-stage-value">
        <StatusBadge status={status} label={labels[status]} />
      </div>
    );
  }

  return (
    <>
      {error && !isModalOpen && <p className="order-tracking-action-error">{error}</p>}
      <div className="order-tracking-status-row">
        <StatusBadge status={status} label={labels[status]} />
        <button type="button" onClick={() => setIsModalOpen(true)} disabled={isSaving}>
          Change Order Status
        </button>
      </div>
      {status === 'ready' && (
        <div className="order-tracking-stage-actions">
          <button type="button" className="order-tracking-confirm-btn" onClick={onComplete} disabled={isSaving}>
            {isSaving ? 'Saving…' : labels.completed}
          </button>
        </div>
      )}
      {isModalOpen && (
        <ChangeStatusModal
          status={status}
          labels={labels}
          isSaving={isSaving}
          error={error}
          onSelect={(stage) => {
            onSetStatus(stage);
            setIsModalOpen(false);
          }}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </>
  );
}

// Shown only in Recent Orders (readOnly) — the placement time already has
// its own line above the table, so this only needs the later stages.
function OrderTimeline({ order }) {
  const isShipping = order.fulfillment?.method === 'shipping';
  const readyLabel = isShipping ? 'Shipped' : 'Ready for Pickup';
  const completedLabel = isShipping ? 'Delivered' : 'Picked Up';

  return (
    <ul className="order-tracking-timeline">
      {order.confirmedAt && (
        <li>
          <span>Confirmed</span>
          <span>{formatOrderDate(order.confirmedAt)}</span>
        </li>
      )}
      {order.readyAt && (
        <li>
          <span>{readyLabel}</span>
          <span>{formatOrderDate(order.readyAt)}</span>
        </li>
      )}
      {order.completedAt && (
        <li>
          <span>{completedLabel}</span>
          <span>{formatOrderDate(order.completedAt)}</span>
        </li>
      )}
      {order.canceledAt && (
        <li>
          <span>Canceled</span>
          <span>{formatOrderDate(order.canceledAt)}</span>
        </li>
      )}
    </ul>
  );
}

const CANCEL_PHRASE = 'cancel order';

// Two-step confirmation before an order is actually stopped, modeled
// directly on DeleteAccountModal.jsx's warn -> type-to-confirm shape: a
// stray click on the red "✕" only ever reaches the warning step; canceling
// for real requires deliberately typing the phrase.
function CancelOrderModal({ isSaving, error, onConfirm, onClose }) {
  const [step, setStep] = useState('warn');
  const [typedPhrase, setTypedPhrase] = useState('');
  const [formError, setFormError] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    if (typedPhrase.trim().toLowerCase() !== CANCEL_PHRASE) {
      setFormError(`Type "${CANCEL_PHRASE}" exactly to confirm.`);
      return;
    }
    setFormError('');
    onConfirm();
  }

  return (
    <div className="cancel-order-overlay" onClick={onClose}>
      <div className="cancel-order-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Cancel Order</h2>
        {step === 'warn' ? (
          <>
            <p>Are you sure you&apos;d like to cancel this order? This can&apos;t be undone.</p>
            <div className="cancel-order-actions">
              <button type="button" className="cancel-order-cancel-btn" onClick={onClose}>
                No
              </button>
              <button type="button" className="cancel-order-confirm-btn" onClick={() => setStep('type')}>
                Yes
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <p>
              Type <strong>{CANCEL_PHRASE}</strong> below and press Submit to cancel this order.
            </p>
            <input
              type="text"
              className="cancel-order-input"
              value={typedPhrase}
              onChange={(e) => setTypedPhrase(e.target.value)}
              autoFocus
            />
            {(formError || error) && <p className="order-tracking-action-error">{formError || error}</p>}
            <div className="cancel-order-actions">
              <button type="button" className="cancel-order-cancel-btn" onClick={onClose} disabled={isSaving}>
                Close
              </button>
              <button type="submit" className="cancel-order-confirm-btn" disabled={isSaving}>
                {isSaving ? 'Canceling…' : 'Submit'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function OrderTable({ order, pickupCellProps = {}, statusCellProps = {}, readOnly = false, onCancel }) {
  return (
    <>
      <div className="order-tracking-order-header">
        <p className="order-tracking-placed-at">Placed: {formatOrderDate(order.createdAt)}</p>
        {onCancel && (
          <button type="button" className="order-tracking-cancel-btn" onClick={onCancel} aria-label="Cancel order">
            ✕
          </button>
        )}
      </div>
      {readOnly && <OrderTimeline order={order} />}
      <table className="order-tracking-table">
        <tbody>
          <tr>
            <th>Customer</th>
            <td>
              {order.contact.firstName} {order.contact.lastName} ({order.email})
            </td>
          </tr>
          <tr>
            <th>Items</th>
            <td>
              <ul className="cart-list">
                {order.items.map((item) => (
                  <li key={item.id}>
                    <span>
                      {item.flavor} ({item.sizeLabel}) × {item.qty}
                    </span>
                    <span>${(item.price * item.qty).toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            </td>
          </tr>
          <tr>
            <th>Subtotal</th>
            <td>${order.subtotal.toFixed(2)}</td>
          </tr>
          {order.shippingFee !== undefined && (
            <tr>
              <th>Shipping &amp; handling</th>
              <td>${order.shippingFee.toFixed(2)}</td>
            </tr>
          )}
          <tr>
            <th>Total</th>
            <td>${order.total.toFixed(2)}</td>
          </tr>
          <tr>
            <th>Payment Method</th>
            <td>Card on file (placeholder)</td>
          </tr>
          {order.fulfillment?.method && (
            <tr>
              <th>Order Status</th>
              <td>
                <OrderStatusCell
                  order={order}
                  method={order.fulfillment.method}
                  readOnly={readOnly}
                  {...statusCellProps}
                />
              </td>
            </tr>
          )}
          {order.fulfillment?.method === 'pickup' && (
            <tr>
              <th>Requested Pickup Time</th>
              <td>
                <PickupTimeCell order={order} readOnly={readOnly} {...pickupCellProps} />
              </td>
            </tr>
          )}
          {order.fulfillment?.method === 'shipping' && order.fulfillment.shippingAddress && (
            <tr>
              <th>Shipping Address</th>
              <td>
                {formatShippingAddress(order.fulfillment.shippingAddress)}
                {order.fulfillment.addressVerified === false && (
                  <p className="order-tracking-unverified-note">
                    Address could not be verified — please double-check it's correct.
                  </p>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

const SEARCH_FIELDS = [
  { value: 'firstName', label: 'First Name' },
  { value: 'lastName', label: 'Last Name' },
  { value: 'email', label: 'Email' },
];

// Staff's lookup tool: search registered customers and guest checkouts by
// one field, or (query empty) see every distinct guest by default — guests
// never get a Customers row, so this is their only way to be found again.
// Debounced 300ms so fast typing doesn't fire the search endpoint (which
// backs two full-table Scans — see backend/index.js) once per keystroke.
// Selecting a result hands its full order history to OrderHistoryList, the
// same component the customer sees on their own My Orders page.
function PastOrdersPanel({ getIdToken }) {
  const [field, setField] = useState('firstName');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [accountOrders, setAccountOrders] = useState([]);
  const [accountOrdersLoading, setAccountOrdersLoading] = useState(false);

  // Guards against a slow, stale account-history fetch clobbering a newer
  // one — e.g. select A, go back before it resolves, select B; without this,
  // A's response could still land after B's and overwrite B's orders while
  // the header keeps reading "B's Orders". Keyed by customerId/email rather
  // than a boolean flag since (unlike the debounced search effect above)
  // this fires from a plain event handler, not a useEffect with its own
  // cleanup — a ref holding "whichever account was selected most recently"
  // is the equivalent for that shape.
  const latestAccountKeyRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setResultsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const token = await getIdToken();
        const params = new URLSearchParams({ field, q: query });
        const res = await fetch(`/api/customers/search?${params}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json();
        if (!cancelled) setResults(res.ok ? data.accounts : []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setResultsLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [field, query]);

  function handleSelectAccount(account) {
    const requestKey = account.customerId ?? account.email;
    latestAccountKeyRef.current = requestKey;
    setSelectedAccount(account);
    setAccountOrdersLoading(true);
    (async () => {
      try {
        const token = await getIdToken();
        const params = account.customerId
          ? new URLSearchParams({ customerId: account.customerId })
          : new URLSearchParams({ email: account.email });
        const res = await fetch(`/api/orders/history?${params}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json();
        if (latestAccountKeyRef.current !== requestKey) return;
        setAccountOrders(res.ok ? data.orders : []);
      } catch {
        if (latestAccountKeyRef.current !== requestKey) return;
        setAccountOrders([]);
      } finally {
        if (latestAccountKeyRef.current === requestKey) setAccountOrdersLoading(false);
      }
    })();
  }

  if (selectedAccount) {
    return (
      <div className="order-tracking-past-orders">
        <button type="button" className="order-tracking-search-back" onClick={() => setSelectedAccount(null)}>
          ← Back to search
        </button>
        <h2>
          {selectedAccount.firstName} {selectedAccount.lastName}&apos;s Orders
        </h2>
        <OrderHistoryList orders={accountOrders} loading={accountOrdersLoading} />
      </div>
    );
  }

  const fieldLabel = SEARCH_FIELDS.find((f) => f.value === field).label;

  return (
    <div className="order-tracking-past-orders">
      <div className="order-tracking-search-row">
        <label>
          Search by
          <select value={field} onChange={(e) => setField(e.target.value)} className="order-tracking-search-select">
            {SEARCH_FIELDS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <input
          type="text"
          className="order-tracking-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search by ${fieldLabel.toLowerCase()}...`}
        />
      </div>
      {resultsLoading ? (
        <p className="empty-cart">Loading...</p>
      ) : results.length === 0 ? (
        <p className="empty-cart">{query ? 'No matching accounts.' : 'No guest orders yet.'}</p>
      ) : (
        <div className="order-tracking-search-results">
          {results.map((account) => (
            <button
              key={account.customerId ?? account.email}
              type="button"
              className="order-tracking-search-result"
              onClick={() => handleSelectAccount(account)}
            >
              {account.firstName} {account.lastName} ({account.email})
              {account.type === 'guest' && <span className="order-tracking-search-guest-tag">Guest</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OrderTracking() {
  const { isAuthenticated, user, getIdToken } = useAuth();
  const [tab, setTab] = useState('active');
  const [activeOrders, setActiveOrders] = useState([]);
  const [activeOrdersLoading, setActiveOrdersLoading] = useState(false);
  const [recentOrders, setRecentOrders] = useState([]);
  const [recentOrdersLoading, setRecentOrdersLoading] = useState(false);
  const [recentOrdersFetched, setRecentOrdersFetched] = useState(false);

  // Pickup edit state — only one order's row is ever mid-edit at a time, but
  // "saving" and "error" are tracked per order id since any row's status
  // pills/Complete button can be clicked independent of which (if any) row
  // is mid-edit. Shared across submitPickupConfirmation, handleSetStatus,
  // and handleComplete — only one action is ever in flight for a given
  // order at a time either way.
  const [editingOrderId, setEditingOrderId] = useState(null);
  const [editForm, setEditForm] = useState({ pickupDate: '', pickupTime: '', note: '' });
  const [savingOrderId, setSavingOrderId] = useState(null);
  const [errorsByOrderId, setErrorsByOrderId] = useState({});

  // Which order's cancel-confirmation modal is open — only one at a time,
  // same shape as editingOrderId.
  const [cancelingOrderId, setCancelingOrderId] = useState(null);

  const isStaff = isAuthenticated && user.role === 'staff';

  useEffect(() => {
    if (!isStaff) return;
    let cancelled = false;
    (async () => {
      setActiveOrdersLoading(true);
      try {
        const token = await getIdToken();
        const res = await fetch('/api/orders/active', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json();
        if (!cancelled) setActiveOrders(res.ok ? data.orders : []);
      } catch {
        if (!cancelled) setActiveOrders([]);
      } finally {
        if (!cancelled) setActiveOrdersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isStaff]);

  // Recent Orders is fetched lazily, the first time that tab is opened —
  // there's no reason to pay for it on every Order Tracking visit.
  useEffect(() => {
    if (!isStaff || tab !== 'recent' || recentOrdersFetched) return;
    let cancelled = false;
    (async () => {
      setRecentOrdersLoading(true);
      try {
        const token = await getIdToken();
        const res = await fetch('/api/orders/recent', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json();
        if (!cancelled) {
          setRecentOrders(res.ok ? data.orders : []);
          setRecentOrdersFetched(true);
        }
      } catch {
        if (!cancelled) {
          setRecentOrders([]);
          setRecentOrdersFetched(true);
        }
      } finally {
        if (!cancelled) setRecentOrdersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isStaff, tab, recentOrdersFetched]);

  // Edit's Save handler — purely a fulfillment-record update now (the
  // backend no longer touches order.status here), so this works identically
  // regardless of what stage the order is currently in.
  //
  // Re-checks the picked time against a freshly-read now before ever
  // touching the network — the grid's "grayed out" state only updates on a
  // re-render, so a slot that was valid when the edit form opened can have
  // since slipped into the past if staff sat on the form a while. The
  // server independently re-validates this exact rule regardless
  // (validatePickupDateTime in backend/index.js), so this is purely about
  // failing fast in the UI instead of a doomed round trip.
  async function submitPickupConfirmation(orderId, pickupDate, pickupTime, note) {
    if (isSlotBeforeNow(pickupDate, pickupTime)) {
      setErrorsByOrderId((prev) => ({
        ...prev,
        [orderId]: 'That time has since passed — please pick a new one.',
      }));
      return;
    }
    setSavingOrderId(orderId);
    setErrorsByOrderId((prev) => ({ ...prev, [orderId]: '' }));
    try {
      const token = await getIdToken();
      const res = await fetch(`/api/orders/${orderId}/confirm-pickup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ pickupDate, pickupTime, note }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorsByOrderId((prev) => ({ ...prev, [orderId]: data.error || 'Failed to update pickup time.' }));
        return;
      }
      setActiveOrders((prev) =>
        prev.map((o) => (o.orderId === orderId ? { ...o, fulfillment: data.fulfillment } : o))
      );
      setEditingOrderId(null);
    } catch {
      setErrorsByOrderId((prev) => ({ ...prev, [orderId]: 'Failed to update pickup time.' }));
    } finally {
      setSavingOrderId(null);
    }
  }

  // The stage-pill click handler — free correction among placed/confirmed/
  // ready, any direction, for either fulfillment method. This is the
  // recovery path for misclicks: setting status back to 'placed' undoes an
  // accidental confirm.
  async function handleSetStatus(orderId, status) {
    setSavingOrderId(orderId);
    setErrorsByOrderId((prev) => ({ ...prev, [orderId]: '' }));
    try {
      const token = await getIdToken();
      const res = await fetch(`/api/orders/${orderId}/set-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorsByOrderId((prev) => ({ ...prev, [orderId]: data.error || 'Failed to update order status.' }));
        return;
      }
      setActiveOrders((prev) => prev.map((o) => (o.orderId === orderId ? { ...o, ...data } : o)));
    } catch {
      setErrorsByOrderId((prev) => ({ ...prev, [orderId]: 'Failed to update order status.' }));
    } finally {
      setSavingOrderId(null);
    }
  }

  // The one remaining one-way action — marking a ready order picked
  // up/delivered. Removes it from Active Orders immediately; it'll show up
  // under Recent Orders next time that tab is (re-)opened.
  async function handleComplete(orderId) {
    setSavingOrderId(orderId);
    setErrorsByOrderId((prev) => ({ ...prev, [orderId]: '' }));
    try {
      const token = await getIdToken();
      const res = await fetch(`/api/orders/${orderId}/complete`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorsByOrderId((prev) => ({ ...prev, [orderId]: data.error || 'Failed to complete order.' }));
        return;
      }
      setActiveOrders((prev) => prev.filter((o) => o.orderId !== orderId));
      setRecentOrdersFetched(false);
    } catch {
      setErrorsByOrderId((prev) => ({ ...prev, [orderId]: 'Failed to complete order.' }));
    } finally {
      setSavingOrderId(null);
    }
  }

  // The other terminal action — stopping an order entirely, reachable from
  // any active stage (not gated to 'ready' the way handleComplete is). Same
  // shape as handleComplete: remove from Active Orders immediately, refresh
  // the Recent Orders cache next time that tab opens.
  async function handleCancelOrder(orderId) {
    setSavingOrderId(orderId);
    setErrorsByOrderId((prev) => ({ ...prev, [orderId]: '' }));
    try {
      const token = await getIdToken();
      const res = await fetch(`/api/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorsByOrderId((prev) => ({ ...prev, [orderId]: data.error || 'Failed to cancel order.' }));
        return;
      }
      setActiveOrders((prev) => prev.filter((o) => o.orderId !== orderId));
      setRecentOrdersFetched(false);
      setCancelingOrderId(null);
    } catch {
      setErrorsByOrderId((prev) => ({ ...prev, [orderId]: 'Failed to cancel order.' }));
    } finally {
      setSavingOrderId(null);
    }
  }

  function handleStartEdit(order) {
    setEditingOrderId(order.orderId);
    setEditForm({
      pickupDate: order.fulfillment.pickupDate,
      pickupTime: order.fulfillment.pickupTime,
      note: '',
    });
    setErrorsByOrderId((prev) => ({ ...prev, [order.orderId]: '' }));
  }

  function handleCancelEdit(orderId) {
    setEditingOrderId(null);
    setErrorsByOrderId((prev) => ({ ...prev, [orderId]: '' }));
  }

  if (!isStaff) {
    return (
      <div className="order-tracking-page">
        <div className="page-mascot">
          <Mascot />
        </div>
        <p className="staff-access-note">Staff access required.</p>
      </div>
    );
  }

  return (
    <div className="order-tracking-page">
      <div className="page-mascot">
        <Mascot />
      </div>
      <h1>Order Tracking</h1>

      <div className="order-tracking-tabs">
        <button
          type="button"
          className={'order-tracking-tab' + (tab === 'active' ? ' order-tracking-tab--active' : '')}
          onClick={() => setTab('active')}
        >
          Active Orders
        </button>
        <button
          type="button"
          className={'order-tracking-tab' + (tab === 'recent' ? ' order-tracking-tab--active' : '')}
          onClick={() => setTab('recent')}
        >
          Recent Orders
        </button>
        <button
          type="button"
          className={'order-tracking-tab' + (tab === 'past' ? ' order-tracking-tab--active' : '')}
          onClick={() => setTab('past')}
        >
          Past Orders
        </button>
      </div>

      {tab === 'active' &&
        (activeOrdersLoading ? (
          <p className="empty-cart">Loading...</p>
        ) : activeOrders.length === 0 ? (
          <p className="empty-cart">No active orders.</p>
        ) : (
          activeOrders.map((order) => (
            <div key={order.orderId} className="order-tracking-order">
              <OrderTable
                order={order}
                pickupCellProps={{
                  isEditing: editingOrderId === order.orderId,
                  editForm,
                  onEditFormChange: setEditForm,
                  isSaving: savingOrderId === order.orderId,
                  error: errorsByOrderId[order.orderId],
                  onStartEdit: () => handleStartEdit(order),
                  onCancelEdit: () => handleCancelEdit(order.orderId),
                  onSaveEdit: () =>
                    submitPickupConfirmation(
                      order.orderId,
                      editForm.pickupDate,
                      editForm.pickupTime,
                      editForm.note
                    ),
                }}
                statusCellProps={{
                  isSaving: savingOrderId === order.orderId,
                  error: errorsByOrderId[order.orderId],
                  onSetStatus: (status) => handleSetStatus(order.orderId, status),
                  onComplete: () => handleComplete(order.orderId),
                }}
                onCancel={() => setCancelingOrderId(order.orderId)}
              />
            </div>
          ))
        ))}

      {cancelingOrderId && (
        <CancelOrderModal
          isSaving={savingOrderId === cancelingOrderId}
          error={errorsByOrderId[cancelingOrderId]}
          onConfirm={() => handleCancelOrder(cancelingOrderId)}
          onClose={() => setCancelingOrderId(null)}
        />
      )}

      {tab === 'recent' &&
        (recentOrdersLoading ? (
          <p className="empty-cart">Loading...</p>
        ) : recentOrders.length === 0 ? (
          <p className="empty-cart">No recent orders.</p>
        ) : (
          recentOrders.map((order) => (
            <div key={order.orderId} className="order-tracking-order">
              <OrderTable order={order} readOnly />
            </div>
          ))
        ))}

      {tab === 'past' && <PastOrdersPanel getIdToken={getIdToken} />}
    </div>
  );
}

export default OrderTracking;
