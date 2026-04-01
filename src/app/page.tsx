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

interface FirefliesRecording {
  id: string;
  title: string;
  date: string | null;
  duration: number;
  organizer_email: string;
  participants: string[];
  transcript_url: string;
}

type MobileTab = "controls" | "recordings" | "email";

const ALLOWED_EMAILS = [
  "hk@schbang.com",
  "harsh@schbang.com",
  "saee.patil@schbang.com",
  "valentina.misquitta@schbang.com",
  "yadnesh.rane@schbang.com",
];

export default function Home() {
  const [mobileTab, setMobileTab] = useState<MobileTab>("controls");
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
  const [recordings, setRecordings] = useState<FirefliesRecording[]>([]);
  const [recordingsLoading, setRecordingsLoading] = useState(false);
  const [recordingsError, setRecordingsError] = useState("");
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);
  const [loadingTranscriptId, setLoadingTranscriptId] = useState<string | null>(null);
  const [recordingsSearch, setRecordingsSearch] = useState("");
  const [downloadDropdownId, setDownloadDropdownId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emailPanelRef = useRef<HTMLDivElement>(null);

  // 30 days in milliseconds
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  // Restore Gmail connection from localStorage on mount (persists across refreshes for 30 days)
  useEffect(() => {
    function restoreGmailTokens(): boolean {
      try {
        const stored = localStorage.getItem("ff_gmail_tokens");
        if (!stored) return false;

        const tokens = JSON.parse(stored);
        if (!tokens.access_token || !tokens.refresh_token) return false;

        // Check 30-day expiry — if stored_at is missing, treat as fresh (backwards compat)
        const storedAt = tokens.stored_at || Date.now();
        if (Date.now() - storedAt > THIRTY_DAYS_MS) {
          localStorage.removeItem("ff_gmail_tokens");
          return false;
        }

        setGmailConnected(true);
        setGmailEmail(tokens.email || "");
        return true;
      } catch {
        localStorage.removeItem("ff_gmail_tokens");
        return false;
      }
    }

    // Check URL params first for OAuth callback result
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth_error")) {
      setError("Gmail auth failed: " + params.get("auth_error"));
      window.history.replaceState({}, "", "/");
    }
    if (params.get("auth_success")) {
      window.history.replaceState({}, "", "/");
    }

    // Restore tokens from localStorage (works for both fresh auth and page refresh)
    restoreGmailTokens();
  }, []);

  // Auth gate: only whitelisted emails can use the app (bypassed on localhost)
  const [isLocalhost, setIsLocalhost] = useState(false);
  useEffect(() => {
    setIsLocalhost(window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  }, []);
  const isAuthorized = isLocalhost || (gmailConnected && ALLOWED_EMAILS.includes(gmailEmail.toLowerCase()));

  // Fetch Fireflies recordings only when authorized
  const fetchRecordings = useCallback(async () => {
    setRecordingsLoading(true);
    setRecordingsError("");
    try {
      const res = await fetch("/api/fireflies");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch recordings");
      setRecordings(data.transcripts || []);
    } catch (err: any) {
      setRecordingsError(err.message || "Failed to load recordings");
    } finally {
      setRecordingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthorized) fetchRecordings();
  }, [isAuthorized, fetchRecordings]);

  const handleSelectRecording = useCallback(async (recording: FirefliesRecording) => {
    if (loadingTranscriptId) return;

    setSelectedRecordingId(recording.id);
    setLoadingTranscriptId(recording.id);
    setError("");
    setGeneratedEmail("");
    setDraftSaved(false);

    try {
      const res = await fetch("/api/fireflies/" + recording.id);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load transcript");

      setFile({
        fileName: data.title || recording.title,
        charCount: data.charCount,
        text: data.text,
      });
    } catch (err: any) {
      setError(err.message || "Failed to load transcript");
      setSelectedRecordingId(null);
    } finally {
      setLoadingTranscriptId(null);
    }
  }, [loadingTranscriptId]);

  // Close download dropdown on outside click
  useEffect(() => {
    if (!downloadDropdownId) return;
    const handleClick = () => setDownloadDropdownId(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [downloadDropdownId]);

  const handleDownload = useCallback((recordingId: string, format: "pdf" | "docx") => {
    setDownloadDropdownId(null);
    window.open("/api/fireflies/" + recordingId + "/download?format=" + format, "_blank");
  }, []);

  const handleConnectGmail = useCallback(() => {
    window.location.href = "/api/auth/google";
  }, []);

  const handleDisconnectGmail = useCallback(() => {
    localStorage.removeItem("ff_gmail_tokens");
    setGmailConnected(false);
    setGmailEmail("");
    setRecordings([]);
    setFile(null);
    setGeneratedEmail("");
    setSelectedRecordingId(null);
  }, []);

  const handleSaveDraft = useCallback(async () => {
    if (!generatedEmail) return;

    setSavingDraft(true);
    setError("");

    try {
      // Get tokens from localStorage
      const stored = localStorage.getItem("ff_gmail_tokens");
      if (!stored) {
        setGmailConnected(false);
        throw new Error("Gmail not connected. Please connect first.");
      }
      const tokens = JSON.parse(stored);

      // Extract subject from generated email
      const subjectMatch = generatedEmail.match(/^Subject:\s*(.+)$/m);
      const subject = subjectMatch ? subjectMatch[1].trim() : "Meeting Follow-up";

      // Remove the subject line from body
      const body = generatedEmail.replace(/^Subject:\s*.+$/m, "").trim();

      // Get participants from the selected recording for CC
      const selectedRecording = recordings.find((r) => r.id === selectedRecordingId);
      const ccEmails = selectedRecording?.participants?.filter((p) => p && p.includes("@")) || [];

      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body, cc: ccEmails, tokens }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401) {
          // Only fully disconnect if there's no refresh token to recover with
          if (!tokens.refresh_token) {
            localStorage.removeItem("ff_gmail_tokens");
            setGmailConnected(false);
            setGmailEmail("");
            throw new Error("Gmail session expired. Please reconnect.");
          }
          throw new Error("Gmail session expired. Please reconnect your Gmail account.");
        }
        throw new Error(data.error || "Failed to save draft");
      }

      // If server refreshed the token, update localStorage while preserving stored_at
      if (data.updatedTokens) {
        const updatedEntry = {
          ...data.updatedTokens,
          stored_at: tokens.stored_at || Date.now(),
        };
        localStorage.setItem("ff_gmail_tokens", JSON.stringify(updatedEntry));
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
    setSelectedRecordingId(null);

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
    setMobileTab("email");

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
    // Step 1: Strip unwanted special characters (€, ™, ©, ®, etc.)
    let clean = text
      .replace(/[€™©®†‡§¶]/g, "")
      .replace(/\u200B/g, "") // zero-width space
      .replace(/\u00A0/g, " "); // non-breaking space → normal space

    // Step 2: Process line by line for clean rendering
    const lines = clean.split("\n");
    const htmlLines: string[] = [];
    let inList = false;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      // Subject line — special styling
      const subjectMatch = line.match(/^Subject:\s*(.+)$/);
      if (subjectMatch) {
        if (inList) { htmlLines.push("</ul>"); inList = false; }
        htmlLines.push('<div class="bg-cyan-950/40 border border-cyan-800/30 rounded px-3 py-1.5 mb-3 text-cyan-300 font-semibold text-xs">Subject: ' + subjectMatch[1] + "</div>");
        continue;
      }

      // Headers: ### / ## / #
      if (line.match(/^###\s+/)) {
        if (inList) { htmlLines.push("</ul>"); inList = false; }
        const content = line.replace(/^###\s+/, "").replace(/\*+/g, "");
        htmlLines.push('<h3 class="text-cyan-400 font-semibold mt-3 mb-1">' + content + "</h3>");
        continue;
      }
      if (line.match(/^##\s+/)) {
        if (inList) { htmlLines.push("</ul>"); inList = false; }
        const content = line.replace(/^##\s+/, "").replace(/\*+/g, "");
        htmlLines.push('<h2 class="text-cyan-400 font-semibold mt-3 mb-1">' + content + "</h2>");
        continue;
      }
      if (line.match(/^#\s+/)) {
        if (inList) { htmlLines.push("</ul>"); inList = false; }
        const content = line.replace(/^#\s+/, "").replace(/\*+/g, "");
        htmlLines.push('<h1 class="text-cyan-300 font-bold mt-4 mb-1">' + content + "</h1>");
        continue;
      }

      // Numbered sections: "1. Title" or "1) Title"
      const numMatch = line.match(/^(\d+)[.)]\s+(.+)$/);
      if (numMatch) {
        if (inList) { htmlLines.push("</ul>"); inList = false; }
        const content = numMatch[2].replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "$1");
        htmlLines.push('<div class="mt-4 mb-2"><span class="text-cyan-400 font-bold">' + numMatch[1] + ".</span> " + content + "</div>");
        continue;
      }

      // Bullet points: - or •
      const bulletMatch = line.match(/^\s*[-•]\s+(.+)$/);
      if (bulletMatch) {
        if (!inList) { htmlLines.push('<ul class="list-none ml-2 mb-2">'); inList = true; }
        const content = bulletMatch[1].replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "$1");
        htmlLines.push('<li class="mb-1 pl-3 relative before:content-[\'•\'] before:absolute before:left-0 before:text-cyan-600">' + content + "</li>");
        continue;
      }

      // Close list if we're no longer in bullets
      if (inList) { htmlLines.push("</ul>"); inList = false; }

      // Empty line = paragraph break
      if (line.trim() === "") {
        htmlLines.push('<div class="h-3"></div>');
        continue;
      }

      // Regular text — clean up stray markdown characters
      let processed = line
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>") // bold
        .replace(/\*([^*]+?)\*/g, "$1") // italics → just text (no stray *)
        .replace(/^\*+\s*/, "") // leading asterisks
        .replace(/\s*\*+$/, "") // trailing asterisks
        .replace(/_{2,}/g, "") // underscores used as separators
        .replace(/---+/g, '<hr class="border-cyan-900/30 my-3">'); // horizontal rules

      htmlLines.push('<p class="mb-1.5 leading-relaxed">' + processed + "</p>");
    }

    if (inList) htmlLines.push("</ul>");
    return htmlLines.join("\n");
  };

  /* ── Auth gate: block access for unauthorized users ── */

  if (!isAuthorized) {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-3 sm:px-5 py-2 sm:py-2.5 border-b shrink-0" style={{ borderColor: "var(--border-default)" }}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>FireFlies</span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>→</span>
            <span className="text-sm font-bold" style={{ color: "var(--accent-cyan)" }}>Email</span>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center" style={{ background: "var(--bg-primary)" }}>
          <div className="text-center max-w-sm px-6">
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl flex items-center justify-center" style={{ background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)" }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--accent-cyan)" }}>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h1 className="text-xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>Sign in to continue</h1>
            <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
              Connect your authorized Google account to access FireFlies Email.
            </p>
            {gmailConnected && !isAuthorized && (
              <div className="mb-4 px-4 py-3 rounded-lg text-xs" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}>
                <span className="font-semibold">{gmailEmail}</span> is not authorized to use this tool. Please sign in with an approved account.
                <button onClick={handleDisconnectGmail} className="block mx-auto mt-2 px-3 py-1 rounded text-[11px] transition-colors hover:bg-red-900/30"
                  style={{ color: "var(--text-muted)", border: "1px solid var(--border-default)" }}>
                  Disconnect
                </button>
              </div>
            )}
            {!gmailConnected && (
              <button
                onClick={handleConnectGmail}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all hover:opacity-90 active:scale-95"
                style={{ background: "linear-gradient(135deg, #06b6d4, #3b82f6)", color: "white" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
                Connect Google Account
              </button>
            )}
            {error && (
              <div className="mt-4 text-xs rounded-lg p-2 border" style={{ background: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.2)", color: "#ef4444" }}>
                {error}
              </div>
            )}
            <div className="mt-8" style={{ color: "rgba(100,116,139,0.4)" }}>
              <span className="text-[10px] tracking-wide">Made with ❤️ for HK</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Shared panel content (reused across breakpoints) ── */

  const controlsPanel = (
    <div className="flex flex-col h-full">
      <div className="flex flex-col gap-2.5 flex-1 p-3 overflow-y-auto">
        <Section label="TRANSCRIPT FILE">
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".pdf,.docx,.doc,.txt" className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full rounded-lg border-2 border-dashed p-2 text-center transition-all hover:border-cyan-500/50"
            style={{ borderColor: file ? "var(--accent-cyan)" : "var(--border-default)", background: file ? "rgba(6,182,212,0.05)" : "var(--bg-input)" }}
          >
            {uploading ? (
              <div className="animate-pulse-glow text-xs" style={{ color: "var(--accent-cyan)" }}>Processing...</div>
            ) : file ? (
              <div>
                <div className="font-medium text-xs truncate" style={{ color: "var(--text-primary)" }}>{file.fileName}</div>
                <div className="text-[10px] mt-0.5" style={{ color: "var(--accent-green)" }}>Ready — {file.charCount.toLocaleString()} chars</div>
              </div>
            ) : (
              <div>
                <div className="text-xs" style={{ color: "var(--text-secondary)" }}>Click to upload transcript</div>
                <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>.pdf, .docx, .doc, .txt</div>
              </div>
            )}
          </button>
        </Section>

        <Section label="EMAIL TYPE">
          <div className="flex gap-2">
            <ToggleButton active={emailType === "internal"} onClick={() => setEmailType("internal")} label="Internal" sublabel="Team" />
            <ToggleButton active={emailType === "external"} onClick={() => setEmailType("external")} label="External" sublabel="Client" />
          </div>
        </Section>

        <Section label="FORMAT">
          <div className="flex gap-2">
            <ToggleButton active={format === "detail"} onClick={() => setFormat("detail")} label="In Detail" />
            <ToggleButton active={format === "short"} onClick={() => setFormat("short")} label="Short" />
          </div>
        </Section>

        <Section label="RECIPIENT">
          <div className="flex gap-2">
            <ToggleButton active={recipient === "participant"} onClick={() => setRecipient("participant")} label="Participant" sublabel="In meeting" />
            <ToggleButton active={recipient === "relay"} onClick={() => setRecipient("relay")} label="Relay" sublabel="Not in meeting" />
          </div>
        </Section>

        <div className="flex flex-col flex-1 min-h-[60px]">
          <div className="text-[10px] font-bold tracking-[0.15em] uppercase mb-1" style={{ color: "var(--text-muted)" }}>INSTRUCTIONS</div>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            className="w-full flex-1 min-h-[48px] rounded-lg p-2 text-xs resize-none outline-none border transition-colors focus:border-cyan-600"
            style={{ background: "var(--bg-input)", color: "var(--text-primary)", borderColor: "var(--border-default)" }}
            placeholder="Additional instructions..."
          />
        </div>
      </div>

      <div className="px-3 pt-2 pb-3 flex flex-col gap-2 shrink-0">
        <button
          onClick={handleGenerate}
          disabled={!file || generating}
          className="w-full py-2.5 md:py-2 rounded-lg font-semibold text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: generating ? "var(--bg-input)" : file ? "linear-gradient(135deg, #06b6d4, #3b82f6)" : "var(--bg-input)", color: generating ? "var(--text-muted)" : "white" }}
        >
          {generating ? "Generating..." : "Generate Email"}
        </button>
        {generating && (
          <div className="text-center text-[10px] rounded-lg p-1.5 animate-fade-in" style={{ background: "rgba(6,182,212,0.08)", color: "var(--accent-cyan)" }}>
            Generating email...
          </div>
        )}
        {error && (
          <div className="text-center text-[10px] rounded-lg p-1.5 border" style={{ background: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.2)", color: "#ef4444" }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );

  const recordingsPanel = (
    <div className="flex flex-col h-full" style={{ background: "var(--bg-primary)" }}>
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0" style={{ borderColor: "var(--border-default)" }}>
        <h2 className="text-[10px] font-bold tracking-[0.15em] uppercase" style={{ color: "var(--text-muted)" }}>Fireflies Recordings</h2>
        <button onClick={fetchRecordings} disabled={recordingsLoading} className="p-1.5 rounded transition-colors hover:bg-cyan-900/20" style={{ color: "var(--text-muted)" }} title="Refresh">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={recordingsLoading ? "animate-spin" : ""}>
            <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
        </button>
      </div>
      <div className="px-3 py-1.5 border-b shrink-0" style={{ borderColor: "var(--border-default)" }}>
        <input type="text" value={recordingsSearch} onChange={(e) => setRecordingsSearch(e.target.value)} placeholder="Search recordings..."
          className="w-full rounded px-3 py-2 md:py-1.5 text-xs outline-none border transition-colors focus:border-cyan-600"
          style={{ background: "var(--bg-input)", color: "var(--text-primary)", borderColor: "var(--border-default)" }} />
      </div>
      <div className="flex-1 overflow-y-auto">
        {recordingsLoading && recordings.length === 0 ? (
          <div className="flex items-center justify-center h-32"><div className="text-xs animate-pulse-glow" style={{ color: "var(--accent-cyan)" }}>Loading recordings...</div></div>
        ) : recordingsError ? (
          <div className="p-4 text-center">
            <div className="text-xs mb-2" style={{ color: "#ef4444" }}>{recordingsError}</div>
            <button onClick={fetchRecordings} className="text-xs px-3 py-1.5 rounded transition-colors hover:bg-cyan-900/20" style={{ color: "var(--accent-cyan)", border: "1px solid var(--border-default)" }}>Retry</button>
          </div>
        ) : recordings.length === 0 ? (
          <div className="flex items-center justify-center h-32"><div className="text-xs" style={{ color: "var(--text-muted)" }}>No recordings found</div></div>
        ) : (
          recordings
            .filter((r) => !recordingsSearch || r.title.toLowerCase().includes(recordingsSearch.toLowerCase()) || r.organizer_email.toLowerCase().includes(recordingsSearch.toLowerCase()))
            .map((recording) => {
              const isSelected = selectedRecordingId === recording.id;
              const isLoading = loadingTranscriptId === recording.id;
              const dateStr = recording.date ? new Date(recording.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
              const durationMin = recording.duration ? Math.round(recording.duration / 60) : 0;
              const isDropdownOpen = downloadDropdownId === recording.id;
              return (
                <div key={recording.id} className="relative border-b" style={{ borderColor: "var(--border-default)" }}>
                  <button onClick={() => handleSelectRecording(recording)} disabled={isLoading}
                    className="w-full text-left px-3 pr-9 py-3 md:py-2 transition-all hover:bg-cyan-900/10 active:bg-cyan-900/20"
                    style={{ background: isSelected ? "rgba(6,182,212,0.08)" : "transparent", borderLeft: isSelected ? "2px solid var(--accent-cyan)" : "2px solid transparent" }}>
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate" style={{ color: isSelected ? "var(--accent-cyan)" : "var(--text-primary)" }}>{isLoading ? "Loading..." : recording.title}</div>
                        <div className="flex items-center gap-2 mt-1">
                          {dateStr && <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{dateStr}</span>}
                          {durationMin > 0 && <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{durationMin}m</span>}
                          {recording.participants.length > 0 && (
                            <span className="text-[10px] relative group/tip cursor-default" style={{ color: "var(--text-muted)" }}>
                              {recording.participants.length} participants
                              <span className="absolute bottom-full left-0 mb-1 hidden group-hover/tip:block z-50 px-2.5 py-2 rounded-lg text-[10px] leading-relaxed whitespace-pre-wrap max-w-[220px] shadow-xl border"
                                style={{ background: "var(--bg-card)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}>
                                {recording.participants.filter((p: string) => p).join("\n") || "No emails available"}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                      {isSelected && !isLoading && <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 bg-cyan-400" />}
                      {isLoading && <svg className="animate-spin mt-1 shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--accent-cyan)" }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>}
                    </div>
                  </button>
                  {/* Download button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setDownloadDropdownId(isDropdownOpen ? null : recording.id); }}
                    className="absolute top-2 right-2 p-1.5 rounded transition-colors hover:bg-cyan-900/30"
                    style={{ color: "var(--text-muted)" }}
                    title="Download transcript"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" />
                    </svg>
                  </button>
                  {/* Format dropdown */}
                  {isDropdownOpen && (
                    <div className="absolute top-8 right-2 z-50 rounded-lg border shadow-xl py-1 min-w-[90px] animate-fade-in"
                      style={{ background: "var(--bg-card)", borderColor: "var(--border-default)" }}
                      onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => handleDownload(recording.id, "pdf")}
                        className="w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-cyan-900/20 flex items-center gap-2"
                        style={{ color: "var(--text-primary)" }}>
                        <span style={{ color: "#ef4444" }}>PDF</span>
                      </button>
                      <button onClick={() => handleDownload(recording.id, "docx")}
                        className="w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-cyan-900/20 flex items-center gap-2"
                        style={{ color: "var(--text-primary)" }}>
                        <span style={{ color: "#3b82f6" }}>DOCX</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })
        )}
      </div>
    </div>
  );

  const emailPanel = (
    <div className="flex flex-col h-full" style={{ background: "var(--bg-secondary)" }}>
      <div className="flex items-center justify-between px-4 py-2 border-b shrink-0" style={{ borderColor: "var(--border-default)" }}>
        <h2 className="text-[10px] font-bold tracking-[0.15em] uppercase" style={{ color: "var(--text-muted)" }}>Generated Email</h2>
        {generatedEmail && !generating && (
          <div className="flex gap-2 items-center">
            {draftSaved && <span className="text-[10px]" style={{ color: "var(--accent-green)" }}>Saved!</span>}
            <button onClick={() => { handleCopyEmail(); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              className="px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors hover:bg-cyan-900/30 active:bg-cyan-900/40"
              style={{ color: "var(--accent-cyan)", border: "1px solid var(--border-default)" }}>
              {copied ? "Copied!" : "Copy"}
            </button>
            {gmailConnected ? (
              <button onClick={handleSaveDraft} disabled={savingDraft}
                className="px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors disabled:opacity-50"
                style={{ background: draftSaved ? "rgba(34,197,94,0.15)" : "rgba(6,182,212,0.15)", color: draftSaved ? "var(--accent-green)" : "var(--accent-cyan)", border: draftSaved ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(6,182,212,0.3)" }}>
                {savingDraft ? "Saving..." : draftSaved ? "Saved!" : "Save Draft"}
              </button>
            ) : (
              <button onClick={handleConnectGmail} className="px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors hover:bg-cyan-900/30"
                style={{ color: "var(--text-muted)", border: "1px solid var(--border-default)" }}>
                Connect Gmail
              </button>
            )}
          </div>
        )}
      </div>
      <div ref={emailPanelRef} className="flex-1 overflow-y-auto p-4 min-h-0">
        {generatedEmail ? (
          <div className="email-content animate-fade-in max-w-3xl" dangerouslySetInnerHTML={{ __html: formatEmailHtml(generatedEmail) }} />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                {file ? "Click Generate Email to start..." : "Select a recording or upload a transcript"}
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="text-center py-2 shrink-0" style={{ color: "rgba(100,116,139,0.4)" }}>
        <span className="text-[10px] tracking-wide">Made with ❤️ for HK</span>
      </div>
    </div>
  );

  /* ── Gmail header button (shared) ── */
  const gmailButton = gmailConnected ? (
    <>
      <div className="flex items-center gap-1.5 text-[10px] sm:text-xs">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>
        <span style={{ color: "var(--accent-green)" }}>Drafts</span>
        <span className="hidden sm:inline" style={{ color: "var(--text-muted)" }}>→ {gmailEmail}</span>
      </div>
      <button onClick={handleDisconnectGmail} className="text-[10px] px-2 py-0.5 rounded transition-colors hover:bg-red-900/30"
        style={{ color: "var(--text-muted)", border: "1px solid var(--border-default)" }}>Disconnect</button>
    </>
  ) : (
    <button onClick={handleConnectGmail} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-all hover:bg-cyan-900/20 active:bg-cyan-900/30"
      style={{ color: "var(--accent-cyan)", border: "1px solid var(--border-default)" }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
      </svg>
      <span className="hidden sm:inline">Connect Gmail</span>
      <span className="sm:hidden">Gmail</span>
    </button>
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-3 sm:px-5 py-2 sm:py-2.5 border-b shrink-0" style={{ borderColor: "var(--border-default)" }}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>FireFlies</span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>→</span>
          <span className="text-sm font-bold" style={{ color: "var(--accent-cyan)" }}>Email</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">{gmailButton}</div>
      </header>

      {/* ── Desktop: 3-column (lg+) ── */}
      <main className="hidden lg:flex flex-1 min-h-0 overflow-hidden pb-10">
        <div className="w-[280px] min-w-[280px] border-r flex flex-col shrink-0" style={{ borderColor: "var(--border-default)", background: "var(--bg-primary)" }}>
          {controlsPanel}
        </div>
        <div className="w-[280px] min-w-[280px] border-r flex flex-col overflow-hidden shrink-0" style={{ borderColor: "var(--border-default)" }}>
          {recordingsPanel}
        </div>
        <div className="flex-1 flex flex-col overflow-hidden">
          {emailPanel}
        </div>
      </main>

      {/* ── Tablet: 2-column (md to lg) ── */}
      <main className="hidden md:flex lg:hidden flex-1 min-h-0 overflow-hidden">
        <div className="w-[320px] min-w-[320px] border-r flex flex-col shrink-0" style={{ borderColor: "var(--border-default)", background: "var(--bg-primary)" }}>
          {/* Top: controls (scrollable) */}
          <div className="flex-[4] min-h-0 border-b overflow-hidden" style={{ borderColor: "var(--border-default)" }}>
            {controlsPanel}
          </div>
          {/* Bottom: recordings */}
          <div className="flex-[6] min-h-0 overflow-hidden">
            {recordingsPanel}
          </div>
        </div>
        <div className="flex-1 flex flex-col overflow-hidden">
          {emailPanel}
        </div>
      </main>

      {/* ── Mobile: single column + tab bar (<md) ── */}
      <div className="flex md:hidden flex-1 min-h-0 overflow-hidden flex-col">
        <div className="flex-1 min-h-0 overflow-hidden">
          {mobileTab === "controls" && (
            <div className="h-full overflow-hidden" style={{ background: "var(--bg-primary)" }}>
              {controlsPanel}
            </div>
          )}
          {mobileTab === "recordings" && (
            <div className="h-full overflow-hidden">
              {recordingsPanel}
            </div>
          )}
          {mobileTab === "email" && (
            <div className="h-full overflow-hidden">
              {emailPanel}
            </div>
          )}
        </div>

        {/* Mobile tab bar */}
        <div className="mobile-tab-bar shrink-0 flex border-t" style={{ borderColor: "var(--border-default)", background: "var(--bg-primary)" }}>
          {([
            { id: "controls" as MobileTab, label: "Controls", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/></svg> },
            { id: "recordings" as MobileTab, label: "Recordings", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg> },
            { id: "email" as MobileTab, label: "Email", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> },
          ]).map((tab) => (
            <button key={tab.id} onClick={() => setMobileTab(tab.id)}
              className="flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-colors relative"
              style={{ color: mobileTab === tab.id ? "var(--accent-cyan)" : "var(--text-muted)" }}>
              {tab.icon}
              <span className="text-[9px] font-medium">{tab.label}</span>
              {tab.id === "email" && generatedEmail && !generating && (
                <span className="absolute top-1.5 right-[calc(50%-14px)] w-1.5 h-1.5 rounded-full bg-cyan-400" />
              )}
            </button>
          ))}
        </div>
      </div>
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
      className="flex-1 rounded-lg px-3 py-1.5 text-left transition-all border"
      style={{
        background: active ? "rgba(6,182,212,0.1)" : "var(--bg-input)",
        borderColor: active ? "var(--accent-cyan)" : "var(--border-default)",
        color: active ? "var(--accent-cyan)" : "var(--text-secondary)",
      }}
    >
      <div className="text-xs font-semibold">{label}</div>
      {sublabel && (
        <div className="text-[10px]" style={{ color: active ? "var(--accent-cyan)" : "var(--text-muted)" }}>
          {sublabel}
        </div>
      )}
    </button>
  );
}
