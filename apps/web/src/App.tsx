import React from "react";
import { Link, Route, Routes } from "react-router-dom";
import RunsPage from "./pages/RunsPage";
import RunDetailPage from "./pages/RunDetailPage";

const shellStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, sans-serif",
  maxWidth: 1200,
  margin: "0 auto",
  padding: 16
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 16,
  borderBottom: "1px solid #e5e5e5",
  paddingBottom: 12,
  marginBottom: 16
};

export default function App() {
  return (
    <div style={shellStyle}>
      <header style={headerStyle}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>M365 Discovery Portal</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Read-only UI for runs and findings</div>
        </div>
        <nav style={{ display: "flex", gap: 12 }}>
          <Link to="/" style={{ textDecoration: "none" }}>Runs</Link>
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<RunsPage />} />
        <Route path="/runs/:runId" element={<RunDetailPage />} />
      </Routes>
    </div>
  );
}
