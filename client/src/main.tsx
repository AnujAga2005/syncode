import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  // <React.StrictMode> // strict mode removed to prevent double-firing effects in dev
    <App />
  // </React.StrictMode>,
)