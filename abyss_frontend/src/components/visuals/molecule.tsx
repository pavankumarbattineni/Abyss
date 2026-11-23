"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { TriangleAlert } from "lucide-react";

import type { MoleculeData } from "@/lib/visuals/schemas";

type SmilesModule = typeof import("smiles-drawer").default;

// smiles-drawer (MIT) is large: fetched the first time a molecule is shown.
let smilesPromise: Promise<SmilesModule> | null = null;
function loadSmiles(): Promise<SmilesModule> {
  smilesPromise ??= import("smiles-drawer").then((mod) => mod.default);
  return smilesPromise;
}

const SIZE = { width: 280, height: 220 };

// A lone heavy atom ("O", "C", "N") would be drawn as one huge label (OH2):
// writing its hydrogens out shows the bonds instead.
const VALENCE: Record<string, number> = { B: 3, C: 4, N: 3, O: 2, P: 3, S: 2, F: 1, Cl: 1, Br: 1, I: 1 };
function withExplicitHydrogens(smiles: string): string {
  const atom = smiles.trim();
  const k = VALENCE[atom];
  if (!k) return smiles;
  return k === 1 ? `[H]${atom}` : `[H]${atom}${"([H])".repeat(k - 2)}[H]`;
}

function Structure({ smiles, name, caption, dark }: { smiles: string; name?: string; caption?: string; dark: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadSmiles()
      .then((SmilesDrawer) => {
        if (cancelled || !ref.current) return;
        const drawer = new SmilesDrawer.SvgDrawer({
          width: SIZE.width,
          height: SIZE.height,
          bondThickness: 1.1,
          fontSizeLarge: 7,
          fontSizeSmall: 5,
          padding: 16,
          compactDrawing: false,
          // Only the lone-atom molecules below carry hydrogens to show.
          explicitHydrogens: withExplicitHydrogens(smiles) !== smiles,
        });
        SmilesDrawer.parse(
          withExplicitHydrogens(smiles),
          (tree) => {
            if (cancelled || !ref.current) return;
            ref.current.innerHTML = "";
            drawer.draw(tree, ref.current, dark ? "dark" : "light");
            // The drawer fixes a pixel size; let the column decide instead.
            ref.current.removeAttribute("width");
            ref.current.removeAttribute("height");
            ref.current.style.width = "100%";
            ref.current.style.height = "auto";
            ref.current.style.background = "transparent";
            setError(null);
          },
          () => !cancelled && setError("This structure's SMILES text isn't valid."),
        );
      })
      .catch(() => !cancelled && setError("The structure drawer couldn't load."));
    return () => {
      cancelled = true;
    };
  }, [smiles, dark]);

  return (
    <figure className="flex min-w-0 flex-col items-center gap-1.5">
      {error ? (
        <div role="alert" className="flex h-40 w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-border text-center text-xs text-muted-foreground">
          <TriangleAlert className="size-4 text-destructive" />
          {error}
          <code className="max-w-full truncate px-2 font-mono">{smiles}</code>
        </div>
      ) : (
        <svg ref={ref} role="img" aria-label={name ? `Structure of ${name}` : `Structure ${smiles}`} viewBox={`0 0 ${SIZE.width} ${SIZE.height}`} className="block w-full max-w-[300px]" />
      )}
      {(name || caption) && (
        <figcaption className="text-center text-[13px] leading-snug">
          {name && <span className="block font-semibold text-foreground">{name}</span>}
          {caption && <span className="block text-muted-foreground">{caption}</span>}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * 2-D chemical structures drawn from SMILES (e.g. "CCO" ethanol, "c1ccccc1"
 * benzene) by smiles-drawer: skeletal formulas with heteroatoms labelled, in
 * the app's light or dark theme. Several molecules sit side by side.
 */
export function MoleculeVisual({ data }: { data: MoleculeData }) {
  const { resolvedTheme } = useTheme();
  // The theme provider's answer; before it resolves, the page's own class.
  const dark = resolvedTheme ? resolvedTheme === "dark" : typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const many = data.molecules.length > 1;
  return (
    <div className={many ? "grid grid-cols-1 gap-4 @container sm:grid-cols-2" : "flex justify-center"}>
      {data.molecules.map((m, i) => (
        <Structure key={`${m.smiles}-${i}`} smiles={m.smiles} name={m.name} caption={m.caption} dark={dark} />
      ))}
    </div>
  );
}
