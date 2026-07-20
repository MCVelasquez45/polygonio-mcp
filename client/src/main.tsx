import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { assertApiRuntimeConfig } from './api/http';

declare const __APP_VERSION__: string;
(window as Window & { __APP_VERSION__?: string }).__APP_VERSION__ = __APP_VERSION__;

assertApiRuntimeConfig();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
