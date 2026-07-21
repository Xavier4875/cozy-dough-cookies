import { Routes, Route } from 'react-router-dom';
import NavBar from './components/NavBar.jsx';
import MobileNavBar from './components/MobileNavBar.jsx';
import CartDrawer from './components/CartDrawer.jsx';
import MobileCartDrawer from './components/MobileCartDrawer.jsx';
import AccountDrawer from './components/AccountDrawer.jsx';
import MobileAccountDrawer from './components/MobileAccountDrawer.jsx';
import DeleteAccountModal from './components/DeleteAccountModal.jsx';
import Home from './pages/Home.jsx';
import Menu from './pages/Menu.jsx';
import MobileMenu from './pages/MobileMenu.jsx';
import Policy from './pages/Policy.jsx';
import Nutrition from './pages/Nutrition.jsx';
import Rewards from './pages/Rewards.jsx';
import OrderHistory from './pages/OrderHistory.jsx';
import SignIn from './pages/SignIn.jsx';
import SignUp from './pages/SignUp.jsx';
import { useIsMobile } from './hooks/useIsMobile.js';
import './App.css';

function App() {
  const isMobile = useIsMobile();

  return (
    <div className="app">
      {isMobile ? <MobileNavBar /> : <NavBar />}
      <main className="page-container">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/menu" element={isMobile ? <MobileMenu /> : <Menu />} />
          <Route path="/policy" element={<Policy />} />
          <Route path="/nutrition" element={<Nutrition />} />
          <Route path="/rewards" element={<Rewards />} />
          <Route path="/order-history" element={<OrderHistory />} />
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/sign-up" element={<SignUp />} />
        </Routes>
      </main>
      {isMobile ? <MobileCartDrawer /> : <CartDrawer />}
      {isMobile ? <MobileAccountDrawer /> : <AccountDrawer />}
      <DeleteAccountModal />
    </div>
  );
}

export default App;
