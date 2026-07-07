import { Routes, Route } from 'react-router-dom';
import NavBar from './components/NavBar.jsx';
import MobileNavBar from './components/MobileNavBar.jsx';
import CartDrawer from './components/CartDrawer.jsx';
import MobileCartDrawer from './components/MobileCartDrawer.jsx';
import Home from './pages/Home.jsx';
import Menu from './pages/Menu.jsx';
import MobileMenu from './pages/MobileMenu.jsx';
import Policy from './pages/Policy.jsx';
import Nutrition from './pages/Nutrition.jsx';
import { useIsMobile } from './hooks/useIsMobile.js';
import './App.css';

function App() {
  const isMobile = useIsMobile();

  return (
    <div className="app">
      {isMobile ? <MobileNavBar /> : <NavBar />}
      <main className={'page-container' + (isMobile ? ' page-container--mobile' : '')}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/menu" element={isMobile ? <MobileMenu /> : <Menu />} />
          <Route path="/policy" element={<Policy />} />
          <Route path="/nutrition" element={<Nutrition />} />
        </Routes>
      </main>
      {isMobile ? <MobileCartDrawer /> : <CartDrawer />}
    </div>
  );
}

export default App;
