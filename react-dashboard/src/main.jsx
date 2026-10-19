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
/* UX workstreams from the 2026-10-19 mobile-first brief; each file is owned by one
 * workstream so the imports stay stable while they are edited in parallel. */
import "./styles/ux-header.css";
import "./styles/ux-tables.css";
import "./styles/ux-scope.css";
import "./styles/ux-guide.css";
import "./styles/ux-compare.css";
import "./styles/ux-nav.css";
import "./styles/ux-search.css";
import "./styles/ux-standings.css";

import App from "./App.jsx";
import { initAnalytics } from "./analytics.js";

initAnalytics();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
