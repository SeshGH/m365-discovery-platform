"use client";

// apps/portal/src/app/t/[tenantId]/runs/[runId]/observed/[observedId]/_components/ReadonlyCopyField.tsx

import * as React from "react";

type Props = {
  label: string;
  value: string;
  hint?: string;
  monospace?: boolean;
};

export function ReadonlyCopyField({ label, value, hint, monospace }: Props) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [copied, setCopied] = React.useState(false);

  const displayValue = (value ?? "").trim();
  const isEmpty = displayValue.length === 0 || displayValue === "—";

  function selectAll() {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }

  function onFocus(e: React.FocusEvent<HTMLInputElement>) {
    // UX: select all for quick manual copy
    e.currentTarget.select();
  }

  async function onCopy() {
    if (isEmpty) return;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(displayValue);
      } else {
        // Fallback: select + execCommand
        selectAll();
        document.execCommand("copy");
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 900);
    } catch {
      // silent fail — user can still manual copy
      setCopied(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--fg)", opacity: 0.8 }}>
        {label}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          ref={inputRef}
          readOnly
          value={isEmpty ? "—" : displayValue}
          onFocus={onFocus}
          onClick={selectAll}
          style={{
            width: "100%",
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--card)",
            color: "var(--fg)", // ✅ correct token for text
            fontSize: 13,
            fontWeight: 500,
            letterSpacing: "0.01em",
            opacity: isEmpty ? 0.55 : 1,
            cursor: isEmpty ? "default" : "text",
            fontFamily: monospace
              ? "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
              : undefined
          }}
          aria-label={label}
        />

        <button
          type="button"
          onClick={onCopy}
          disabled={isEmpty}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: isEmpty ? "rgba(0,0,0,0.03)" : "white",
            color: "var(--fg)",
            cursor: isEmpty ? "not-allowed" : "pointer",
            fontSize: 13,
            whiteSpace: "nowrap",
            opacity: isEmpty ? 0.6 : 1
          }}
          aria-label={`Copy ${label}`}
          title={isEmpty ? "Nothing to copy" : `Copy ${label}`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div style={{ fontSize: 12, color: "var(--fg)", opacity: 0.7 }}>
        {hint ? hint : isEmpty ? "No value present." : "Tip: click the field, then Ctrl+C."}
      </div>
    </div>
  );
}
