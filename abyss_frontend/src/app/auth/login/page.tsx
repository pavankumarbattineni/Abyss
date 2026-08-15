import type { Metadata } from "next";
import { LoginPage } from "@/components/pages/auth";

export const metadata: Metadata = {
  title: "Sign in",
};

const Page = () => <LoginPage />;

export default Page;
