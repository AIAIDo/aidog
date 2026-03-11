import React from 'react';

export default function Pagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  const pages = [];
  const maxVisible = 5;
  let start = Math.max(1, page - Math.floor(maxVisible / 2));
  let end = Math.min(totalPages, start + maxVisible - 1);
  if (end - start < maxVisible - 1) {
    start = Math.max(1, end - maxVisible + 1);
  }

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  return (
    <div className="flex items-center justify-center gap-1 mt-4">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="px-2 py-1 text-xs rounded text-slate-400 hover:text-slate-200 hover:bg-surface-700 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        &laquo;
      </button>
      {start > 1 && (
        <>
          <button
            onClick={() => onPageChange(1)}
            className="px-2 py-1 text-xs rounded text-slate-400 hover:text-slate-200 hover:bg-surface-700"
          >
            1
          </button>
          {start > 2 && <span className="text-xs text-slate-600 px-1">...</span>}
        </>
      )}
      {pages.map((p) => (
        <button
          key={p}
          onClick={() => onPageChange(p)}
          className={`px-2 py-1 text-xs rounded ${
            p === page
              ? 'bg-primary-500/20 text-primary-400 font-medium'
              : 'text-slate-400 hover:text-slate-200 hover:bg-surface-700'
          }`}
        >
          {p}
        </button>
      ))}
      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span className="text-xs text-slate-600 px-1">...</span>}
          <button
            onClick={() => onPageChange(totalPages)}
            className="px-2 py-1 text-xs rounded text-slate-400 hover:text-slate-200 hover:bg-surface-700"
          >
            {totalPages}
          </button>
        </>
      )}
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="px-2 py-1 text-xs rounded text-slate-400 hover:text-slate-200 hover:bg-surface-700 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        &raquo;
      </button>
    </div>
  );
}
