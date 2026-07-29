import { useEffect, useState } from 'react';
import IndexScreen from './components/IndexScreen';
import ImportScreen from './components/ImportScreen';
import RecipePage from './components/RecipePage';

type Route =
  | { name: 'index' }
  | { name: 'new' }
  | { name: 'recipe'; slug: string };

function parseRoute(): Route {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash === '/new') return { name: 'new' };
  const m = hash.match(/^\/r\/([^/]+)/);
  if (m) return { name: 'recipe', slug: decodeURIComponent(m[1]) };
  return { name: 'index' };
}

function TopBar() {
  return (
    <div className="topbar">
      <div className="topbar-inner">
        <a href="#/" className="brand">
          Recipe<span className="dot">.</span>Spot
        </a>
        <span className="topbar-spacer" />
        <a href="#/new" className="navlink">
          + Import
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
      <TopBar />
      {route.name === 'index' && <IndexScreen />}
      {route.name === 'new' && <ImportScreen />}
      {route.name === 'recipe' && <RecipePage slug={route.slug} />}
    </>
  );
}
