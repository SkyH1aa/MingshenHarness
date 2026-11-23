import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StartupApp } from "./StartupApp";
import "./startup.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing startup renderer root");

createRoot(root).render(
  <StrictMode>
    <StartupApp />
  </StrictMode>,
);
