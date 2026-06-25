// src/main.jsx
// Gate 2 — Phase 5A: Render real App component.
//
// Phase 5B additions (not yet present):
//   - SharedBinder routing (?share= token detection)
//   - ErrorBoundary wrapper
//   - auth/session detection
//
// Do not add those here until Phase 5B is reviewed and approved.

import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/index.css';
import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
);

