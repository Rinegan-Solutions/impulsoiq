import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

// The MSW mock layer and its fixtures were removed: every screen now reads the
// real API through src/api/client.ts. To run locally, point VITE_API_URL at a
// deployed stage (the dev one) and sign in with a real Cognito user --
// requests are tenant-scoped by the token's custom:tenant_id claim, so there
// is no way to render meaningful data without one.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
