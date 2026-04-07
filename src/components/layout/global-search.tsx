"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, FlaskConical, FolderKanban, Layers, Play, X, Loader2 } from "lucide-react";

interface SearchResult {
  id: string;
  type: string;
  href: string;
  title?: string;
  name?: string;
  status?: string;
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ tests: SearchResult[]; projects: SearchResult[]; suites: SearchResult[]; runs: SearchResult[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Cmd+K shortcut
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (!query || query.length < 2) { setResults(null); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const json = await res.json();
        setResults(json.data);
      } catch { setResults(null); }
      setLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  function navigate(href: string) {
    router.push(href);
    setOpen(false);
    setQuery("");
  }

  const icons: Record<string, unknown> = { test: FlaskConical, project: FolderKanban, suite: Layers, run: Play };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 bg-gray-900 border border-gray-800 rounded-lg text-xs text-gray-500 hover:text-gray-300 hover:border-gray-700 transition-colors"
      >
        <Search className="w-3.5 h-3.5" />
        Search...
        <kbd className="ml-2 px-1.5 py-0.5 bg-gray-800 rounded text-[10px] text-gray-500">⌘K</kbd>
      </button>
    );
  }

  const allResults = [...(results?.tests || []), ...(results?.projects || []), ...(results?.suites || []), ...(results?.runs || [])];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-start justify-center pt-[15vh] z-50 p-4" onClick={() => setOpen(false)}>
      <div className="w-full max-w-lg bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 border-b border-gray-800">
          <Search className="w-4 h-4 text-gray-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search tests, projects, runs..."
            className="flex-1 py-3.5 bg-transparent text-sm text-white placeholder:text-gray-500 focus:outline-none"
          />
          {loading && <Loader2 className="w-4 h-4 text-gray-500 animate-spin" />}
          <button onClick={() => setOpen(false)} className="p-1 text-gray-500 hover:text-gray-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {query.length >= 2 && allResults.length === 0 && !loading && (
            <div className="px-4 py-8 text-center text-sm text-gray-500">No results for "{query}"</div>
          )}

          {results && (
            <div className="py-2">
              {[
                { key: "tests", label: "Tests", items: results.tests },
                { key: "projects", label: "Projects", items: results.projects },
                { key: "suites", label: "Suites", items: results.suites },
                { key: "runs", label: "Runs", items: results.runs },
              ].filter(g => g.items.length > 0).map(group => (
                <div key={group.key}>
                  <div className="px-4 py-1.5 text-[10px] text-gray-500 uppercase tracking-wider font-medium">{group.label}</div>
                  {group.items.map((item: Record<string, unknown>) => {
                    const Icon = icons[item.type] || FlaskConical;
                    return (
                      <button
                        key={item.id}
                        onClick={() => navigate(item.href)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800/60 text-left transition-colors"
                      >
                        <Icon className="w-4 h-4 text-gray-500 shrink-0" />
                        <span className="text-sm text-gray-200 truncate">{item.title || item.name || item.id}</span>
                        {item.status && (
                          <span className="ml-auto text-[10px] text-gray-500 capitalize">{item.status}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {!query && (
            <div className="px-4 py-6 text-center text-xs text-gray-500">
              Start typing to search across all your tests, projects, and runs
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
