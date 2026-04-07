"use client";
import { useState, useEffect } from "react";
import Link from "next/link";

export function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const consent = document.cookie.includes("testara_consent=accepted");
    if (!consent) setShow(true);
  }, []);

  function accept() {
    document.cookie = "testara_consent=accepted; max-age=31536000; path=/; SameSite=Lax";
    setShow(false);
  }

  function reject() {
    document.cookie = "testara_consent=rejected; max-age=31536000; path=/; SameSite=Lax";
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-gray-900 border-t border-gray-800 shadow-2xl">
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
        <p className="text-xs text-gray-400 flex-1">
          We use essential cookies for authentication and security. We use{" "}
          <a href="https://plausible.io" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">Plausible Analytics</a>{" "}
          (cookie-free, GDPR-compliant) for anonymous usage statistics. No tracking cookies. No ads.{" "}
          <Link href="/privacy" className="text-indigo-400 hover:underline">Privacy Policy</Link>
        </p>
        <div className="flex gap-2 shrink-0">
          <button onClick={reject} className="px-4 py-2 text-xs text-gray-400 bg-gray-800 rounded-lg hover:text-white">Essential Only</button>
          <button onClick={accept} className="px-4 py-2 text-xs text-white bg-indigo-500 rounded-lg hover:bg-indigo-400 font-medium">Accept All</button>
        </div>
      </div>
    </div>
  );
}
