import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function Scaffold() {
  return (
    <main>
      <h1>Jellyfin Subtitle Manager</h1>
      <p>Production scaffold ready.</p>
    </main>
  );
}

const root = document.querySelector("#root");

if (!(root instanceof HTMLElement)) {
  throw new Error("Missing application root");
}

createRoot(root).render(
  <StrictMode>
    <Scaffold />
  </StrictMode>,
);
