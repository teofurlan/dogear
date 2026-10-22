import React from 'react';
import {createRoot} from 'react-dom/client';
import {Auth0Provider} from '@auth0/auth0-react';
import App from './App.jsx';
import {authConfig} from './config.js';
import './styles.css';

const root = createRoot(document.getElementById('root'));
try {
  const configuration = authConfig(import.meta.env, window.location.origin);
  root.render(<Auth0Provider {...configuration} onRedirectCallback={() => {
    // The SDK consumes and verifies code/state first. Never follow an arbitrary returnTo.
    window.history.replaceState({}, document.title, '/');
  }}><App /></Auth0Provider>);
} catch {
  root.render(<main className="setup-message"><h1>Connect Dogear to Auth0</h1><p>Copy web/.env.example to web/.env.local and set the public Auth0 identifiers. Restart the web server afterward.</p><p>No client secret belongs in the browser.</p></main>);
}
