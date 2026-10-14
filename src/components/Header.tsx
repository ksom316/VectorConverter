interface HeaderProps {
  fileName: string;
  width: number;
  height: number;
  onNewFile: () => void;
}

export function Header({ fileName, width, height, onNewFile }: HeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-slate-800 bg-slate-950 px-5 py-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
        <span className="text-sm font-semibold tracking-tight text-slate-100">
          Vector Converter
        </span>
        <span className="min-w-0 truncate text-sm text-slate-500" title={fileName}>
          {fileName} · {width}×{height}px
        </span>
      </div>
      <button
        type="button"
        onClick={onNewFile}
        className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
      >
        New file
      </button>
    </header>
  );
}
