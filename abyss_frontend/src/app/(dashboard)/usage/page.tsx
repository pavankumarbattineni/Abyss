import type { Metadata } from "next";
import { UsageSettingsPage } from "@/components/pages/settings";

export const metadata: Metadata = {
  title: "Usage",
};

// A report, not a setting: its own page, outside Settings (reached from the
// sidebar's account menu). Padded as the Settings pages are.
const Page = () => (
  <div className="p-4 sm:p-6">
    <UsageSettingsPage />
  </div>
);

export default Page;
