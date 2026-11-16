import type { HandwrittenData } from "@/lib/visuals/schemas";
import { cn } from "@/lib/utils";
import { handwriting } from "./fonts";
import { RoughBox, RoughUnderline } from "./rough";

/** One ruled line: text sits on the rules because every line is this tall. */
const RULE = 30;

/**
 * Study notes on a ruled notebook page: handwriting, a red margin, headings
 * underlined by hand, highlighter on the must-remember points, boxed
 * definitions and formulas, and a sticky-note recap. Paper stays paper in
 * dark mode (dimmed), the way a real page would look.
 */
export function HandwrittenVisual({ data }: { data: HandwrittenData }) {
  return (
    <div
      className={cn(
        handwriting.className,
        "relative overflow-hidden rounded-lg border border-[#e7dcc4] bg-[#fffdf5] text-[21px] text-[#2b2d42] shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:border-[#3a372f] dark:bg-[#262520] dark:text-[#e9e4d6]",
      )}
      style={{
        lineHeight: `${RULE}px`,
        backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${RULE - 1}px, var(--hw-rule) ${RULE - 1}px, var(--hw-rule) ${RULE}px)`,
        backgroundPosition: `0 ${RULE * 2 - 6}px`,
        ["--hw-rule" as string]: "rgba(80, 120, 180, 0.22)",
      }}
    >
      {/* Margin line */}
      <span aria-hidden="true" className="absolute inset-y-0 left-10 w-px bg-[#e4808a]/70 sm:left-14" />
      <div className="py-[18px] pr-4 pl-14 sm:pr-6 sm:pl-20">
        {data.title && (
          <div className="mb-1 w-fit">
            <p className="text-[30px] font-bold text-[#1d4e89] dark:text-[#9cc3f0]">{data.title}</p>
            <RoughUnderline seed={`title-${data.title}`} className="-mt-1 text-[#e4808a]" />
          </div>
        )}
        {data.sections.map((section, s) => (
          <section key={section.heading} className="mt-[30px]">
            <div className="w-fit">
              <p className="text-[25px] font-bold text-[#1d4e89] dark:text-[#9cc3f0]">
                {s + 1}. {section.heading}
              </p>
              <RoughUnderline seed={`h-${s}`} className="-mt-1 text-[#1d4e89]/50 dark:text-[#9cc3f0]/50" />
            </div>
            {section.notes.length > 0 && (
              <ul className="mt-1">
                {section.notes.map((note) => (
                  <li key={note} className="flex gap-2">
                    <span aria-hidden="true" className="text-[#e4808a]">
                      ~
                    </span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            )}
            {section.highlights.length > 0 && (
              <ul className="mt-1">
                {section.highlights.map((h) => (
                  <li key={h} className="flex gap-2">
                    <span aria-hidden="true">★</span>
                    <mark
                      className="rounded-[3px] bg-transparent px-0.5 text-inherit"
                      style={{ backgroundImage: "linear-gradient(104deg, transparent 2%, rgba(253, 224, 71, 0.75) 4%, rgba(253, 224, 71, 0.55) 96%, transparent 98%)" }}
                    >
                      {h}
                    </mark>
                  </li>
                ))}
              </ul>
            )}
            {section.definitions.length > 0 && (
              <div className="mt-2 space-y-2">
                {section.definitions.map((d, i) => (
                  <RoughBox key={d.term} seed={`def-${s}-${i}`} className="px-3.5 py-1 text-[#1f6f50] dark:text-[#8fd3b2]">
                    <p>
                      <span className="font-bold underline decoration-wavy decoration-1 underline-offset-4">{d.term}</span>
                      <span className="text-[#2b2d42] dark:text-[#e9e4d6]"> = {d.meaning}</span>
                    </p>
                  </RoughBox>
                ))}
              </div>
            )}
            {section.formula && (
              <RoughBox seed={`f-${s}`} className="mx-auto mt-2 w-fit px-5 py-1 text-center text-[24px] text-[#b42318] dark:text-[#f19a8f]">
                {section.formula}
              </RoughBox>
            )}
          </section>
        ))}
        {data.summary.length > 0 && (
          <div className="mt-[30px] -rotate-1 rounded-sm bg-[#fff3a3] px-4 py-2 text-[#3b3510] shadow-[2px_3px_0_rgba(0,0,0,0.08)] sm:ml-6 sm:max-w-md dark:bg-[#d9c95f]">
            <p className="font-bold">Recap ✎</p>
            <ul>
              {data.summary.map((line) => (
                <li key={line}>→ {line}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
