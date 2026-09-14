import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { prepareMarkdown } from '@/lib/prepareMarkdown';
import { cn } from '@/lib/utils';

const components: Components = {
  h1: ({ children }) => (
    <h2 className="mt-5 mb-2 text-[1.05rem] font-extrabold tracking-tight text-slate-900 dark:text-white first:mt-0">
      {children}
    </h2>
  ),
  h2: ({ children }) => (
    <h3 className="mt-5 mb-2 text-[0.95rem] font-bold text-slate-900 dark:text-white first:mt-0">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-4 mb-1.5 text-[0.88rem] font-semibold text-slate-800 dark:text-slate-100 first:mt-0">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="my-2 text-[0.86rem] leading-relaxed text-slate-700 dark:text-slate-300 first:mt-0 last:mb-0">
      {children}
    </p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-slate-900 dark:text-white">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => (
    <ul className="my-2 ml-4 list-disc space-y-1 text-[0.86rem] leading-relaxed text-slate-700 dark:text-slate-300">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 ml-4 list-decimal space-y-1 text-[0.86rem] leading-relaxed text-slate-700 dark:text-slate-300">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium text-indigo-600 dark:text-indigo-400 underline-offset-2 hover:underline"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-indigo-200 dark:border-indigo-500/30 pl-3 text-[0.86rem] text-slate-600 dark:text-slate-400">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-white/[0.08]">
      <table className="w-full min-w-[36rem] border-collapse text-left">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-slate-50 dark:bg-white/[0.04]">{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-t border-slate-200 dark:border-white/[0.06] first:border-t-0">
      {children}
    </tr>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 text-[0.72rem] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 text-[0.82rem] leading-snug text-slate-700 dark:text-slate-300 align-top">
      {children}
    </td>
  ),
  code: ({ className, children }) => {
    const block = Boolean(className);
    if (block) {
      return (
        <code className="block overflow-x-auto rounded-lg bg-slate-50 dark:bg-white/[0.04] px-3 py-2 font-mono text-[0.75rem] text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
          {children}
        </code>
      );
    }
    return (
      <code className="rounded-md bg-slate-100 dark:bg-white/[0.08] px-1 py-0.5 font-mono text-[0.78rem] text-slate-800 dark:text-slate-200">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="my-2 overflow-x-auto">{children}</pre>,
  hr: () => <hr className="my-4 border-slate-200 dark:border-white/[0.08]" />,
};

export function Markdown({ text, className }: { text: string; className?: string }) {
  const source = prepareMarkdown(text);
  if (!source) return null;
  return (
    <div className={cn('min-w-0', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
