import { Sidebar } from "@/components/sidebar";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (user.role === "reception") {
    redirect("/rececao");
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} />
      <main className="w-full pt-14 px-4 pb-8 lg:ml-[246px] lg:w-[calc(100%-246px)] lg:max-w-[1800px] lg:px-[38px] lg:pt-8">
        {children}
      </main>
    </div>
  );
}
