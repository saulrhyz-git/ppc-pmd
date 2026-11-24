import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { PORTAL_PATH } from "@pmd/shared";
import "../index.css";
import "./portal.css";
import PortalApp from "./PortalApp.tsx";

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: (n, e) => n < 1 && (e as { status?: number }).status !== 401 && (e as { status?: number }).status !== 404 } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter basename={PORTAL_PATH}>
        <PortalApp />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
