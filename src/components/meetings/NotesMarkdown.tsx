import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";

/** Meeting notes as the model writes them: "## " sections and short bullets. No links,
 *  images or HTML: the notes are text about the meeting, nothing to click. */
const allowedElements = [
  "h1",
  "h2",
  "h3",
  "p",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "br",
];

const components: Components = {
  h1: ({ children }) => (
    <h3 className="mt-5 first:mt-0 mb-1.5 text-[15px] font-medium">
      {children}
    </h3>
  ),
  h2: ({ children }) => (
    <h3 className="mt-5 first:mt-0 mb-1.5 font-mono text-[10.5px] tracking-[0.1em] uppercase text-[color:var(--text-faint)]">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-3 mb-1 text-[14px] font-medium">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="my-1.5 text-[15px] leading-[1.55]">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-1 flex flex-col gap-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1 flex flex-col gap-1 list-decimal ps-5">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="relative ps-4 text-[15px] leading-[1.5] before:absolute before:start-0 before:top-[0.62em] before:h-[5px] before:w-[5px] before:rounded-full before:bg-accent/70">
      {children}
    </li>
  ),
  strong: ({ children }) => <strong className="font-medium">{children}</strong>,
};

export const NotesMarkdown: React.FC<{ markdown: string }> = ({ markdown }) => (
  <div className="select-text cursor-text">
    <ReactMarkdown
      allowedElements={allowedElements}
      unwrapDisallowed
      components={components}
      skipHtml
    >
      {markdown}
    </ReactMarkdown>
  </div>
);
