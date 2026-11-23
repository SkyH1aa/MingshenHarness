import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CompanionApp } from "./CompanionApp";
import "./companion.css";

const root = document.getElementById("companion-root");
if (!root) throw new Error("Missing companion renderer root");

createRoot(root).render(
  <StrictMode>
    <CompanionApp />
  </StrictMode>,
);
