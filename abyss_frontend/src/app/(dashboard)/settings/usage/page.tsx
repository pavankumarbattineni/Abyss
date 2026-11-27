import { redirect } from "next/navigation";

// Usage moved out of Settings to /usage; old links and bookmarks still land there.
export default function Page() {
  redirect("/usage");
}
