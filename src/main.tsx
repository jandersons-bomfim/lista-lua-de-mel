import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import Public from './pages/Public';

const Admin = lazy(() => import('./pages/Admin'));
// GitHub Pages não tem rotas no servidor: o painel fica em  <site>/#/admin
const isAdmin = window.location.hash.startsWith('#/admin');
window.addEventListener('hashchange', () => window.location.reload());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdmin ? (
      <Suspense fallback={<p className="center-note">Carregando…</p>}>
        <Admin />
      </Suspense>
    ) : (
      <Public />
    )}
  </StrictMode>,
);
