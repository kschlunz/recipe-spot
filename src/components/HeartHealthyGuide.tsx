import HeartHealthyIcon from './HeartHealthyIcon';

// A plain-language reference for the heart-healthy guidelines Recipe Spot uses
// to label recipes: the Mediterranean diet (Mayo Clinic) and the American Heart
// Association diet & lifestyle recommendations. Static content — no backend.

function Card({ title, children, tone }: { title: string; children: React.ReactNode; tone: 'good' | 'limit' }) {
  return (
    <section className={'hhg-card ' + tone}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export default function HeartHealthyGuide() {
  return (
    <div className="wrap hhg">
      <a className="backlink" href="#/">
        ← All recipes
      </a>

      <div className="hhg-head">
        <div className="hhg-badge">
          <HeartHealthyIcon size={26} />
        </div>
        <div>
          <h1>Heart-Healthy Eating</h1>
          <p className="hhg-lede">
            A quick, plain-language guide to eating for a healthier heart and lower cholesterol — the
            approach Recipe Spot uses to label recipes. Built from the Mediterranean diet and the American
            Heart Association’s recommendations.
          </p>
        </div>
      </div>

      <div className="hhg-note">
        <b>How Recipe Spot uses this:</b> each recipe is checked against these guidelines and, if it fits,
        gets a green <span className="hhg-inline-badge"><HeartHealthyIcon size={13} /> Heart-healthy</span>{' '}
        label. Use the <b>Heart-healthy</b> filter on the Recipes page, or turn on{' '}
        <b>Heart-healthy only</b> when you tap <b>Fill my week</b>.
      </div>

      <div className="hhg-grid">
        <Card title="Build meals around these" tone="good">
          <ul>
            <li>
              <b>Vegetables & fruit</b> — the base of most meals. Aim for lots, and a range of colors.
            </li>
            <li>
              <b>Whole grains</b> — oats, brown rice, whole-wheat bread & pasta, quinoa, barley (over white/refined).
            </li>
            <li>
              <b>Beans & legumes</b> — chickpeas, lentils, black beans; great meatless protein and soluble fiber.
            </li>
            <li>
              <b>Fish & seafood</b> — especially oily fish (salmon, sardines, tuna) for omega-3s, a couple times a week.
            </li>
            <li>
              <b>Nuts, seeds & olive oil</b> — the main added fats. Olive oil in place of butter.
            </li>
            <li>
              <b>Poultry & low-fat dairy</b> — in moderation; leaner choices over fatty cuts.
            </li>
            <li>
              <b>Herbs & spices</b> — flavor food with these instead of salt.
            </li>
          </ul>
        </Card>

        <Card title="Cut back on these" tone="limit">
          <ul>
            <li>
              <b>Red & processed meat</b> — beef, pork, bacon, sausage, deli meats. Small amounts, infrequently.
            </li>
            <li>
              <b>Saturated fat</b> — butter, lard, cream, fatty meats, full-fat cheese; and tropical oils (coconut, palm).
            </li>
            <li>
              <b>Trans fat</b> — avoid entirely: anything with “partially hydrogenated oil,” many fried & packaged foods.
            </li>
            <li>
              <b>Salt / sodium</b> — a top driver of blood pressure; watch canned, packaged, and restaurant food.
            </li>
            <li>
              <b>Added sugar</b> — sweets, desserts, and especially sugary drinks.
            </li>
            <li>
              <b>Refined carbs</b> — white bread, white rice, pastries, most snack foods.
            </li>
            <li>
              <b>Ultra-processed & fried foods</b> — the more a food is processed, the less often.
            </li>
          </ul>
        </Card>
      </div>

      <section className="hhg-section">
        <h2>The AHA’s core recommendations</h2>
        <ul className="hhg-checklist">
          <li>Balance calories with activity to reach and keep a healthy weight.</li>
          <li>Eat plenty and a variety of fruits and vegetables.</li>
          <li>Choose whole grains over refined ones.</li>
          <li>Pick healthy protein — mostly plants, fish/seafood, low-fat dairy, and lean poultry.</li>
          <li>Use liquid non-tropical plant oils (like olive or canola) instead of butter or coconut oil.</li>
          <li>Choose minimally processed foods over ultra-processed ones.</li>
          <li>Cut back on drinks and foods with added sugars.</li>
          <li>Prepare food with little or no salt.</li>
          <li>If you don’t drink alcohol, don’t start; if you do, keep it limited.</li>
          <li>Follow this guidance wherever you eat — home or out.</li>
        </ul>
      </section>

      <section className="hhg-section hhg-chol">
        <h2>Especially for lowering cholesterol</h2>
        <ul>
          <li>
            <b>Less saturated fat</b> is the biggest lever for LDL (“bad”) cholesterol — swap butter/fatty
            meat for olive oil, fish, beans, and poultry.
          </li>
          <li>
            <b>Zero trans fat.</b>
          </li>
          <li>
            <b>More soluble fiber</b> — oats, beans, lentils, apples, barley — helps lower cholesterol.
          </li>
          <li>
            <b>Omega-3s</b> from oily fish support heart health.
          </li>
        </ul>
      </section>

      <div className="hhg-disclaimer">
        This is general educational guidance, not medical advice. For your cholesterol specifically, follow
        your doctor’s or a registered dietitian’s recommendations.
      </div>

      <div className="hhg-sources">
        <span>Sources:</span>
        <a
          href="https://www.mayoclinic.org/healthy-lifestyle/nutrition-and-healthy-eating/in-depth/mediterranean-diet/art-20047801"
          target="_blank"
          rel="noopener noreferrer"
        >
          Mayo Clinic — Mediterranean diet
        </a>
        <a
          href="https://www.heart.org/en/healthy-living/healthy-eating/eat-smart/nutrition-basics/aha-diet-and-lifestyle-recommendations"
          target="_blank"
          rel="noopener noreferrer"
        >
          American Heart Association — Diet & Lifestyle Recommendations
        </a>
      </div>
    </div>
  );
}
