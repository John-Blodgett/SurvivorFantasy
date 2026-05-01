"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

interface SubmitButtonProps {
  children: React.ReactNode;
  /** Text shown while the form is submitting. Falls back to children if omitted. */
  pendingText?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Drop-in replacement for `<button type="submit">` that shows a spinner
 * and disables itself while the parent `<form>` is submitting.
 *
 * Must be rendered inside a `<form>` that uses a server action or
 * `startTransition`-based submission.
 */
export default function SubmitButton({
  children,
  pendingText,
  className,
  disabled,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-disabled={disabled || pending}
      className={className}
    >
      {pending ? (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {pendingText ?? children}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
