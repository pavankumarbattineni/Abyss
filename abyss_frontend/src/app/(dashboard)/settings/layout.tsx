import type { Metadata } from "next";
import { SettingsNav } from "@/components/pages/settings";

export const metadata: Metadata = {
  title: "Settings",
};

const SettingsLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="flex gap-8 p-6">
      <SettingsNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
};

export default SettingsLayout;
