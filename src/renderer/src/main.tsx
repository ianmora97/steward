import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/motion.css';
import './components/ui.css';
import './styles.css';
import './git.css';
import './shell.css';
import { App } from './App';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('root element is missing from index.html');
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
