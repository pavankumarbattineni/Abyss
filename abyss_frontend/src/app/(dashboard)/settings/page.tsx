import type { Metadata } from "next";
import { AppearanceSettingsPage } from "@/components/pages/settings";

export const metadata: Metadata = {
  title: "Appearance",
};

const Page = () => <AppearanceSettingsPage />;

export default Page;
