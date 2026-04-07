"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { isSensitiveField, maskValue } from "@/lib/security/masking";

// ===== MASKED VALUE DISPLAY =====
// Shows ••••••• by default, click eye icon to reveal temporarily
export function MaskedValue({ value, fieldName, className }: {
  value: string;
  fieldName?: string;
  className?: string;
}) {
  const [revealed, setRevealed] = useState(false);

  // Check if this field should be masked
  const check = fieldName ? isSensitiveField(fieldName) : { sensitive: false, type: "" };
  if (!check.sensitive) return <span className={className}>{value}</span>;

  return (
    <span className={`inline-flex items-center gap-1.5 ${className || ""}`}>
      <span className="font-mono text-xs">
        {revealed ? value : maskValue(value, check.type)}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); setRevealed(!revealed); if (!revealed) setTimeout(() => setRevealed(false), 5000); }}
        className="p-0.5 text-gray-600 hover:text-gray-400 transition-colors"
        title={revealed ? "Hide" : "Reveal (auto-hides in 5s)"}
      >
        {revealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
      </button>
    </span>
  );
}

// ===== MASKED INPUT =====
// For editing sensitive values — shows dots while typing, with toggle
export function MaskedInput({ value, onChange, fieldName, placeholder, className }: {
  value: string;
  onChange: (value: string) => void;
  fieldName?: string;
  placeholder?: string;
  className?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const check = fieldName ? isSensitiveField(fieldName) : { sensitive: false, type: "" };
  const isSensitive = check.sensitive;

  return (
    <div className="relative">
      <input
        type={isSensitive && !revealed ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={className || "w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"}
      />
      {isSensitive && (
        <button
          type="button"
          onClick={() => setRevealed(!revealed)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-600 hover:text-gray-400"
        >
          {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );
}

// ===== SENSITIVE BADGE =====
// Shows a small lock icon next to sensitive field names
export function SensitiveBadge({ fieldName }: { fieldName: string }) {
  const check = isSensitiveField(fieldName);
  if (!check.sensitive) return null;

  return (
    <span className="inline-flex items-center gap-0.5 ml-1 px-1 py-0.5 bg-amber-500/10 text-amber-400 text-[8px] rounded" title={`Sensitive field (${check.type})`}>
      🔒
    </span>
  );
}
