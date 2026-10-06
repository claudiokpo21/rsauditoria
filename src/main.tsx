import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource-variable/geist/index.css';
import '@fontsource/geist-mono/latin-500.css';
import '@fontsource/geist-mono/latin-600.css';
import './index.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
