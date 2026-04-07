"use client";

import { useState, useEffect, useRef } from "react";
import { Sparkles, X, Send, Loader2, Mic, Paperclip } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export function AIAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Cmd+I shortcut
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "i") {
        e.preventDefault();
        setOpen(!open);
      }
      if (e.key === "Escape" && open) setOpen(false);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      if (messages.length === 0) {
        setMessages([{
          role: "assistant",
          content: "Hi! I'm your Testara AI assistant. I can help you create tests, debug failures, generate data, or answer questions about your testing. What do you need?",
          timestamp: new Date(),
        }]);
      }
    }
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    if (!input.trim() || loading) return;
    const userMsg: Message = { role: "user", content: input, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      // Get current page context
      const pageContext = window.location.pathname;

      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg.content,
          history: messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
          context: { page: pageContext },
        }),
      });
      const json = await res.json();

      setMessages(prev => [...prev, {
        role: "assistant",
        content: json.data?.response || json.error || "Sorry, something went wrong.",
        timestamp: new Date(),
      }]);
    } catch {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "Connection error. Please try again.",
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 w-12 h-12 bg-indigo-500 text-white rounded-full flex items-center justify-center shadow-lg shadow-indigo-500/20 hover:bg-indigo-400 transition-all hover:scale-105 z-40"
        title="AI Assistant (Cmd+I)"
      >
        <Sparkles className="w-5 h-5" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-96 h-[520px] bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl shadow-black/40 flex flex-col z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-indigo-500/20 rounded-lg flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <span className="text-sm font-medium text-white">AI Assistant</span>
            <span className="text-[10px] text-gray-500 ml-2">Cmd+I</span>
          </div>
        </div>
        <button onClick={() => setOpen(false)} className="p-1 text-gray-500 hover:text-gray-300">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed ${
              msg.role === "user"
                ? "bg-indigo-500/15 border border-indigo-500/20 text-gray-200 rounded-br-md"
                : "bg-gray-800 text-gray-300 rounded-bl-md"
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Actions */}
      {messages.length <= 1 && (
        <div className="px-4 pb-2 flex flex-wrap gap-1.5">
          {[
            "Generate a test for my project",
            "Why did my last test fail?",
            "Create test data for login",
            "Suggest what to test next",
          ].map((q, i) => (
            <button key={i} onClick={() => { setInput(q); }} className="px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-[10px] text-gray-400 hover:text-white hover:border-gray-600 transition-colors">
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-gray-800 p-3">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && sendMessage()}
            placeholder="Ask anything..."
            className="flex-1 px-3.5 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-xs text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          />
          <button onClick={sendMessage} disabled={loading || !input.trim()} className="p-2.5 bg-indigo-500 text-white rounded-xl hover:bg-indigo-400 disabled:opacity-50 transition-colors">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
