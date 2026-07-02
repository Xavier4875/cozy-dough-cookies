import ImagePlaceholder from '../components/ImagePlaceholder.jsx';
import './Nutrition.css';

function Nutrition() {
  return (
    <div className="nutrition-page">
      <h1>Nutrition</h1>
      <p>
        Placeholder text — general allergen and nutrition information goes
        here (e.g. common allergens, ingredient sourcing notes, calorie
        ranges).
      </p>
      <ImagePlaceholder label="Nutrition facts image" aspectRatio="4 / 3" />
    </div>
  );
}

export default Nutrition;
