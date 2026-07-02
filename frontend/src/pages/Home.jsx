import ImagePlaceholder from '../components/ImagePlaceholder.jsx';
import './Home.css';

function Home() {
  return (
    <div className="home-page">
      <ImagePlaceholder
        label="Hero image"
        className="home-hero"
        aspectRatio="16 / 6"
      />
      <h1>Cozy Dough Cookies</h1>
      <h2>About Us</h2>
      <p>
        Placeholder copy — this is where your bakery's story goes. How did Cozy
        Dough Cookies get started? What makes your cookies special? What do you
        want customers to know before they order? Replace this paragraph with
        your own words whenever you're ready.
      </p>
      <ImagePlaceholder
        label="Bakery / team photo"
        className="home-secondary"
        aspectRatio="16 / 9"
      />
      <p>
        More placeholder copy — ingredients, baking process, values, whatever
        fits. Swap this section out along with the images above.
      </p>
    </div>
  );
}

export default Home;
