import { useEffect, useState } from 'react';
import IndexScreen from './components/IndexScreen';
import ImportScreen from './components/ImportScreen';
import RecipePage from './components/RecipePage';
import PlanScreen from './components/PlanScreen';
import ShoppingScreen from './components/ShoppingScreen';

type Route =
  | { name: 'index' }
  | { name: 'new' }
  | { name: 'plan' }
  | { name: 'shopping' }
  | { name: 'recipe'; slug: string };

function parseRoute(): Route {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash === '/new') return { name: 'new' };
  if (hash === '/plan') return { name: 'plan' };
  if (hash === '/shopping') return { name: 'shopping' };
  const m = hash.match(/^\/r\/([^/]+)/);
  if (m) return { name: 'recipe', slug: decodeURIComponent(m[1]) };
  return { name: 'index' };
}

function TopBar({ active }: { active: Route['name'] }) {
  return (
    <div className="topbar">
      <div className="topbar-inner">
        <a href="#/" className="brand">
          Recipe<span className="dot">.</span>Spot
        </a>
        <span className="topbar-spacer" />
        <a href="#/" className={'navlink' + (active === 'index' ? ' on' : '')}>
          Recipes
        </a>
        <a href="#/plan" className={'navlink' + (active === 'plan' ? ' on' : '')}>
          This Week
        </a>
        <a href="#/shopping" className={'navlink' + (active === 'shopping' ? ' on' : '')}>
          Shopping
        </a>
        <a href="#/new" className={'navlink' + (active === 'new' ? ' on' : '')}>
          + Add
        </a>
      </div>
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseRoute());

  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <>
      <TopBar active={route.name} />
      {route.name === 'index' && <IndexScreen />}
      {route.name === 'new' && <ImportScreen />}
      {route.name === 'plan' && <PlanScreen />}
      {route.name === 'shopping' && <ShoppingScreen />}
      {route.name === 'recipe' && <RecipePage slug={route.slug} />}
    </>
  );
}
