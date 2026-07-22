import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initSync } from './sync';
import { useUI } from './ui';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

initSync();

// E2E 测试专用：暴露 store 到 window
(window as any).__dietDebug = { useUI };
