import ImagePlaceholder from '../components/ImagePlaceholder.jsx';
import Mascot from '../components/Mascot.jsx';
import './Policy.css';

function Policy() {
  return (
    <div className="policy-page">
      <div className="page-mascot">
        <Mascot />
      </div>
      <h1>Pickup/Shipping Policy</h1>
      <p>
        Placeholder text — describe your pickup hours/location and shipping
        area, minimums, fees, and lead times here.
      </p>
      <ImagePlaceholder label="Map / hours graphic" aspectRatio="16 / 9" />
      <h2>Pickup</h2>
      <p>Placeholder pickup details go here.</p>
      <h2>Shipping</h2>
      <p>Placeholder shipping details go here.</p>
    </div>
  );
}

export default Policy;
