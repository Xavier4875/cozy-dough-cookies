import { useMascot } from '../hooks/useMascot.js';
import './Mascot.css';

function Mascot({ className = '' }) {
  const src = useMascot();
  return <img src={src} alt="" className={`mascot-img ${className}`.trim()} />;
}

export default Mascot;
