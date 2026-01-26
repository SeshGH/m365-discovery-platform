// apps/portal/src/app/layout.tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "M365 Discovery Portal",
  description: "Portal for viewing runs, artefacts, observed checks, and reports"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, Segoe UI, Roboto, Arial, sans-serif", margin: 0 }}>
        <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
          <header style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>M365 Discovery Portal</h1>
            <span style={{ opacity: 0.7, fontSize: 12 }}>prototype (contract-consumer)</span>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
