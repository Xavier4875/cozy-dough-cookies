import { useAuth } from '../context/useAuth.js';
import Mascot from '../components/Mascot.jsx';
import OrderHistoryList from '../components/OrderHistoryList.jsx';
import { useCart } from '../context/useCart.js';
import './OrderHistory.css';

function OrderHistory() {
  const { isAuthenticated } = useAuth();
  const { orderHistory, orderHistoryLoading } = useCart();

  if (!isAuthenticated) {
    return (
      <div className="order-history-page">
        <div className="page-mascot">
          <Mascot />
        </div>
        <p className="order-history-signin-note">Sign in to see your order history.</p>
      </div>
    );
  }

  return (
    <div className="order-history-page">
      <div className="page-mascot">
        <Mascot />
      </div>
      <h1>My Orders</h1>
      <OrderHistoryList orders={orderHistory} loading={orderHistoryLoading} />
    </div>
  );
}

export default OrderHistory;
