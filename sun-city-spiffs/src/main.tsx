import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ToastProvider } from "./components/ui";
import { DirectoryProvider } from "./directory";
import { RouterProvider } from "./router";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider>
      <ToastProvider>
        <DirectoryProvider>
          <App />
        </DirectoryProvider>
      </ToastProvider>
    </RouterProvider>
  </StrictMode>,
);
