import React from "react";
import { createRoot } from "react-dom/client";

/* Stylesheet order mirrors the exported site: base.css (structural layer shared
 * with the original dashboard) first, then design.css ("Courtside Orange"). */
import "./styles/base.css";
import "./styles/design.css";
/* Platform-specific corrections layered on top of the design system. */
import "./styles/desktop-fix.css";
/* Small product tweaks on top of the design (e.g. the box-score caption sizes). */
import "./styles/tweaks.css";

import App from "./App.jsx";
import { initAnalytics } from "./analytics.js";

initAnalytics();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
