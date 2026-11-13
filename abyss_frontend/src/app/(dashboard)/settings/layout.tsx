import type { Metadata } from "next";
import { SettingsNav } from "@/components/pages/settings";

export const metadata: Metadata = {
  // A plain string here would drop the root "%s | Abyss" template for every
  // settings page below this layout.
  title: { default: "Settings", template: "%s | Abyss" },
};

const SettingsLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6 md:flex-row md:gap-8">
      <SettingsNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
};

export default SettingsLayout;
