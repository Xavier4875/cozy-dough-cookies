import Mascot from '../components/Mascot.jsx';
import './Policy.css';

function Policy() {
  return (
    <div className="policy-page">
      <div className="policy-contact">
        <p className="policy-contact-heading">Questions? Reach out</p>
        <p className="policy-contact-line">
          Facebook (preferred):{' '}
          <a href="https://facebook.com/cozydoughcookies" target="_blank" rel="noreferrer">
            @cozydoughcookies
          </a>
        </p>
        <p className="policy-contact-line">
          Email: <a href="mailto:amberryounger@gmail.com">amberryounger@gmail.com</a>
        </p>
      </div>

      <div className="page-mascot">
        <Mascot />
      </div>

      <h1>Policies</h1>

      <section className="policy-section">
        <h2>Ordering &amp; Payment</h2>
        <ul>
          <li>Each order must total at least $9 before shipping.</li>
          <li>
            On this website, we accept card, Apple Pay, and Google Pay through Stripe only &mdash;
            no cash, PayPal, Venmo, or Zelle.
          </li>
          <li>
            At in-person events and our home cookie stand, we also accept cash, Venmo, Zelle, and
            PayPal.
          </li>
          <li>
            <strong>Guest checkout:</strong> no account needed, but you&apos;ll need to verify your
            email with a one-time code before you can pay. Guest orders don&apos;t earn reward
            points, and order status is tracked by email only &mdash; there&apos;s no in-app order
            history.
          </li>
          <li>
            <strong>Registered account:</strong> sign in once and skip the email verification step
            on every order. You&apos;ll earn 1 reward point per $1 spent, and every order is saved
            to your My Orders page.
          </li>
        </ul>
      </section>

      <section className="policy-section">
        <h2>Pickup</h2>
        <ul>
          <li>Pickup hours are 10:00am&ndash;7:00pm.</li>
          <li>Pickup times can be scheduled up to 3 months in advance.</li>
          <li>Gluten-free and sugar-free orders need at least 48 hours&apos; notice to bake.</li>
          <li>
            Gluten-free and sugar-free cookies are sold by the full batch only (24 cookies, or 19
            for Brownie) &mdash; we can&apos;t split a batch or sell them individually.
          </li>
          <li>Ice cream sandwiches and other temperature-controlled items are pickup only &mdash; they can&apos;t be shipped.</li>
          <li>Your pickup address is included in your order confirmation email.</li>
          <li>
            You have 24 hours after your confirmed pickup time to pick up your order. If we
            don&apos;t hear from you within that window, your order is forfeited and may be given
            away &mdash; no refund or replacement will be given.
          </li>
          <li>
            If an issue comes up with your confirmed pickup time, contact us before the 24-hour
            window expires.
          </li>
        </ul>
      </section>

      <section className="policy-section">
        <h2>Shipping</h2>
        <ul>
          <li>We ship via USPS to all 50 states, D.C., and U.S. territories.</li>
          <li>Flat shipping fee: $24 for orders up to 36 cookies, $30 for larger orders.</li>
          <li>Temperature-controlled items can&apos;t be shipped &mdash; pickup only.</li>
        </ul>
      </section>

      <section className="policy-section">
        <h2>Order Changes &amp; Cancellations</h2>
        <ul>
          <li>Orders can&apos;t be changed or canceled directly in the app once placed.</li>
          <li>
            Message us on Facebook or email as soon as possible &mdash; we&apos;ll do our best to
            accommodate changes or cancellations before your order is prepared.
          </li>
        </ul>
      </section>
    </div>
  );
}

export default Policy;
