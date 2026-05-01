export default function PageLoading() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="flex flex-col items-center gap-3">
        <div
          className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary"
          role="status"
          aria-label="Loading page"
        />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    </div>
  );
}
