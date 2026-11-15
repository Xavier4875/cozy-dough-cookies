import Mascot from '../components/Mascot.jsx';
import './Nutrition.css';

// [product, what it contains] — shown in this order in the allergen table.
const COOKIE_ALLERGENS = [
  ['Chocolate Chip Cookies', 'Wheat, milk, eggs, soy'],
  ['M&M Cookies', 'Wheat, milk, eggs, soy'],
  ['Monster Cookies', 'Wheat, milk, eggs, soy'],
  ['Butter Cookies', 'Wheat, milk, eggs'],
  ['Snickerdoodle Cookies', 'Wheat, milk, eggs'],
  ['Oatmeal Cookies', 'Wheat, milk, eggs'],
  ['Oatmeal Raisin Cookies', 'Wheat, milk, eggs'],
  ['Oatmeal Scotchies', 'Wheat, milk, eggs, soy'],
  ['Butterscotch Cookies', 'Wheat, milk, eggs, soy'],
  ['Peanut Butter Cookies', 'Wheat, milk, eggs, peanuts'],
  ['Brownie Cookies', 'Wheat, milk, eggs, soy'],
  ['Strawberry Cheesecake Cookies', 'Wheat, milk, eggs'],
  ['Thanksgiving Apple Pie Cookies', 'Wheat, milk, eggs'],
  ['Signature Sugar Cookies', 'Wheat, milk, eggs'],
  ['Oatmeal Cream Pies', 'Wheat, milk, eggs'],
  ['Cozy Rolls', 'Wheat, milk'],
  ['Cozy Maple Sugar Cookie Dippers', 'Wheat, milk, eggs'],
  ['Thanksgiving Gobble Buckets', 'Allergens vary depending on selected flavors'],
];

function Nutrition() {
  return (
    <div className="nutrition-page">
      <div className="page-mascot">
        <Mascot />
      </div>

      <header className="nutrition-header">
        <p className="nutrition-kicker">Cozy Dough Cookies</p>
        <h1>Website Food &amp; Allergen Information</h1>
      </header>

      <section className="nutrition-section">
        <h2>About Our Cookies</h2>
        <p>
          At Cozy Dough Cookies, our treats are homemade in small batches using thoughtfully
          selected ingredients. We offer classic cookies, specialty cookies, cookie sandwiches,
          cinnamon rolls, and seasonal treats.
        </p>
      </section>

      <section className="nutrition-notice">
        <h2>Food Safety Notice</h2>
        <p>
          This food was prepared in a kitchen that is not subject to regulation and inspection by a
          regulatory authority and may contain allergens.
        </p>
      </section>

      <section className="nutrition-section">
        <h2>Allergen Information</h2>
        <p>
          Our products are made in a home kitchen where wheat, milk, eggs, soy, peanuts, and tree
          nuts may be present.
        </p>
        <p>
          Please review the allergen information for each product before ordering. If you have a
          food allergy, contact us before purchasing.
        </p>
      </section>

      <section className="nutrition-section">
        <h2>Cookie Allergen Information</h2>
        <table className="allergen-table">
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Contains</th>
            </tr>
          </thead>
          <tbody>
            {COOKIE_ALLERGENS.map(([product, contains]) => (
              <tr key={product}>
                <th scope="row">{product}</th>
                <td>{contains}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="nutrition-notice nutrition-notice--important">
        <h2>Important Allergy Notice</h2>
        <p>
          We cannot guarantee that any product is free from cross-contact with allergens.
          Customers with severe food allergies should contact us before placing an order.
        </p>
      </section>
    </div>
  );
}

export default Nutrition;
