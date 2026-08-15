import type { Metadata } from "next";
import { PreferencesSettingsPage } from "@/components/pages/settings";

export const metadata: Metadata = {
  title: "Preferences",
};

const Page = () => <PreferencesSettingsPage />;

export default Page;
