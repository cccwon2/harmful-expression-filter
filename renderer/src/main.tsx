import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { OverlayApp } from './overlay/OverlayApp';

// 라우팅: location.pathname === '/overlay'면 OverlayApp 렌더
const root = ReactDOM.createRoot(document.getElementById('root')!);

if (window.location.pathname === '/overlay' || window.location.pathname === '/overlay.html') {
  root.render(
    <React.StrictMode>
      <OverlayApp />
    </React.StrictMode>
  );
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

