import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "react-error-boundary";
import "./index.css";
import App from "./App.tsx";
import { RootErrorFallback } from "./ui/index.ts";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary FallbackComponent={RootErrorFallback}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
