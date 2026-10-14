interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-200"
    >
      <svg
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M8.257 3.099c.765-1.36 2.72-1.36 3.486 0l6.516 11.59c.75 1.334-.213 2.98-1.742 2.98H3.483c-1.53 0-2.492-1.646-1.743-2.98l6.517-11.59zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
          clipRule="evenodd"
        />
      </svg>
      <p className="flex-1">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="flex-shrink-0 text-red-300 hover:text-red-100"
        aria-label="Dismiss error"
      >
        ✕
      </button>
    </div>
  );
}
