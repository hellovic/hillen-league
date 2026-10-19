import React from "react";
import { createRoot } from "react-dom/client";

/* Stylesheet order mirrors the exported site: base.css (structural layer shared
 * with the original dashboard) first, then design.css ("Courtside Orange"). */
import "./styles/base.css";
import "./styles/design.css";
/* Platform-specific corrections layered on top of the design system. */
import "./styles/desktop-fix.css";

import App from "./App.jsx";
import { initAnalytics } from "./analytics.js";

initAnalytics();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
