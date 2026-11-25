import React from "react";

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-[#17261f] dark:text-[#f0f6f3]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

interface MarkdownSection {
  heading: string | null;
  blocks: Array<{ type: "list"; items: string[] } | { type: "paragraph"; text: string }>;
}

function parseMarkdownSections(content: string): MarkdownSection[] {
  const lines = content.split("\n");
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection = { heading: null, blocks: [] };

  const flushList = (listItems: string[]) => {
    if (listItems.length > 0) {
      current.blocks.push({ type: "list", items: [...listItems] });
      listItems.length = 0;
    }
  };

  const listItems: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^#{1,3}\s+/.test(line)) {
      flushList(listItems);
      if (current.heading !== null || current.blocks.length > 0) {
        sections.push(current);
      }
      current = {
        heading: line.replace(/^#{1,3}\s+/, "").trim(),
        blocks: [],
      };
    } else if (/^[-*•]\s+/.test(line)) {
      listItems.push(line.replace(/^[-*•]\s+/, "").trim());
    } else if (line === "") {
      flushList(listItems);
    } else {
      flushList(listItems);
      current.blocks.push({ type: "paragraph", text: line });
    }
  }

  flushList(listItems);
  if (current.heading !== null || current.blocks.length > 0) {
    sections.push(current);
  }

  return sections;
}

interface MarkdownRendererProps {
  content: string;
  structuredGrid?: boolean;
}

export function MarkdownRenderer({ content, structuredGrid = false }: MarkdownRendererProps) {
  const sections = parseMarkdownSections(content);

  if (structuredGrid && sections.some((s) => s.heading)) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
        {sections.map((section, idx) => {
          const isWarning = section.heading?.toLowerCase().includes("warning");
          return (
            <div
              key={idx}
              className={`pt-5 border-t ${
                isWarning
                  ? "border-[#d63b3b]/30 dark:border-[#f88383]/25 md:col-span-2"
                  : "border-[#dbe5df] dark:border-[#28382f]"
              }`}
            >
              {section.heading && (
                <h3
                  className={`text-base font-semibold tracking-tight mb-2.5 ${
                    isWarning
                      ? "text-[#a32222] dark:text-[#f88383]"
                      : "text-[#17261f] dark:text-[#eef5f1]"
                  }`}
                >
                  {section.heading}
                </h3>
              )}
              <div className="space-y-2.5 text-[15px] leading-relaxed text-[#2c3e35] dark:text-[#c7d6ce]">
                {section.blocks.map((block, bIdx) =>
                  block.type === "list" ? (
                    <ul key={bIdx} className="space-y-2 list-disc pl-5 marker:text-[#1f7a5a] dark:marker:text-[#4cc596]">
                      {block.items.map((item, iIdx) => (
                        <li key={iIdx}>{renderInline(item)}</li>
                      ))}
                    </ul>
                  ) : (
                    <p key={bIdx}>{renderInline(block.text)}</p>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-[#2c3e35] dark:text-[#c7d6ce]">
      {sections.map((section, idx) => (
        <div key={idx} className="space-y-2">
          {section.heading && (
            <h4 className="text-sm font-semibold text-[#17261f] dark:text-[#eef5f1] pt-1">
              {section.heading}
            </h4>
          )}
          {section.blocks.map((block, bIdx) =>
            block.type === "list" ? (
              <ul key={bIdx} className="space-y-1.5 list-disc pl-5 marker:text-[#1f7a5a] dark:marker:text-[#4cc596]">
                {block.items.map((item, iIdx) => (
                  <li key={iIdx}>{renderInline(item)}</li>
                ))}
              </ul>
            ) : (
              <p key={bIdx}>{renderInline(block.text)}</p>
            )
          )}
        </div>
      ))}
    </div>
  );
}
