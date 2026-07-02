import { Routes, Route } from 'react-router-dom';
import NavBar from './components/NavBar.jsx';
import CartDrawer from './components/CartDrawer.jsx';
import Home from './pages/Home.jsx';
import Menu from './pages/Menu.jsx';
import Policy from './pages/Policy.jsx';
import Nutrition from './pages/Nutrition.jsx';
import './App.css';

function App() {
  return (
    <div className="app">
      <NavBar />
      <main className="page-container">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/menu" element={<Menu />} />
          <Route path="/policy" element={<Policy />} />
          <Route path="/nutrition" element={<Nutrition />} />
        </Routes>
      </main>
      <CartDrawer />
    </div>
  );
}

export default App;
