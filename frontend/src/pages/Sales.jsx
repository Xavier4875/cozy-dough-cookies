import { useEffect, useState } from 'react';
import { useAuth } from '../context/useAuth.js';
import Mascot from '../components/Mascot.jsx';
import './Sales.css';

const TABS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'Monthly' },
  { value: 'year', label: 'Yearly' },
  { value: 'total', label: 'Total' },
];

// Tabs with real data wired up — the rest are real, clickable, and
// correctly labeled, but show a placeholder until their data gets built
// out. Expanding later is just fetching the same endpoint with a different
// period, not new design work.
const SUPPORTED_TABS = ['today', 'week', 'month', 'year', 'total'];

// Fills in "No sales yet ___." when a supported tab's fetch comes back empty.
const PERIOD_LABELS = { today: 'today', week: 'this week', month: 'this month', year: 'this year', total: 'at all' };

// 'month' and 'year' need extra query params (see backend/index.js's
// /api/sales) — every other supported period is always relative to "now".
function salesUrlFor(tab, monthYear, yearValue) {
  if (tab === 'month') return `/api/sales?period=month&year=${monthYear.year}&month=${monthYear.month}`;
  if (tab === 'year') return `/api/sales?period=year&year=${yearValue}`;
  return `/api/sales?period=${tab}`;
}

// { year, month (1-12) } -> "July 2026", for the Monthly tab's header.
function formatMonthYear({ year, month }) {
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// 'YYYY-MM-DD' -> "Sunday, Jul 20", for the week tab's day headings.
function formatDayLabel(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

// day.date strings and this key share the same 'YYYY-MM-DD' local-date
// format, so a plain string comparison tells a not-yet-happened day apart
// from today/past days without any Date-object timezone juggling.
function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// The revenue figure, external-sales note, and Items Sold/Cookie Flavors
// dropdowns — shared by the top-level period total and, on the week tab,
// each individual day's section below it.
function SalesBreakdown({ data }) {
  return (
    <>
      <p className="sales-revenue">${data.totalRevenue.toFixed(2)}</p>
      {data.externalRevenue > 0 && (
        <p className="sales-revenue-note">*${data.externalRevenue.toFixed(2)} from external sales</p>
      )}

      <details className="sales-dropdown">
        <summary className="sales-section-title">Items Sold</summary>
        {data.itemsSold.length === 0 ? (
          <p className="empty-cart">No items sold yet.</p>
        ) : (
          <ol className="sales-rank-list">
            {data.itemsSold.map((item) => (
              <li key={`${item.flavor}|${item.sizeLabel}`}>
                <span>
                  {item.flavor} ({item.sizeLabel})
                </span>
                <span className="sales-rank-fill" aria-hidden="true" />
                <span>
                  {item.qty} sold (${item.revenue.toFixed(2)})
                </span>
              </li>
            ))}
          </ol>
        )}
      </details>

      <details className="sales-dropdown">
        <summary className="sales-section-title">Cookie Flavors</summary>
        {data.flavorsSold.length === 0 ? (
          <p className="empty-cart">No items sold yet.</p>
        ) : (
          <ol className="sales-rank-list">
            {data.flavorsSold.map((f) => (
              <li key={f.flavor}>
                <span>{f.flavor}</span>
                <span className="sales-rank-fill" aria-hidden="true" />
                <span>{f.cookies} cookies</span>
              </li>
            ))}
          </ol>
        )}
      </details>
    </>
  );
}

// The business's first year of operation — the dropdown's floor. Its
// ceiling is always the real current year (computed at render time, not a
// fixed number), so next year's dropdown gains 2027 on its own the moment
// the real calendar turns over, with no code change needed.
const BUSINESS_START_YEAR = 2025;

// Shared by MonthNav and YearNav below — a plain year dropdown spanning
// BUSINESS_START_YEAR through the real current year, with the real current
// year bolded/labeled so it's easy to spot again after paging away with
// the arrows. `pushRight` is for YearNav, where this is the only select in
// the row (MonthNav's month select already carries the push-right margin).
function YearSelect({ year, currentYear, onSelect, pushRight = false }) {
  return (
    <select
      className={'sales-year-select' + (pushRight ? ' sales-year-select--push-right' : '')}
      value={year}
      onChange={(e) => onSelect(Number(e.target.value))}
    >
      {Array.from({ length: currentYear - BUSINESS_START_YEAR + 1 }, (_, i) => BUSINESS_START_YEAR + i).map((y) => (
        <option key={y} value={y} style={y === currentYear ? { fontWeight: 'bold' } : undefined}>
          {y}
          {y === currentYear ? ' (Current)' : ''}
        </option>
      ))}
    </select>
  );
}

// Arrows step one month at a time and can freely cross into any year on
// their own; the year dropdown is the direct way to jump years. Both
// dropdowns bold/label the real current month or year so it's easy to spot
// again after paging away with the arrows.
function MonthNav({ monthYear, onShift, onSelect }) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  return (
    <div className="sales-month-nav">
      <button type="button" className="sales-month-arrow" onClick={() => onShift(-1)} aria-label="Previous month">
        ◀
      </button>
      <span className="sales-month-label">{formatMonthYear(monthYear)}</span>
      <button type="button" className="sales-month-arrow" onClick={() => onShift(1)} aria-label="Next month">
        ▶
      </button>
      <select
        className="sales-month-select"
        value={monthYear.month}
        onChange={(e) => onSelect({ year: monthYear.year, month: Number(e.target.value) })}
      >
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
          const isRealCurrent = m === currentMonth && monthYear.year === currentYear;
          return (
            <option key={m} value={m} style={isRealCurrent ? { fontWeight: 'bold' } : undefined}>
              {new Date(currentYear, m - 1, 1).toLocaleDateString(undefined, { month: 'long' })}
              {isRealCurrent ? ' (Current)' : ''}
            </option>
          );
        })}
      </select>
      <YearSelect
        year={monthYear.year}
        currentYear={currentYear}
        onSelect={(year) => onSelect({ year, month: monthYear.month })}
      />
    </div>
  );
}

// Yearly tab's equivalent of MonthNav — arrows step one year at a time,
// the dropdown jumps directly (same bounded range/highlight as MonthNav's).
function YearNav({ year, onShift, onSelect }) {
  const currentYear = new Date().getFullYear();

  return (
    <div className="sales-month-nav">
      <button type="button" className="sales-month-arrow" onClick={() => onShift(-1)} aria-label="Previous year">
        ◀
      </button>
      <span className="sales-month-label">{year}</span>
      <button type="button" className="sales-month-arrow" onClick={() => onShift(1)} aria-label="Next year">
        ▶
      </button>
      <YearSelect year={year} currentYear={currentYear} onSelect={onSelect} pushRight />
    </div>
  );
}

// A single dollar-amount input for a sale made outside the site (in person,
// a market, etc.) — no items/flavors, it only ever affects the revenue
// total, so there's nothing else to ask for here.
function AddSaleModal({ isSaving, error, onSubmit, onClose }) {
  const [amount, setAmount] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(amount);
  }

  return (
    <div className="sales-modal-overlay" onClick={onClose}>
      <div className="sales-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add External Sale</h2>
        <form onSubmit={handleSubmit}>
          <label className="sales-modal-label">
            Amount
            <input
              type="number"
              step="0.01"
              min="0.01"
              className="sales-modal-input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              autoFocus
            />
          </label>
          {error && <p className="sales-modal-error">{error}</p>}
          <div className="sales-modal-actions">
            <button type="button" className="sales-modal-cancel-btn" onClick={onClose} disabled={isSaving}>
              Cancel
            </button>
            <button type="submit" className="sales-modal-submit-btn" disabled={isSaving}>
              {isSaving ? 'Adding…' : 'Add Sale'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Sales() {
  const { isAuthenticated, user, getIdToken } = useAuth();
  const [tab, setTab] = useState('today');
  const [monthYear, setMonthYear] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [yearValue, setYearValue] = useState(() => new Date().getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isSaleModalOpen, setIsSaleModalOpen] = useState(false);
  const [saleSaving, setSaleSaving] = useState(false);
  const [saleError, setSaleError] = useState('');

  const isStaff = isAuthenticated && user.role === 'staff';

  function shiftMonth(delta) {
    setMonthYear(({ year, month }) => {
      const total = (year * 12 + (month - 1)) + delta;
      return { year: Math.floor(total / 12), month: (total % 12) + 1 };
    });
  }

  function shiftYear(delta) {
    setYearValue((year) => year + delta);
  }

  useEffect(() => {
    if (!isStaff || !SUPPORTED_TABS.includes(tab)) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getIdToken();
        const res = await fetch(salesUrlFor(tab, monthYear, yearValue), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const result = await res.json();
        if (!cancelled) setData(res.ok ? result : null);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isStaff, tab, monthYear, yearValue]);

  async function handleAddSale(rawAmount) {
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setSaleError('Enter an amount greater than $0.');
      return;
    }
    setSaleSaving(true);
    setSaleError('');
    try {
      const token = await getIdToken();
      const res = await fetch('/api/sales/external', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ amount }),
      });
      const result = await res.json();
      if (!res.ok) {
        setSaleError(result.error || 'Failed to add sale.');
        return;
      }
      setIsSaleModalOpen(false);
      // The sale just recorded is stamped with now, so it always falls
      // within today/this week/Total, and within the Monthly/Yearly tabs
      // only when actually parked on the real current month/year — not
      // some other period being paged through.
      const now = new Date();
      const isCurrentMonthView =
        tab === 'month' && monthYear.year === now.getFullYear() && monthYear.month === now.getMonth() + 1;
      const isCurrentYearView = tab === 'year' && yearValue === now.getFullYear();
      if (tab === 'today' || tab === 'week' || tab === 'total' || isCurrentMonthView || isCurrentYearView) {
        setLoading(true);
        const token2 = await getIdToken();
        const refreshed = await fetch(salesUrlFor(tab, monthYear, yearValue), {
          headers: token2 ? { Authorization: `Bearer ${token2}` } : {},
        });
        const refreshedData = await refreshed.json();
        setData(refreshed.ok ? refreshedData : null);
        setLoading(false);
      }
    } catch {
      setSaleError('Failed to add sale.');
    } finally {
      setSaleSaving(false);
    }
  }

  if (!isStaff) {
    return (
      <div className="sales-page">
        <div className="page-mascot">
          <Mascot />
        </div>
        <p className="staff-access-note">Staff access required.</p>
      </div>
    );
  }

  return (
    <div className="sales-page">
      <div className="page-mascot">
        <Mascot />
      </div>
      <h1>Sales</h1>

      <div className="sales-toolbar">
        <div className="sales-tabs">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              className={'sales-tab' + (tab === t.value ? ' sales-tab--active' : '')}
              onClick={() => setTab(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'today' && (
          <button type="button" className="sales-add-btn" onClick={() => setIsSaleModalOpen(true)}>
            + Add Sale
          </button>
        )}
      </div>

      {tab === 'month' && <MonthNav monthYear={monthYear} onShift={shiftMonth} onSelect={setMonthYear} />}
      {tab === 'year' && <YearNav year={yearValue} onShift={shiftYear} onSelect={setYearValue} />}

      {!SUPPORTED_TABS.includes(tab) ? (
        <p className="empty-cart">Coming soon.</p>
      ) : loading ? (
        <p className="empty-cart">Loading...</p>
      ) : !data ? (
        <p className="empty-cart">No sales yet {PERIOD_LABELS[tab]}.</p>
      ) : (tab === 'month' || tab === 'year') && data.totalRevenue === 0 ? (
        <>
          <p className="sales-revenue">N/A</p>
          <p className="sales-revenue-note">No sales data</p>
        </>
      ) : (
        <>
          <SalesBreakdown data={data} />

          {tab === 'week' &&
            data.days?.map((day) => (
              <div key={day.date} className="sales-day-section">
                <h2 className="sales-day-heading">{formatDayLabel(day.date)}</h2>
                {day.date > todayKey() ? (
                  <>
                    <p className="sales-revenue">N/A</p>
                    <p className="sales-revenue-note">No sales data</p>
                  </>
                ) : (
                  <SalesBreakdown data={day} />
                )}
              </div>
            ))}
        </>
      )}

      {isSaleModalOpen && (
        <AddSaleModal
          isSaving={saleSaving}
          error={saleError}
          onSubmit={handleAddSale}
          onClose={() => {
            setIsSaleModalOpen(false);
            setSaleError('');
          }}
        />
      )}
    </div>
  );
}

export default Sales;
