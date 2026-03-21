"use client";
// apps/portal/src/app/tenants/_components/OnboardTenantModal.tsx

import { useCallback, useEffect, useRef, useState } from "react";

// Any GUID variant: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (not restricted to v4)
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type TestState = "idle" | "testing" | "connected" | "error" | "timeout";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called after a successful connection test — parent should refresh the tenant list. */
  onComplete: () => void;
};

export function OnboardTenantModal({ open, onClose, onComplete }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 fields
  const [tenantGuid, setTenantGuid] = useState("");
  const [primaryDomain, setPrimaryDomain] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [step1Error, setStep1Error] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Tenant ID returned after successful POST /api/tenants in step 1
  const [newTenantId, setNewTenantId] = useState<string | null>(null);

  // Step 3 connection-test state
  const [testState, setTestState] = useState<TestState>("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Reset all state whenever the modal is opened ──
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setTenantGuid("");
    setPrimaryDomain("");
    setDisplayName("");
    setStep1Error(null);
    setCreating(false);
    setNewTenantId(null);
    setTestState("idle");
    setTestError(null);
    if (pollRef.current) clearInterval(pollRef.current);
  }, [open]);

  // ── Cleanup poll on unmount ──
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── Connection test (used on entry to step 3 and on retry) ──
  const startTest = useCallback(() => {
    if (!newTenantId) return;
    if (pollRef.current) clearInterval(pollRef.current);

    setTestState("testing");
    setTestError(null);

    // Enqueue auth-test job; ignore immediate fetch errors — polling detects outcome.
    void fetch(`/api/tenants/${newTenantId}/auth/test`, { method: "POST" }).catch(() => {});

    let polls = 0;
    const MAX_POLLS = 30; // ~60 s

    pollRef.current = setInterval(async () => {
      polls++;
      if (polls > MAX_POLLS) {
        clearInterval(pollRef.current!);
        setTestState("timeout");
        return;
      }
      try {
        const res = await fetch(`/api/tenants/${newTenantId}/auth`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          auth?: { status?: string; lastError?: string | null } | null;
        };
        const status = data?.auth?.status;
        if (status === "connected") {
          clearInterval(pollRef.current!);
          setTestState("connected");
        } else if (status === "error") {
          clearInterval(pollRef.current!);
          setTestError(data?.auth?.lastError ?? "Connection test failed.");
          setTestState("error");
        }
      } catch {
        // Transient fetch error — keep polling
      }
    }, 2000);
  }, [newTenantId]);

  // ── Auto-start test when entering step 3 ──
  useEffect(() => {
    if (step === 3 && newTenantId && testState === "idle") {
      startTest();
    }
  }, [step, newTenantId, testState, startTest]);

  // ── Step 1: create tenant record ──
  async function handleStep1Next() {
    setStep1Error(null);

    if (!GUID_RE.test(tenantGuid.trim())) {
      setStep1Error(
        "Tenant GUID must be in the format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx."
      );
      return;
    }
    if (!primaryDomain.trim()) {
      setStep1Error("Primary domain is required.");
      return;
    }

    // Tenant was already created (operator navigated back from step 2) — just advance.
    if (newTenantId) {
      setStep(2);
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/tenants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantGuid: tenantGuid.trim(),
          primaryDomain: primaryDomain.trim(),
          ...(displayName.trim() ? { displayName: displayName.trim() } : {})
        })
      });

      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
      };

      if (res.status === 409) {
        setStep1Error(
          "A tenant with this GUID is already registered in your organisation."
        );
        return;
      }
      if (!res.ok) {
        setStep1Error(data?.error ?? "Failed to create tenant record. Please try again.");
        return;
      }
      if (!data?.id) {
        setStep1Error("Unexpected response from server.");
        return;
      }

      setNewTenantId(data.id);
      setStep(2);
    } catch {
      setStep1Error("Network error. Please check your connection and try again.");
    } finally {
      setCreating(false);
    }
  }

  if (!open) return null;

  const clientId = process.env.NEXT_PUBLIC_GRAPH_CLIENT_ID ?? "";
  const consentUrl = clientId
    ? `https://login.microsoftonline.com/${tenantGuid.trim()}/adminconsent?client_id=${clientId}`
    : null;

  const tenantLabel = primaryDomain.trim() || tenantGuid.trim();

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
          zIndex: 100
        }}
      />

      {/* Modal card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Onboard tenant"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "#fff",
          borderRadius: 12,
          padding: 32,
          width: 500,
          maxWidth: "92vw",
          maxHeight: "90vh",
          overflowY: "auto",
          zIndex: 101,
          boxShadow: "0 8px 40px rgba(0,0,0,0.18)"
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 20
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Onboard tenant</h2>
            <p style={{ margin: "4px 0 0", fontSize: 12, opacity: 0.5 }}>Step {step} of 3</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 18,
              opacity: 0.45,
              padding: "0 4px",
              lineHeight: 1
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Step 1: Tenant details ── */}
        {step === 1 && (
          <div>
            <p style={{ marginTop: 0, marginBottom: 20, fontSize: 14, opacity: 0.65 }}>
              Enter the customer tenant details. These can be found in{" "}
              <strong>Microsoft Entra ID → Overview</strong>.
            </p>

            <label style={{ display: "block", marginBottom: 14 }}>
              <span
                style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 4 }}
              >
                Tenant GUID <span style={{ color: "#c00", fontWeight: 400 }}>*</span>
              </span>
              <input
                type="text"
                value={tenantGuid}
                onChange={(e) => setTenantGuid(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "1px solid #ccc",
                  fontSize: 13,
                  fontFamily: "monospace",
                  boxSizing: "border-box"
                }}
              />
            </label>

            <label style={{ display: "block", marginBottom: 14 }}>
              <span
                style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 4 }}
              >
                Primary domain <span style={{ color: "#c00", fontWeight: 400 }}>*</span>
              </span>
              <input
                type="text"
                value={primaryDomain}
                onChange={(e) => setPrimaryDomain(e.target.value)}
                placeholder="contoso.onmicrosoft.com"
                autoComplete="off"
                spellCheck={false}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "1px solid #ccc",
                  fontSize: 13,
                  boxSizing: "border-box"
                }}
              />
            </label>

            <label style={{ display: "block", marginBottom: 20 }}>
              <span
                style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 4 }}
              >
                Display name{" "}
                <span style={{ fontWeight: 400, opacity: 0.45 }}>(optional)</span>
              </span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Contoso Ltd"
                autoComplete="off"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "1px solid #ccc",
                  fontSize: 13,
                  boxSizing: "border-box"
                }}
              />
            </label>

            {step1Error && (
              <div
                style={{
                  background: "#fff2f2",
                  border: "1px solid #fcc",
                  borderRadius: 6,
                  padding: "10px 12px",
                  marginBottom: 16,
                  fontSize: 13,
                  color: "#a00"
                }}
              >
                {step1Error}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                onClick={onClose}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "1px solid #ccc",
                  background: "#fff",
                  cursor: "pointer",
                  fontSize: 13
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleStep1Next}
                disabled={creating}
                style={{
                  padding: "8px 18px",
                  borderRadius: 6,
                  border: "none",
                  background: creating ? "#999" : "#0070f3",
                  color: "#fff",
                  cursor: creating ? "not-allowed" : "pointer",
                  fontSize: 13,
                  fontWeight: 600
                }}
              >
                {creating ? "Creating…" : "Next →"}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Admin consent ── */}
        {step === 2 && (
          <div>
            <p style={{ marginTop: 0, marginBottom: 16, fontSize: 14, opacity: 0.65 }}>
              A <strong>Global Administrator</strong> in the customer tenant must grant admin
              consent for the discovery app before the connection test will pass.
            </p>

            <ol
              style={{ fontSize: 14, paddingLeft: 20, marginBottom: 20, lineHeight: 1.8 }}
            >
              <li>Open the consent URL below in a new browser tab</li>
              <li>
                Sign in as a Global Administrator for <strong>{tenantLabel}</strong>
              </li>
              <li>
                Review the requested permissions and click <strong>Accept</strong>
              </li>
              <li>Return here and run the connection test</li>
            </ol>

            {consentUrl ? (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                  Admin consent URL
                </div>
                <div
                  style={{
                    background: "#f6f6f6",
                    border: "1px solid #ddd",
                    borderRadius: 6,
                    padding: "10px 12px",
                    fontSize: 11,
                    fontFamily: "monospace",
                    wordBreak: "break-all",
                    marginBottom: 8,
                    userSelect: "all"
                  }}
                >
                  {consentUrl}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => void navigator.clipboard.writeText(consentUrl)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 5,
                      border: "1px solid #ccc",
                      background: "#fff",
                      cursor: "pointer",
                      fontSize: 12
                    }}
                  >
                    Copy
                  </button>
                  <a
                    href={consentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-block",
                      padding: "6px 12px",
                      borderRadius: 5,
                      border: "1px solid #ccc",
                      background: "#fff",
                      fontSize: 12,
                      textDecoration: "none",
                      color: "inherit"
                    }}
                  >
                    Open ↗
                  </a>
                </div>
              </div>
            ) : (
              <div
                style={{
                  background: "#fffbe6",
                  border: "1px solid #ffe58f",
                  borderRadius: 6,
                  padding: "10px 12px",
                  marginBottom: 20,
                  fontSize: 13
                }}
              >
                <strong>Note:</strong> <code>NEXT_PUBLIC_GRAPH_CLIENT_ID</code> is not
                configured. Contact your platform administrator for the consent URL.
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <button
                onClick={onClose}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "1px solid #ccc",
                  background: "#fff",
                  cursor: "pointer",
                  fontSize: 13
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => setStep(3)}
                style={{
                  padding: "8px 18px",
                  borderRadius: 6,
                  border: "none",
                  background: "#0070f3",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600
                }}
              >
                Run connection test →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Connection test ── */}
        {step === 3 && (
          <div>
            <p style={{ marginTop: 0, marginBottom: 20, fontSize: 14, opacity: 0.65 }}>
              Testing the Graph API connection for <strong>{tenantLabel}</strong>.
            </p>

            {testState === "testing" && (
              <div style={{ padding: "16px 0", fontSize: 14, opacity: 0.65 }}>
                ⏳ Running connection test…
              </div>
            )}

            {testState === "connected" && (
              <div
                style={{
                  background: "#f0fff4",
                  border: "1px solid #b7ebc8",
                  borderRadius: 6,
                  padding: "12px 16px",
                  marginBottom: 20,
                  fontSize: 14,
                  color: "#1a7f37"
                }}
              >
                ✓ Connected — tenant is ready for discovery runs.
              </div>
            )}

            {(testState === "error" || testState === "timeout") && (
              <div
                style={{
                  background: "#fff2f2",
                  border: "1px solid #fcc",
                  borderRadius: 6,
                  padding: "12px 16px",
                  marginBottom: 20,
                  fontSize: 14,
                  color: "#a00"
                }}
              >
                {testState === "timeout"
                  ? "Connection test timed out. Ensure admin consent has been granted and try again."
                  : (testError ?? "Connection test failed.")}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => {
                    if (pollRef.current) clearInterval(pollRef.current);
                    setTestState("idle");
                    setStep(2);
                  }}
                  disabled={testState === "testing"}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 6,
                    border: "1px solid #ccc",
                    background: "#fff",
                    cursor: testState === "testing" ? "not-allowed" : "pointer",
                    fontSize: 13,
                    opacity: testState === "testing" ? 0.5 : 1
                  }}
                >
                  ← Back
                </button>
                {(testState === "error" || testState === "timeout") && (
                  <button
                    onClick={startTest}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 6,
                      border: "1px solid #0070f3",
                      background: "#fff",
                      color: "#0070f3",
                      cursor: "pointer",
                      fontSize: 13
                    }}
                  >
                    Retry
                  </button>
                )}
              </div>
              <button
                onClick={onComplete}
                disabled={testState !== "connected"}
                style={{
                  padding: "8px 18px",
                  borderRadius: 6,
                  border: "none",
                  background: testState === "connected" ? "#0070f3" : "#ccc",
                  color: "#fff",
                  cursor: testState === "connected" ? "pointer" : "not-allowed",
                  fontSize: 13,
                  fontWeight: 600
                }}
              >
                Finish
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
