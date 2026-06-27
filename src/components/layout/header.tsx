"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, Sun, Moon, X, FileText, Building2, Users, Briefcase, Presentation, Tag, Loader2 } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { apiFetch } from "@/lib/api";

const iconMap: Record<string, any> = {
  quotation: FileText, brand: Building2, vendor: Users, project: Briefcase, presentation: Presentation, service: Tag,
};

const labelMap: Record<string, string> = {
  quotation: "Quotation", brand: "Brand", vendor: "Vendor", project: "Project", presentation: "Presentation", service: "Service",
};

export function Header({ title }: { title?: string }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
        setQuery("");
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 1) { setResults([]); setShowDropdown(false); setLoading(false); return; }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const res = await apiFetch(`/api/search?q=${encodeURIComponent(query)}&page=${encodeURIComponent(pathname)}`);
      const data = await res.json();
      if (Array.isArray(data.results)) { setResults(data.results); setShowDropdown(true); }
      setLoading(false);
    }, 250);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, pathname]);

  const handleSelect = (result: any) => { setQuery(""); setShowDropdown(false); router.push(result.href); };
  const handleClear = () => { setQuery(""); setResults([]); setShowDropdown(false); };

  return (
    <header className="fixed top-0 left-64 right-0 z-20 flex items-center justify-center h-16 px-6">
      {title && (
        <h1 className={`absolute left-6 text-2xl font-bold leading-none ${isDark ? "text-white" : "text-gray-900"}`} style={{ fontSize: "1.35rem", lineHeight: "2.5rem" }}>
          {title}
        </h1>
      )}

      <div className="relative w-full max-w-md" ref={dropdownRef}>
          <div className={`relative rounded-full border shadow-lg transition-all duration-300 ${
            focused
              ? "border-[#E87A1E]/40 bg-[var(--bg-elevated)] shadow-[#E87A1E]/10 shadow-xl ring-2 ring-[#E87A1E]/20"
              : "border-[var(--border-subtle)] bg-[var(--bg-subtle)] shadow-black/20"
          }`}>
            <div className="absolute left-4 top-1/2 -translate-y-1/2">
              {loading ? (
                <Loader2 className="h-4 w-4 text-[#E87A1E] animate-spin" />
              ) : (
                <Search className={`h-4 w-4 transition-all duration-300 ${focused ? "text-[#E87A1E] scale-110" : "text-[var(--text-muted)]"}`} />
              )}
            </div>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={() => { setFocused(true); if (results.length > 0) setShowDropdown(true); }}
              placeholder="Search brands, vendors, quotations..."
              className="w-full bg-transparent py-3 pl-11 pr-10 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:outline-none transition-all"
            />
            {query.length > 0 && (
              <button onClick={handleClear} className="absolute right-3 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full bg-[var(--bg-elevated)] flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-elevated-20)] hover:text-[var(--text-primary)] transition-all">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {showDropdown && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] backdrop-blur-xl rounded-xl shadow-2xl shadow-black/40 max-h-[70vh] overflow-y-auto z-50">
              {loading ? (
                <div className="p-4 text-center text-[var(--text-muted)] text-sm flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-[#E87A1E]" /> Searching...
                </div>
              ) : results.length === 0 ? (
                <div className="p-4 text-center text-[var(--text-muted)] text-sm">No results found</div>
              ) : (
                <>
                  <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
                    <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Results prioritized for this page</span>
                  </div>
                  {results.map((r: any, i: number) => {
                    const Icon = iconMap[r.type] || FileText;
                    return (
                      <button key={`${r.type}-${r.id}-${i}`} onClick={() => handleSelect(r)}
                        className="flex items-center gap-3 w-full px-4 py-3 hover:bg-[var(--bg-elevated)] transition-colors text-left border-b border-[var(--border-subtle)] last:border-b-0">
                        <div className="h-8 w-8 rounded-lg bg-[#E87A1E]/10 flex items-center justify-center shrink-0">
                          <Icon className="h-4 w-4 text-[#E87A1E]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--text-primary)] truncate">{r.title}</p>
                          <p className="text-xs text-[var(--text-muted)] truncate">{r.subtitle}</p>
                        </div>
                        <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase shrink-0">{labelMap[r.type]}</span>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          )}
      </div>

      <div className="absolute right-6 shrink-0">
        <button onClick={toggleTheme}
          className="relative flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-subtle)] backdrop-blur-md px-3 py-3 shadow-lg shadow-black/20 hover:bg-[var(--bg-elevated)] transition-all group"
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}>
          <Sun className={`h-4 w-4 transition-colors ${isDark ? "text-[var(--text-muted)]" : "text-amber-400"}`} />
          <div className="relative w-8 h-[18px] rounded-full bg-[#333] group-hover:bg-[#444] transition-colors">
            <div className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-[#E87A1E] transition-transform duration-200 ${isDark ? "translate-x-[2px]" : "translate-x-[14px]"}`} />
          </div>
          <Moon className={`h-4 w-4 transition-colors ${isDark ? "text-blue-400" : "text-[var(--text-muted)]"}`} />
        </button>
      </div>
    </header>
  );
}
