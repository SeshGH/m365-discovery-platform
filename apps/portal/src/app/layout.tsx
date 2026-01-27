// apps/portal/src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "M365 Discovery Portal",
  description: "Portal for viewing runs, artefacts, observed checks, and reports"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="container">
          <header className="header">
            <div className="brand">
              <h1>M365 Discovery Portal</h1>
              <span>prototype (contract-consumer)</span>
            </div>
            <div className="actions">
              <a className="link" href="/tenants">Tenants</a>
            </div>
          </header>

          <div className="page">{children}</div>
        </div>
      </body>
    </html>
  );
}
