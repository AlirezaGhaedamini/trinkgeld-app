import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';

import '@/styles/fonts.css';
import '@/styles/phosphor.css';
import '@/styles/tokens.css';
import '@/styles/base.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
