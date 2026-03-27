"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type EmailType = "internal" | "external";
type Format = "detail" | "short";
type Recipient = "participant" | "relay";

interface UploadedFile {
  fileName: string;
  charCount: number;
  text: string;
}

export default function Home() {
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [emailType, setEmailType] = useState<EmailType>("internal");
  const [format, setFormat] = useState<Format>("detail");
  const [recipient, setRecipient] = useState<Recipient>("participant");
  const [instructions, setInstructions] = useState(
    `Capture all decisions, names, numbers, action items exactly. WHY before WHAT. (VERY IMPORTANT)(NON-NEGOTIABLE)(CRITICAL) where applicable. Founder voice. No transcript replay language.`
  );
  const [generatedEmail, setGeneratedEmail] = useState("");
  const [generating, setGenerating] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [error, setError] = useState("");
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState("");
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emailPanelRef = useRef<HTMLDivElement>(null);

  // Check Gmail auth status on mount and after OAuth redirect
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch("/api/auth/status");
        const data = await res.json();
        if (data.authenticated) {
          setGmailConnected(true);
          setGmailEmail(data.email || "");
        }
      } catch {}
    };
    checkAuth();

    // Check URL params for OAuth callback result
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth_success")) {
      setGmailConnected(true);
      setGmailEmail(params.get("email") || "");
      // Clean URL
      window.history.replaceState({}, "", "/");
    }
    if (params.get("auth_error")) {
      setError("Gmail auth failed: " + params.get("auth_error"));
      window.history.replaceState({}, "", "/");
    }
  }, []);

  const handleConnectGmail = useCallback(() => {
    window.location.href = "/api/auth/google";
  }, []);

  const handleDisconnectGmail = useCallback(async () => {
    await fetch("/api/auth/status", { method: "DELETE" });
    setGmailConnected(false);
    setGmailEmail("");
  }, []);

  const handleSaveDraft = useCallback(async () => {
    if (!generatedEmail) return;

    setSavingDraft(true);
    setError("");

    try {
      // Extract subject from generated email
      const subjectMatch = generatedEmail.match(/^Subject:\s*(.+)$/m);
      const subject = subjectMatch ? subjectMatch[1].trim() : "Meeting Follow-up";

      // Remove the subject line from body
      const body = generatedEmail.replace(/^Subject:\s*.+$/m, "").trim();

      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401) {
          setGmailConnected(false);
          setGmailEmail("");
          throw new Error("Gmail session expired. Please reconnect.");
        }
        throw new Error(data.error || "Failed to save draft");
      }

      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 4000);
    } catch (err: any) {
      setError(err.message || "Failed to save draft");
    } finally {
      setSavingDraft(false);
    }
  }, [generatedEmail]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setUploading(true);
    setError("");
    setFile(null);
    setGeneratedEmail("");
    setDraftSaved(false);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      setFile(data);
    } catch (err: any) {
      setError(err.message || "Failed to upload file");
    } finally {
      setUploading(false);
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!file) return;

    setGenerating(true);
    setGeneratedEmail("");
    setError("");
    setDraftSaved(false);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailType,
          format,
          recipient,
          instructions,
          transcript: file.text,
        }),
      });

      if (!res.ok) {
        let errMsg = "Failed to generate email";
        try {
          const data = await res.json();
          errMsg = data.error || errMsg;
        } catch {}
        throw new Error(errMsg);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              setError(parsed.error);
              return;
            }
            if (parsed.text) {
              accumulated += parsed.text;
              setGeneratedEmail(accumulated);
            }
          } catch {}
        }
      }

      if (!accumulated) {
        setError("No response received. Check your API key and billing at console.anthropic.com");
      }
    } catch (err: any) {
      setError(err.message || "Failed to generate email");
    } finally {
      setGenerating(false);
    }
  }, [file, emailType, format, recipient, instructions]);

  const handleCopyEmail = useCallback(() => {
    navigator.clipboard.writeText(generatedEmail);
  }, [generatedEmail]);

  const formatEmailHtml = (text: string): string => {
    // Convert markdown-ish formatting to HTML for display
    let html = text
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/^### (.+)$/gm, '<h3 class="text-cyan-400 font-semibold mt-4 mb-1">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 class="text-cyan-400 font-semibold mt-5 mb-2 text-lg">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 class="text-cyan-300 font-bold mt-6 mb-2 text-xl">$1</h1>')
      .replace(/^Subject:\s*(.+)$/gm, '<div class="bg-cyan-950/40 border border-cyan-800/30 rounded px-4 py-2 mb-4 text-cyan-300 font-semibold">Subject: $1</div>')
      .replace(/^- (.+)$/gm, '<li class="ml-4 mb-1">$1</li>')
      .replace(/^(\d+)\.\s+(.+)$/gm, '<div class="mt-4 mb-2"><span class="text-cyan-400 font-bold">$1.</span> $2</div>')
      .replace(/\n\n/g, "</p><p class='mb-3'>")
      .replace(/\n/g, "<br>");

    return `<p class='mb-3'>${html}</p>`;
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: "var(--border-default)" }}>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
            FireFlies
          </span>
          <span style={{ color: "var(--text-muted)" }}>→</span>
          <span className="text-lg font-bold" style={{ color: "var(--accent-cyan)" }}>
            Email
          </span>
        </div>
        <div className="flex items-center gap-3">
          {gmailConnected ? (
            <>
              <div className="flex items-center gap-1.5 text-sm">
                <span className="w-2 h-2 rounded-full bg-green-400"></span>
                <span style={{ color: "var(--accent-green)" }}>Drafts</span>
                <span style={{ color: "var(--text-muted)" }}>→ {gmailEmail}</span>
              </div>
              <button
                onClick={handleDisconnectGmail}
                className="text-xs px-2 py-1 rounded transition-colors hover:bg-red-900/30"
                style={{ color: "var(--text-muted)", border: "1px solid var(--border-default)" }}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={handleConnectGmail}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-all hover:bg-cyan-900/20"
              style={{ color: "var(--accent-cyan)", border: "1px solid var(--border-default)" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
              Connect Gmail
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-1 overflow-hidden">
        {/* Left Panel — Controls */}
        <div className="w-[340px] min-w-[340px] p-5 overflow-y-auto border-r flex flex-col gap-5"
          style={{ borderColor: "var(--border-default)", background: "var(--bg-primary)" }}>

          {/* Transcript File */}
          <Section label="TRANSCRIPT FILE">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".pdf,.docx,.doc,.txt"
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full rounded-lg border-2 border-dashed p-4 text-center transition-all hover:border-cyan-500/50"
              style={{
                borderColor: file ? "var(--accent-cyan)" : "var(--border-default)",
                background: file ? "rgba(6,182,212,0.05)" : "var(--bg-input)",
              }}
            >
              {uploading ? (
                <div className="animate-pulse-glow" style={{ color: "var(--accent-cyan)" }}>
                  Processing...
                </div>
              ) : file ? (
                <div>
                  <div className="font-medium text-sm truncate" style={{ color: "var(--text-primary)" }}>
                    {file.fileName}
                  </div>
                  <div className="text-xs mt-1" style={{ color: "var(--accent-green)" }}>
                    Ready — {file.charCount.toLocaleString()} chars
                  </div>
                </div>
              ) : (
                <div>
                  <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
                    Click to upload transcript
                  </div>
                  <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    .pdf, .docx, .doc, .txt
                  </div>
                </div>
              )}
            </button>
          </Section>

          {/* Email Type */}
          <Section label="EMAIL TYPE">
            <div className="flex gap-3">
              <ToggleButton
                active={emailType === "internal"}
                onClick={() => setEmailType("internal")}
                label="Internal"
                sublabel="Team"
              />
              <ToggleButton
                active={emailType === "external"}
                onClick={() => setEmailType("external")}
                label="External"
                sublabel="Client"
              />
            </div>
          </Section>

          {/* Format */}
          <Section label="FORMAT">
            <div className="flex gap-3">
              <ToggleButton
                active={format === "detail"}
                onClick={() => setFormat("detail")}
                label="In Detail"
              />
              <ToggleButton
                active={format === "short"}
                onClick={() => setFormat("short")}
                label="Short"
              />
            </div>
          </Section>

          {/* Recipient */}
          <Section label="RECIPIENT">
            <div className="flex gap-3">
              <ToggleButton
                active={recipient === "participant"}
                onClick={() => setRecipient("participant")}
                label="Participant"
                sublabel="In meeting"
              />
              <ToggleButton
                active={recipient === "relay"}
                onClick={() => setRecipient("relay")}
                label="Relay"
                sublabel="Not in meeting"
              />
            </div>
          </Section>

          {/* Instructions */}
          <Section label="INSTRUCTIONS">
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={5}
              className="w-full rounded-lg p-3 text-sm resize-y outline-none border transition-colors focus:border-cyan-600"
              style={{
                background: "var(--bg-input)",
                color: "var(--text-primary)",
                borderColor: "var(--border-default)",
              }}
              placeholder="Additional instructions for email generation..."
            />
          </Section>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={!file || generating}
            className="w-full py-3 rounded-lg font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: generating
                ? "var(--bg-input)"
                : file
                ? "linear-gradient(135deg, #06b6d4, #3b82f6)"
                : "var(--bg-input)",
              color: generating ? "var(--text-muted)" : "white",
            }}
          >
            {generating ? "Generating..." : "Generate Email"}
          </button>

          {/* Status */}
          {generating && (
            <div
              className="text-center text-xs rounded-lg p-3 animate-fade-in"
              style={{ background: "rgba(6,182,212,0.08)", color: "var(--accent-cyan)" }}
            >
              <div className="font-medium">Claude is reading your full transcript.</div>
              <div style={{ color: "var(--text-muted)" }}>
                Email will appear in the panel
              </div>
              <div style={{ color: "var(--text-muted)" }}>
                and be saved to Gmail automatically.
              </div>
            </div>
          )}

          {error && (
            <div className="text-center text-xs rounded-lg p-3 border"
              style={{ background: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.2)", color: "#ef4444" }}>
              {error}
            </div>
          )}
        </div>

        {/* Right Panel — Generated Email */}
        <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "var(--bg-secondary)" }}>
          <div className="flex items-center justify-between px-6 py-3 border-b"
            style={{ borderColor: "var(--border-default)" }}>
            <h2 className="text-xs font-bold tracking-widest uppercase"
              style={{ color: "var(--text-muted)" }}>
              Generated Email
            </h2>
            {generatedEmail && !generating && (
              <div className="flex gap-2 items-center">
                {draftSaved && (
                  <span className="text-xs" style={{ color: "var(--accent-green)" }}>
                    Saved to drafts!
                  </span>
                )}
                <button
                  onClick={() => {
                    handleCopyEmail();
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="px-3 py-1.5 rounded text-xs font-medium transition-colors hover:bg-cyan-900/30"
                  style={{ color: "var(--accent-cyan)", border: "1px solid var(--border-default)" }}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
                {gmailConnected ? (
                  <button
                    onClick={handleSaveDraft}
                    disabled={savingDraft}
                    className="px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-50"
                    style={{
                      background: draftSaved ? "rgba(34,197,94,0.15)" : "rgba(6,182,212,0.15)",
                      color: draftSaved ? "var(--accent-green)" : "var(--accent-cyan)",
                      border: draftSaved ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(6,182,212,0.3)",
                    }}
                  >
                    {savingDraft ? "Saving..." : draftSaved ? "Saved!" : "Save to Draft"}
                  </button>
                ) : (
                  <button
                    onClick={handleConnectGmail}
                    className="px-3 py-1.5 rounded text-xs font-medium transition-colors hover:bg-cyan-900/30"
                    style={{ color: "var(--text-muted)", border: "1px solid var(--border-default)" }}
                  >
                    Connect Gmail to Save
                  </button>
                )}
              </div>
            )}
          </div>

          <div ref={emailPanelRef} className="flex-1 overflow-y-auto p-6">
            {generatedEmail ? (
              <div
                className="email-content animate-fade-in max-w-3xl"
                dangerouslySetInnerHTML={{ __html: formatEmailHtml(generatedEmail) }}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                    {file
                      ? "Claude is reading your full transcript and drafting the email..."
                      : "Upload a transcript file to get started"}
                  </div>
                  {file && !generating && (
                    <div className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
                      This panel will update automatically once complete.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        className="text-[10px] font-bold tracking-[0.15em] uppercase mb-2"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
  sublabel,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sublabel?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex-1 rounded-lg px-4 py-2.5 text-left transition-all border"
      style={{
        background: active ? "rgba(6,182,212,0.1)" : "var(--bg-input)",
        borderColor: active ? "var(--accent-cyan)" : "var(--border-default)",
        color: active ? "var(--accent-cyan)" : "var(--text-secondary)",
      }}
    >
      <div className="text-sm font-semibold">{label}</div>
      {sublabel && (
        <div className="text-[10px] mt-0.5" style={{ color: active ? "var(--accent-cyan)" : "var(--text-muted)" }}>
          {sublabel}
        </div>
      )}
    </button>
  );
}
