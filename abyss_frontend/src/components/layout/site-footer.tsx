import Link from "next/link";

/** Footer of the signed-out pages (Home, About Trench). */
export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted-foreground sm:px-6">
        <span>Abyss</span>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/about-trench" className="text-sage-text hover:text-foreground">
            About Trench, our sibling app
          </Link>
          <Link href="/auth/signup" className="text-sage-text hover:text-foreground">
            Create your first agent
          </Link>
        </nav>
      </div>
    </footer>
  );
}
