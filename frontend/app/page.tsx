import { redirect } from "next/navigation";

import { MovieApp } from "@/app/components/MovieApp";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return <MovieApp userEmail={user.email ?? "ログイン済み"} />;
}
