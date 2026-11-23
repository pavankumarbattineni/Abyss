/**
 * The 118 elements for the periodic-table visual: symbol, name, family, and
 * where each sits in the standard 18-column layout (lanthanides and actinides,
 * 57-71 and 89-103, in their own two rows below).
 */

export type ElementFamily =
  | "alkali-metal"
  | "alkaline-earth-metal"
  | "transition-metal"
  | "post-transition-metal"
  | "metalloid"
  | "nonmetal"
  | "halogen"
  | "noble-gas"
  | "lanthanide"
  | "actinide";

export interface ChemicalElement {
  number: number;
  symbol: string;
  name: string;
  family: ElementFamily;
  /** Grid position: column 1-18, row 1-7, or rows 9-10 for the f-block. */
  column: number;
  row: number;
}

// prettier-ignore
const SYMBOLS = "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og".split(" ");

// prettier-ignore
const NAMES = ("Hydrogen Helium Lithium Beryllium Boron Carbon Nitrogen Oxygen Fluorine Neon Sodium Magnesium Aluminium Silicon Phosphorus Sulfur Chlorine Argon Potassium Calcium Scandium Titanium Vanadium Chromium Manganese Iron Cobalt Nickel Copper Zinc Gallium Germanium Arsenic Selenium Bromine Krypton Rubidium Strontium Yttrium Zirconium Niobium Molybdenum Technetium Ruthenium Rhodium Palladium Silver Cadmium Indium Tin Antimony Tellurium Iodine Xenon Caesium Barium Lanthanum Cerium Praseodymium Neodymium Promethium Samarium Europium Gadolinium Terbium Dysprosium Holmium Erbium Thulium Ytterbium Lutetium Hafnium Tantalum Tungsten Rhenium Osmium Iridium Platinum Gold Mercury Thallium Lead Bismuth Polonium Astatine Radon Francium Radium Actinium Thorium Protactinium Uranium Neptunium Plutonium Americium Curium Berkelium Californium Einsteinium Fermium Mendelevium Nobelium Lawrencium Rutherfordium Dubnium Seaborgium Bohrium Hassium Meitnerium Darmstadtium Roentgenium Copernicium Nihonium Flerovium Moscovium Livermorium Tennessine Oganesson").split(" ");

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const FAMILY_OF: [ElementFamily, number[]][] = [
  ["alkali-metal", [3, 11, 19, 37, 55, 87]],
  ["alkaline-earth-metal", [4, 12, 20, 38, 56, 88]],
  ["metalloid", [5, 14, 32, 33, 51, 52]],
  ["nonmetal", [1, 6, 7, 8, 15, 16, 34]],
  ["halogen", [9, 17, 35, 53, 85, 117]],
  ["noble-gas", [2, 10, 18, 36, 54, 86, 118]],
  ["lanthanide", range(57, 71)],
  ["actinide", range(89, 103)],
  ["post-transition-metal", [13, 31, 49, 50, 81, 82, 83, 84, 113, 114, 115, 116]],
];

function familyOf(n: number): ElementFamily {
  return FAMILY_OF.find(([, list]) => list.includes(n))?.[0] ?? "transition-metal";
}

function position(n: number): { column: number; row: number } {
  if (n === 1) return { column: 1, row: 1 };
  if (n === 2) return { column: 18, row: 1 };
  const rows: [number, number][] = [
    [3, 10],
    [11, 18],
    [19, 36],
    [37, 54],
    [55, 86],
    [87, 118],
  ];
  for (let i = 0; i < rows.length; i++) {
    const [first, last] = rows[i];
    if (n < first || n > last) continue;
    const row = i + 2;
    const k = n - first; // 0-based within the period
    if (row <= 3) return { column: k < 2 ? k + 1 : k + 11, row };
    if (row <= 5) return { column: k + 1, row };
    // Periods 6-7: s-block, then the f-block (own row), then d and p blocks.
    if (k < 2) return { column: k + 1, row };
    if (k <= 16) return { column: k + 1, row: row === 6 ? 9 : 10 }; // 57-71 / 89-103
    return { column: k - 13, row };
  }
  return { column: 1, row: 1 };
}

export const ELEMENTS: readonly ChemicalElement[] = SYMBOLS.map((symbol, i) => ({
  number: i + 1,
  symbol,
  name: NAMES[i],
  family: familyOf(i + 1),
  ...position(i + 1),
}));

export const ELEMENT_BY_SYMBOL = new Map(ELEMENTS.map((e) => [e.symbol.toLowerCase(), e]));

export const FAMILY_LABELS: Record<ElementFamily, string> = {
  "alkali-metal": "Alkali metal",
  "alkaline-earth-metal": "Alkaline earth metal",
  "transition-metal": "Transition metal",
  "post-transition-metal": "Post-transition metal",
  metalloid: "Metalloid",
  nonmetal: "Nonmetal",
  halogen: "Halogen",
  "noble-gas": "Noble gas",
  lanthanide: "Lanthanide",
  actinide: "Actinide",
};
