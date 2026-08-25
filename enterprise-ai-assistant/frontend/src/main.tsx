import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { Toaster } from "./components/ui/toast";
import { useAuth } from "./store/auth";

// Self-hosted fonts (bundled — no CDN).
import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/500.css";
import "@fontsource/vazirmatn/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";

import "./globals.css";

function Root() {
  const initialize = useAuth((s) => s.initialize);
  const initialized = useAuth((s) => s.initialized);
  React.useEffect(() => {
    initialize();
  }, [initialize]);

  React.useEffect(() => {
    const onUnauthorized = () => {
      window.location.href = "/login";
    };
    window.addEventListener("eai:unauthorized", onUnauthorized);
    return () => window.removeEventListener("eai:unauthorized", onUnauthorized);
  }, []);

  if (!initialized) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }
  return (
    <BrowserRouter>
      <App />
      <Toaster />
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
