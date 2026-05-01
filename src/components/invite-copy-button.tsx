"use client";

import { useState } from "react";

export default function InviteCopyButton({ inviteCode }: { inviteCode: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const url = `${window.location.origin}/join/${inviteCode}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
    >
      {copied ? "Copied!" : "Copy Invite Link"}
    </button>
  );
}
