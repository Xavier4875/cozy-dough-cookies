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
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isSaleModalOpen, setIsSaleModalOpen] = useState(false);
  const [saleSaving, setSaleSaving] = useState(false);
  const [saleError, setSaleError] = useState('');

  const isStaff = isAuthenticated && user.role === 'staff';

  // Only "Today" is wired up for now — the other four tabs are real,
  // clickable, and correctly labeled, but show a placeholder until their
  // data gets built out. Expanding later is just fetching the same
  // endpoint with a different period, not new design work.
  useEffect(() => {
    if (!isStaff || tab !== 'today') return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getIdToken();
        const res = await fetch(`/api/sales?period=${tab}`, {
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
  }, [isStaff, tab]);

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
      // Only Today is ever fetched today — re-run the same effect logic by
      // bumping loading state via a direct refetch, since the sale just
      // recorded always falls within "today" (it's stamped with now).
      if (tab === 'today') {
        setLoading(true);
        const token2 = await getIdToken();
        const refreshed = await fetch('/api/sales?period=today', {
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
        <button type="button" className="sales-add-btn" onClick={() => setIsSaleModalOpen(true)}>
          + Add Sale
        </button>
      </div>

      {tab !== 'today' ? (
        <p className="empty-cart">Coming soon.</p>
      ) : loading ? (
        <p className="empty-cart">Loading...</p>
      ) : !data ? (
        <p className="empty-cart">No sales yet today.</p>
      ) : (
        <>
          <p className="sales-revenue">${data.totalRevenue.toFixed(2)}</p>
          {data.externalRevenue > 0 && (
            <p className="sales-revenue-note">*${data.externalRevenue.toFixed(2)} from external sales</p>
          )}

          <details className="sales-dropdown">
            <summary className="sales-section-title">Items Sold</summary>
            {data.itemsSold.length === 0 ? (
              <p className="empty-cart">No items sold yet today.</p>
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
              <p className="empty-cart">No items sold yet today.</p>
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
