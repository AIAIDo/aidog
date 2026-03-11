import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Pagination from './Pagination.jsx';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';

function formatTokens(n) {
  if (n == null) return '-';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(typeof ts === 'number' ? ts : Date.parse(ts));
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Recursively highlight search matches within React children */
function highlightText(children, searchTerm) {
  if (!searchTerm) return children;
  return React.Children.map(children, child => {
    if (typeof child === 'string') {
      const regex = new RegExp(`(${escapeRegExp(searchTerm)})`, 'gi');
      const parts = child.split(regex);
      if (parts.length === 1) return child;
      return parts.map((part, i) =>
        regex.test(part)
          ? <mark key={i} className="bg-yellow-500/40 text-yellow-200 rounded-sm px-0.5">{part}</mark>
          : part
      );
    }
    if (React.isValidElement(child) && child.props.children) {
      return React.cloneElement(child, {}, highlightText(child.props.children, searchTerm));
    }
    return child;
  });
}

/** Wrapper component that highlights search matches in its children */
function HighlightedText({ text, searchTerm }) {
  if (!searchTerm || !text) return text;
  const regex = new RegExp(`(${escapeRegExp(searchTerm)})`, 'gi');
  const parts = text.split(regex);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    regex.test(part)
      ? <mark key={i} className="bg-yellow-500/40 text-yellow-200 rounded-sm px-0.5">{part}</mark>
      : part
  );
}

const ROLE_COLORS = {
  user: 'text-blue-400',
  assistant: 'text-green-400',
  system: 'text-yellow-400',
  tool: 'text-purple-400',
};

const ROLE_BG = {
  user: 'bg-blue-500/5 border-blue-500/20',
  assistant: 'bg-green-500/5 border-green-500/20',
  system: 'bg-yellow-500/5 border-yellow-500/20',
  tool: 'bg-purple-500/5 border-purple-500/20',
};

function formatDateTime(ts) {
  if (!ts) return '-';
  const d = new Date(typeof ts === 'number' ? ts : Date.parse(ts));
  return d.toLocaleString([], {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatExactTokens(n) {
  if (n == null) return '-';
  return n.toLocaleString();
}

/** Render a single content block from Claude's content array */
function ContentBlock({ block, index }) {
  const { t } = useTranslation('sessions');

  if (typeof block === 'string') {
    return <pre className="whitespace-pre-wrap text-xs text-slate-300 font-mono">{block}</pre>;
  }

  if (block.type === 'text') {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-600 uppercase">Text</span>
        </div>
        <pre className="whitespace-pre-wrap text-xs text-slate-300 font-mono bg-surface-900/60 rounded p-3 max-h-80 overflow-y-auto">
          {block.text}
        </pre>
      </div>
    );
  }

  if (block.type === 'tool_use') {
    const inputStr = typeof block.input === 'string'
      ? block.input
      : JSON.stringify(block.input, null, 2);
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-primary-500 uppercase font-medium">{t('toolCall')}</span>
          <span className="font-mono text-xs text-primary-400">{block.name}</span>
          <span className="font-mono text-[10px] text-slate-600 truncate max-w-[180px]" title={block.id}>{block.id}</span>
        </div>
        <pre className="whitespace-pre-wrap text-xs text-slate-300 font-mono bg-surface-900/60 rounded p-3 max-h-60 overflow-y-auto">
          {inputStr}
        </pre>
      </div>
    );
  }

  if (block.type === 'tool_result') {
    const resultStr = typeof block.content === 'string'
      ? block.content
      : Array.isArray(block.content)
        ? block.content.map(c => c.text || JSON.stringify(c)).join('\n')
        : JSON.stringify(block.content, null, 2);
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] uppercase font-medium ${block.is_error ? 'text-red-400' : 'text-slate-500'}`}>
            {block.is_error ? t('toolResultError') : t('toolResult')}
          </span>
          <span className="font-mono text-[10px] text-slate-600 truncate max-w-[180px]" title={block.tool_use_id}>{block.tool_use_id}</span>
        </div>
        <pre className={`whitespace-pre-wrap text-xs font-mono rounded p-3 max-h-60 overflow-y-auto ${
          block.is_error ? 'bg-red-500/5 text-red-300' : 'bg-surface-900/60 text-slate-300'
        }`}>
          {resultStr}
        </pre>
      </div>
    );
  }

  if (block.type === 'image' && block.filePath) {
    return (
      <div className="space-y-1">
        <span className="text-[10px] text-slate-600 uppercase">Image</span>
        <img src={block.filePath} alt="User uploaded" className="max-w-md max-h-60 rounded border border-slate-700" />
      </div>
    );
  }

  // Fallback for unknown block types
  return (
    <pre className="whitespace-pre-wrap text-xs text-slate-500 font-mono bg-surface-900/60 rounded p-3 max-h-40 overflow-y-auto">
      {JSON.stringify(block, null, 2)}
    </pre>
  );
}

function MessageDetail({ msg }) {
  const { t } = useTranslation('sessions');
  const toolCalls = Array.isArray(msg.toolCalls) ? msg.toolCalls : [];
  const totalTokens = (msg.inputTokens || 0) + (msg.outputTokens || 0);
  const totalCache = (msg.cacheRead || 0) + (msg.cacheWrite || 0);
  const roleBg = ROLE_BG[msg.role] || 'bg-surface-800/50 border-surface-600';

  // Lazy-load full content from API
  const [fullContent, setFullContent] = useState(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentExpanded, setContentExpanded] = useState(false);

  const loadContent = useCallback(async () => {
    if (fullContent !== null || contentLoading) return;
    setContentLoading(true);
    try {
      const res = await fetch(`/api/sessions/messages/${encodeURIComponent(msg.id)}`);
      if (res.ok) {
        const data = await res.json();
        setFullContent(data.content);
      } else {
        setFullContent(null);
      }
    } catch {
      setFullContent(null);
    } finally {
      setContentLoading(false);
    }
  }, [msg.id, fullContent, contentLoading]);

  const handleToggleContent = () => {
    if (!contentExpanded && fullContent === null) {
      loadContent();
    }
    setContentExpanded(v => !v);
  };

  // Parse content for display
  const contentBlocks = useMemo(() => {
    if (!fullContent) return [];
    if (Array.isArray(fullContent)) return fullContent;
    if (typeof fullContent === 'string') return [fullContent];
    return [fullContent];
  }, [fullContent]);

  return (
    <div className={`col-span-12 rounded-lg border p-4 space-y-4 ${roleBg}`}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className={`text-sm font-semibold ${ROLE_COLORS[msg.role] || 'text-slate-400'}`}>
          {(msg.role || 'unknown').toUpperCase()}
        </span>
        <span className="text-xs font-mono text-slate-500">{msg.model || '-'}</span>
        <span className="ml-auto text-xs text-slate-500">{formatDateTime(msg.timestamp)}</span>
      </div>

      {/* Content - lazy loaded */}
      <div>
        <button
          onClick={handleToggleContent}
          className="text-xs text-primary-500 hover:text-primary-400 transition-colors mb-2"
        >
          {contentExpanded ? t('messages.hideContent') : t('messages.viewContent')}
        </button>

        {contentExpanded && (
          <div className="space-y-3">
            {contentLoading && (
              <div className="text-xs text-slate-500 py-2">{t('messages.loadingContent')}</div>
            )}
            {!contentLoading && contentBlocks.length === 0 && (
              <div className="text-xs text-slate-600 py-2">{t('messages.noContent')}</div>
            )}
            {!contentLoading && contentBlocks.map((block, i) => (
              <ContentBlock key={i} block={block} index={i} />
            ))}
          </div>
        )}
      </div>

      {/* Token breakdown */}
      <div>
        <h6 className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">{t('tokenUsage')}</h6>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          <div className="bg-surface-900/60 rounded px-3 py-2">
            <div className="text-[10px] text-slate-600 mb-0.5">{t('tokenLabels.input')}</div>
            <div className="text-sm font-mono text-amber-400">{formatExactTokens(msg.inputTokens)}</div>
          </div>
          <div className="bg-surface-900/60 rounded px-3 py-2">
            <div className="text-[10px] text-slate-600 mb-0.5">{t('tokenLabels.output')}</div>
            <div className="text-sm font-mono text-orange-400">{formatExactTokens(msg.outputTokens)}</div>
          </div>
          <div className="bg-surface-900/60 rounded px-3 py-2">
            <div className="text-[10px] text-slate-600 mb-0.5">{t('tokenLabels.total')}</div>
            <div className="text-sm font-mono text-slate-300">{formatExactTokens(totalTokens)}</div>
          </div>
          <div className="bg-surface-900/60 rounded px-3 py-2">
            <div className="text-[10px] text-slate-600 mb-0.5">{t('tokenLabels.cacheRead')}</div>
            <div className="text-sm font-mono text-cyan-400">{formatExactTokens(msg.cacheRead)}</div>
          </div>
          <div className="bg-surface-900/60 rounded px-3 py-2">
            <div className="text-[10px] text-slate-600 mb-0.5">{t('tokenLabels.cacheWrite')}</div>
            <div className="text-sm font-mono text-teal-400">{formatExactTokens(msg.cacheWrite)}</div>
          </div>
          <div className="bg-surface-900/60 rounded px-3 py-2">
            <div className="text-[10px] text-slate-600 mb-0.5">{t('tokenLabels.cacheTotal')}</div>
            <div className="text-sm font-mono text-slate-400">{formatExactTokens(totalCache)}</div>
          </div>
        </div>
      </div>

      {/* Tool Calls */}
      {toolCalls.length > 0 && (
        <div>
          <h6 className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
            {t('toolCalls', { count: toolCalls.length })}
          </h6>
          <div className="space-y-1.5">
            {toolCalls.map((tc, i) => (
              <div
                key={i}
                className="flex items-center gap-3 bg-surface-900/60 rounded px-3 py-2 text-xs border border-surface-700"
              >
                <span className="font-mono text-slate-600 w-5">#{i + 1}</span>
                <span className={`font-mono font-medium ${
                  tc.type === 'tool_use' ? 'text-primary-400' : 'text-slate-400'
                }`}>
                  {tc.name || 'unknown'}
                </span>
                <span className="text-[10px] text-slate-600 px-1.5 py-0.5 rounded bg-surface-800">
                  {tc.type === 'tool_use' ? 'call' : tc.type === 'tool_result' ? 'result' : tc.type}
                </span>
                {tc.inputSize > 0 && (
                  <span className="text-slate-500">
                    {t('units.in')}: <span className="font-mono text-slate-400">{formatExactTokens(tc.inputSize)} {t('units.chars')}</span>
                  </span>
                )}
                {tc.outputSize > 0 && (
                  <span className="text-slate-500">
                    {t('units.out')}: <span className="font-mono text-slate-400">{formatExactTokens(tc.outputSize)} {t('units.chars')}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div>
        <h6 className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">{t('metadata')}</h6>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-slate-600">{t('metadataLabels.messageId')}</span>
            <span className="font-mono text-slate-400 truncate ml-2 max-w-[200px]" title={msg.id}>{msg.id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">{t('metadataLabels.agent')}</span>
            <span className="text-slate-400">{msg.agent}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">{t('metadataLabels.project')}</span>
            <span className="font-mono text-slate-400 truncate ml-2 max-w-[200px]" title={msg.projectName}>{msg.projectName || '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">{t('metadataLabels.contentLength')}</span>
            <span className="font-mono text-slate-400">{formatExactTokens(msg.contentLength)} {t('units.chars')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">{t('metadataLabels.date')}</span>
            <span className="text-slate-400">{msg.date}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Markdown renderer with syntax highlighting and search term highlighting */
function MarkdownContent({ text, searchTerm }) {
  const hl = (children) => searchTerm ? highlightText(children, searchTerm) : children;
  return (
    <ReactMarkdown
      rehypePlugins={[rehypeHighlight]}
      components={{
        p: ({ children }) => <p className="text-sm text-slate-200 leading-relaxed mb-2 last:mb-0">{hl(children)}</p>,
        h1: ({ children }) => <h1 className="text-base font-semibold text-slate-100 mb-2 mt-3">{hl(children)}</h1>,
        h2: ({ children }) => <h2 className="text-sm font-semibold text-slate-100 mb-2 mt-3">{hl(children)}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-medium text-slate-200 mb-1 mt-2">{hl(children)}</h3>,
        ul: ({ children }) => <ul className="list-disc list-inside text-sm text-slate-200 space-y-0.5 pl-2 mb-2">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-inside text-sm text-slate-200 space-y-0.5 pl-2 mb-2">{children}</ol>,
        li: ({ children }) => <li className="text-sm text-slate-200">{hl(children)}</li>,
        blockquote: ({ children }) => <blockquote className="border-l-2 border-surface-600 pl-3 text-sm text-slate-400 italic my-2">{hl(children)}</blockquote>,
        code: ({ inline, children, className }) => {
          if (inline) {
            return <code className="bg-surface-700 text-amber-300 font-mono px-1 rounded text-xs">{hl(children)}</code>;
          }
          return <code className={className}>{children}</code>;
        },
        pre: ({ children }) => <pre className="bg-surface-950 rounded-lg p-4 overflow-x-auto text-xs font-mono mb-2 border border-surface-700">{children}</pre>,
        a: ({ href, children }) => <a href={href} className="text-primary-400 hover:text-primary-300 underline" target="_blank" rel="noopener noreferrer">{hl(children)}</a>,
        strong: ({ children }) => <strong className="font-semibold text-slate-100">{hl(children)}</strong>,
        em: ({ children }) => <em className="italic text-slate-300">{hl(children)}</em>,
        hr: () => <hr className="border-surface-700 my-3" />,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

/** Collapsible tool call card */
function ToolCallCard({ block, tc }) {
  const [expanded, setExpanded] = useState(false);
  const name = block ? block.name : (tc ? tc.name : 'unknown');

  let inputPreview = null;
  if (block && block.input) {
    const inputStr = typeof block.input === 'string'
      ? block.input
      : JSON.stringify(block.input, null, 2);
    const lines = inputStr.split('\n');
    const maxLines = 20;
    inputPreview = lines.slice(0, maxLines).join('\n');
    if (lines.length > maxLines) {
      inputPreview += `\n... ${lines.length - maxLines} more lines`;
    }
  }

  const canExpand = !!inputPreview;

  return (
    <div className="border border-surface-700 rounded-lg overflow-hidden mb-2">
      <div
        className={`flex items-center gap-2 px-3 py-2 text-xs ${canExpand ? 'cursor-pointer hover:bg-surface-800' : ''} transition-colors`}
        onClick={() => canExpand && setExpanded(v => !v)}
      >
        <span className="text-[9px] text-slate-500 w-3">{canExpand ? (expanded ? '▼' : '▶') : '·'}</span>
        <span className="font-mono font-medium text-primary-400">{name}</span>
        {block && <span className="text-[10px] text-slate-600">(1 call)</span>}
        {tc && tc.type && (
          <span className="text-[10px] text-slate-600">({tc.type === 'tool_use' ? 'call' : tc.type})</span>
        )}
        {tc && tc.success === false && (
          <span className="text-[10px] text-red-400 ml-auto">failed</span>
        )}
      </div>
      {expanded && inputPreview && (
        <div className="border-t border-surface-700 bg-surface-950 px-3 py-2">
          <pre className="text-[10px] font-mono text-slate-300 whitespace-pre-wrap overflow-x-auto max-h-48 overflow-y-auto">{inputPreview}</pre>
        </div>
      )}
    </div>
  );
}

/** Claude.ai-style chat message */
function ChatMessage({ msg, searchTerm }) {
  const { t } = useTranslation('sessions');
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';
  const isAssistant = msg.role === 'assistant';
  const ref = useRef(null);

  const [fullContent, setFullContent] = useState(null);
  const [contentLoading, setContentLoading] = useState(true);

  useEffect(() => {
    if (!msg.id) {
      setContentLoading(false);
      return;
    }
    let cancelled = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        observer.disconnect();
        fetch(`/api/sessions/messages/${encodeURIComponent(msg.id)}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => { if (!cancelled && data) setFullContent(data.content); })
          .catch(() => {})
          .finally(() => { if (!cancelled) setContentLoading(false); });
      }
    });
    if (ref.current) observer.observe(ref.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, [msg.id]);

  const { textBlocks, imageBlocks, toolUseBlocks } = useMemo(() => {
    if (!fullContent) return { textBlocks: [], imageBlocks: [], toolUseBlocks: [] };
    const blocks = Array.isArray(fullContent) ? fullContent : [fullContent];
    return {
      textBlocks: blocks.filter(b => b && (typeof b === 'string' || b.type === 'text'))
        .filter((b, i, arr) => {
          const text = typeof b === 'string' ? b : b.text;
          return arr.findIndex(x => (typeof x === 'string' ? x : x.text) === text) === i;
        }),
      imageBlocks: blocks.filter(b => b && b.type === 'image' && b.filePath),
      toolUseBlocks: blocks.filter(b => b && b.type === 'tool_use'),
    };
  }, [fullContent]);

  const toolCallsSummary = Array.isArray(msg.toolCalls) ? msg.toolCalls : [];

  const hasTokens = msg.inputTokens > 0 || msg.outputTokens > 0 || msg.cacheRead > 0 || msg.cacheWrite > 0;
  const tokenFooter = hasTokens && (
    <div className="flex gap-3 flex-wrap text-[10px] mt-3">
      {msg.inputTokens > 0 && <span className="text-amber-400/70">{formatTokens(msg.inputTokens)} {t('units.in')}</span>}
      {msg.outputTokens > 0 && <span className="text-orange-400/70">{formatTokens(msg.outputTokens)} {t('units.out')}</span>}
      {msg.cacheRead > 0 && <span className="text-cyan-400/50">{formatTokens(msg.cacheRead)} cache read</span>}
      {msg.cacheWrite > 0 && <span className="text-teal-400/50">{formatTokens(msg.cacheWrite)} cache write</span>}
    </div>
  );

  // System message: centered badge
  if (isSystem) {
    return (
      <div ref={ref} className="py-2 flex justify-center border-b border-surface-800/60">
        <div className="text-[10px] text-slate-500 bg-surface-800/50 border border-surface-700 rounded px-3 py-1">
          SYSTEM · {formatTime(msg.timestamp)}
          {hasTokens && (
            <span className="ml-2 text-slate-600">
              {msg.inputTokens > 0 && `${formatTokens(msg.inputTokens)} in`}
              {msg.outputTokens > 0 && ` · ${formatTokens(msg.outputTokens)} out`}
            </span>
          )}
        </div>
      </div>
    );
  }

  // User message: right-aligned bubble
  if (isUser) {
    return (
      <div ref={ref} className="py-4 flex flex-col items-end border-b border-surface-800/60">
        <div className="max-w-[80%] bg-surface-800 border border-surface-700 rounded-2xl px-4 py-3">
          {contentLoading ? (
            <div className="text-xs text-slate-600 animate-pulse">...</div>
          ) : (textBlocks.length > 0 || imageBlocks.length > 0) ? (
            <div className="text-sm text-slate-200 space-y-2">
              {textBlocks.map((b, i) => (
                <div key={`t${i}`} className="whitespace-pre-wrap"><HighlightedText text={typeof b === 'string' ? b : b.text} searchTerm={searchTerm} /></div>
              ))}
              {imageBlocks.map((b, i) => (
                <img key={`img${i}`} src={b.filePath} alt="User uploaded" className="max-w-sm max-h-48 rounded border border-slate-700" />
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-600">{t('messages.noContent')}</div>
          )}
          {msg.inputTokens > 0 && (
            <div className="mt-2 text-[10px] text-slate-600 text-right">
              {formatTokens(msg.inputTokens)} {t('units.in')}
            </div>
          )}
        </div>
        <span className="mt-1 text-[10px] text-slate-600 font-mono">{formatTime(msg.timestamp)}</span>
      </div>
    );
  }

  // Assistant (and other roles): full-width Claude.ai style
  const avatarBg = isAssistant ? 'bg-green-500/20 text-green-400' : 'bg-purple-500/20 text-purple-400';
  const avatarLabel = isAssistant ? 'A' : (msg.role?.[0] || '?').toUpperCase();
  const roleColor = ROLE_COLORS[msg.role] || 'text-slate-400';

  return (
    <div ref={ref} className="py-4 border-b border-surface-800/60">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 ${avatarBg}`}>
          {avatarLabel}
        </span>
        <span className={`text-[11px] font-semibold uppercase ${roleColor}`}>{msg.role || 'unknown'}</span>
        {msg.model && (
          <span className="font-mono text-slate-500 text-[10px] truncate max-w-[200px]" title={msg.model}>· {msg.model}</span>
        )}
        <span className="ml-auto font-mono text-slate-600 text-[10px]">{formatTime(msg.timestamp)}</span>
      </div>

      {/* Content */}
      <div className="pl-7">
        {contentLoading && (
          <div className="text-xs text-slate-600 animate-pulse mb-2">Loading...</div>
        )}
        {!contentLoading && textBlocks.length === 0 && toolUseBlocks.length === 0 && fullContent !== null && (
          <div className="text-xs text-slate-600 mb-2">{t('messages.noContent')}</div>
        )}
        {textBlocks.map((b, i) => (
          <MarkdownContent key={i} text={typeof b === 'string' ? b : b.text} searchTerm={searchTerm} />
        ))}

        {/* Tool calls: from fullContent if available, else summary */}
        {!contentLoading && toolUseBlocks.length > 0 && (
          <div className="mt-2">
            {toolUseBlocks.map((b, i) => (
              <ToolCallCard key={i} block={b} />
            ))}
          </div>
        )}
        {!contentLoading && toolUseBlocks.length === 0 && toolCallsSummary.length > 0 && (
          <div className="mt-2">
            {toolCallsSummary.map((tc, i) => (
              <ToolCallCard key={i} tc={tc} />
            ))}
          </div>
        )}

        {tokenFooter}
      </div>
    </div>
  );
}

/** Chat view: renders messages as Claude.ai-style conversation */
function ChatView({ messages, searchTerm }) {
  return (
    <div>
      {messages.map((msg, idx) => (
        <ChatMessage key={msg.id || idx} msg={msg} searchTerm={searchTerm} />
      ))}
    </div>
  );
}

function SortHeader({ label, sortKey, currentSort, onSort, className = '' }) {
  const active = currentSort.key === sortKey;
  const arrow = active ? (currentSort.dir === 'asc' ? ' \u25B2' : ' \u25BC') : '';
  return (
    <span
      className={`cursor-pointer select-none hover:text-slate-400 transition-colors ${active ? 'text-slate-300' : ''} ${className}`}
      onClick={() => onSort(sortKey)}
    >
      {label}{arrow}
    </span>
  );
}

export default function MessageList({ sessionId }) {
  const { t } = useTranslation('sessions');
  const [messages, setMessages] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'chat'

  const handleSort = useCallback((key) => {
    setSort(prev => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' }
    );
  }, []);

  const sortedMessages = useMemo(() => {
    if (!sort.key) return messages;
    const sorted = [...messages].sort((a, b) => {
      let va = a[sort.key], vb = b[sort.key];
      if (va == null) va = '';
      if (vb == null) vb = '';
      if (typeof va === 'number' && typeof vb === 'number') return va - vb;
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb);
      return String(va).localeCompare(String(vb));
    });
    return sort.dir === 'desc' ? sorted.reverse() : sorted;
  }, [messages, sort]);

  const fetchMessages = useCallback(async (page = 1, searchTerm = '') => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, pageSize: 20 });
      if (searchTerm) params.set('search', searchTerm);
      const res = await fetch(`/api/sessions/${sessionId}/messages?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setMessages(data.messages || []);
      setPagination(data.pagination || { page: 1, pageSize: 20, total: 0, totalPages: 0 });
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchMessages(1, '');
    setSearch('');
    setSearchInput('');
  }, [sessionId, fetchMessages]);

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput);
    fetchMessages(1, searchInput);
  };

  const handlePageChange = (page) => {
    fetchMessages(page, search);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h5 className="text-xs text-slate-500 uppercase tracking-wider">
            {t('messages.title')}
            {pagination.total > 0 && (
              <span className="text-slate-600 ml-1">({pagination.total})</span>
            )}
          </h5>
          <div className="flex rounded overflow-hidden border border-surface-600">
            <button
              onClick={() => setViewMode('list')}
              className={`text-[10px] px-2 py-0.5 transition-colors ${
                viewMode === 'list'
                  ? 'bg-primary-500/20 text-primary-400'
                  : 'text-slate-500 hover:text-slate-400'
              }`}
            >{t('messages.list')}</button>
            <button
              onClick={() => setViewMode('chat')}
              className={`text-[10px] px-2 py-0.5 transition-colors ${
                viewMode === 'chat'
                  ? 'bg-primary-500/20 text-primary-400'
                  : 'text-slate-500 hover:text-slate-400'
              }`}
            >{t('messages.chat')}</button>
          </div>
        </div>
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('messages.searchPlaceholder')}
            className="input-field text-xs w-48 py-1 px-2"
          />
          <button type="submit" className="btn-secondary text-xs py-1 px-2">
            {t('actions.search', { ns: 'common' })}
          </button>
        </form>
      </div>

      {loading && (
        <div className="text-xs text-slate-500 text-center py-4">{t('messages.loading')}</div>
      )}

      {!loading && messages.length === 0 && (
        <div className="text-xs text-slate-600 text-center py-4">{t('messages.noMessages')}</div>
      )}

      {!loading && messages.length > 0 && viewMode === 'list' && (
        <div className="space-y-1">
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 px-3 py-1 text-[10px] text-slate-600 uppercase tracking-wider">
            <span className="col-span-1">#</span>
            <SortHeader label={t('columns.role')} sortKey="role" currentSort={sort} onSort={handleSort} className="col-span-1" />
            <SortHeader label={t('columns.model')} sortKey="model" currentSort={sort} onSort={handleSort} className="col-span-2" />
            <SortHeader label={t('columns.input')} sortKey="inputTokens" currentSort={sort} onSort={handleSort} className="col-span-1 text-right" />
            <SortHeader label={t('columns.output')} sortKey="outputTokens" currentSort={sort} onSort={handleSort} className="col-span-1 text-right" />
            <SortHeader label={t('columns.cacheR')} sortKey="cacheRead" currentSort={sort} onSort={handleSort} className="col-span-1 text-right" />
            <SortHeader label={t('columns.cacheW')} sortKey="cacheWrite" currentSort={sort} onSort={handleSort} className="col-span-1 text-right" />
            <span className="col-span-3">{t('columns.tools')}</span>
            <SortHeader label={t('columns.time')} sortKey="timestamp" currentSort={sort} onSort={handleSort} className="col-span-1 text-right" />
          </div>

          {/* Rows */}
          {sortedMessages.map((msg, idx) => {
            const toolCalls = Array.isArray(msg.toolCalls) ? msg.toolCalls : [];
            const rowNum = (pagination.page - 1) * pagination.pageSize + idx + 1;
            const isExpanded = expandedId === (msg.id || idx);

            return (
              <React.Fragment key={msg.id || idx}>
                <div
                  onClick={() => setExpandedId(isExpanded ? null : (msg.id || idx))}
                  className={`grid grid-cols-12 gap-2 px-3 py-1.5 text-xs bg-surface-900 rounded border items-center cursor-pointer transition-colors ${
                    isExpanded
                      ? 'border-primary-500/40 bg-surface-800'
                      : 'border-surface-700 hover:border-surface-600'
                  }`}
                >
                  <span className="col-span-1 font-mono text-slate-600">{rowNum}</span>
                  <span className={`col-span-1 font-medium ${ROLE_COLORS[msg.role] || 'text-slate-400'}`}>
                    {msg.role || '-'}
                  </span>
                  <span className="col-span-2 font-mono text-slate-400 truncate" title={msg.model}>
                    {msg.model || '-'}
                  </span>
                  <span className="col-span-1 font-mono text-right text-amber-400">
                    {formatTokens(msg.inputTokens)}
                  </span>
                  <span className="col-span-1 font-mono text-right text-orange-400">
                    {formatTokens(msg.outputTokens)}
                  </span>
                  <span className="col-span-1 font-mono text-right text-slate-500">
                    {formatTokens(msg.cacheRead)}
                  </span>
                  <span className="col-span-1 font-mono text-right text-slate-500">
                    {formatTokens(msg.cacheWrite)}
                  </span>
                  <span className="col-span-3 flex flex-wrap gap-1 overflow-hidden">
                    {toolCalls.slice(0, 3).map((tc, j) => (
                      <span
                        key={j}
                        className={`inline-flex items-center px-1 py-0.5 rounded text-[10px] font-mono ${
                          tc.success !== false
                            ? 'bg-green-500/10 text-green-400'
                            : 'bg-red-500/10 text-red-400'
                        }`}
                      >
                        {tc.name || tc}
                      </span>
                    ))}
                    {toolCalls.length > 3 && (
                      <span className="text-[10px] text-slate-600">+{toolCalls.length - 3}</span>
                    )}
                  </span>
                  <span className="col-span-1 font-mono text-right text-slate-500">
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
                {isExpanded && <MessageDetail msg={msg} />}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {!loading && messages.length > 0 && viewMode === 'chat' && (
        <ChatView messages={sortedMessages} searchTerm={search} />
      )}

      <Pagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        onPageChange={handlePageChange}
      />
    </div>
  );
}
