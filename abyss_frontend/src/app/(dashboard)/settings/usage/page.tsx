import type { Metadata } from "next";
import { UsageSettingsPage } from "@/components/pages/settings";

export const metadata: Metadata = {
  title: "Usage",
};

const Page = () => <UsageSettingsPage />;

export default Page;
