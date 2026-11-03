"use client";

interface ConfirmSubmitButtonProps {
  confirmMessage: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * A submit button that asks for confirmation before submitting its form.
 * If the user cancels, the submission is prevented.
 */
export default function ConfirmSubmitButton({
  confirmMessage,
  className,
  children,
}: ConfirmSubmitButtonProps) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) {
          e.preventDefault();
        }
      }}
    >
      {children}
    </button>
  );
}
