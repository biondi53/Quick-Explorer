import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

import { LanguageProvider } from "./i18n/LanguageProvider";

// 1. GLOBAL DRAG & DROP UNBLOCKER (Mandatory for Windows/WebView2 OLE)
window.addEventListener('dragover', (e) => {
  e.preventDefault();
}, false);

window.addEventListener('drop', (e) => {
  e.preventDefault();
}, false);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </React.StrictMode>,
);
