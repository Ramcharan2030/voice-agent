"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar";

import { AppSidebar } from "./AppSidebar";

function AppHeader() {
  const { toggleSidebar } = useSidebar();

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between border-b bg-background/80 backdrop-blur-md px-4 py-3">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={toggleSidebar} aria-label="Open menu" className="hover:bg-accent rounded-xl transition-colors">
          <Menu className="h-5 w-5" />
        </Button>
        <Link href="/" className="text-lg font-bold hidden md:block">Voice Console</Link>
      </div>
    </header>
  );
}

interface AppLayoutProps {
  children: ReactNode;
  headerActions?: ReactNode;
  stickyTabs?: ReactNode;
}

const AppLayout: React.FC<AppLayoutProps> = ({
  children,
  headerActions,
  stickyTabs,
}) => {
  const pathname = usePathname();

  // Check if current route should have sidebar
  // Hide sidebar for root (/), /handler routes (Stack Auth routes), and /auth routes
  const shouldShowSidebar = pathname !== "/" && !pathname.startsWith("/handler") && !pathname.startsWith("/auth");

  // Only match the exact editor page /workflow/<id>, not sub-routes like /workflow/<id>/runs
  const isWorkflowEditor = /^\/workflow\/\d+$/.test(pathname);

  // Always render SidebarProvider to keep the component tree shape consistent
  // across route changes (avoids React hooks ordering violations during navigation).
  return (
    <SidebarProvider defaultOpen>
      {shouldShowSidebar ? (
        <div className="flex min-h-screen w-full">
          <AppSidebar />
          <SidebarInset className="flex-1">
            {!isWorkflowEditor && <AppHeader />}
            {/* Optional header area for specific pages */}
            {headerActions && (
              <header className="sticky top-0 z-50 w-full border-b bg-background">
                <div className="container mx-auto px-4 py-4">
                  <div className="flex items-center justify-center">
                    {headerActions}
                  </div>
                </div>
              </header>
            )}

            {/* Optional sticky tabs */}
            {stickyTabs && (
              <div className="sticky top-0 z-40 border-b" style={{ backgroundColor: 'var(--wf-bg)' }}>
                <div className="container mx-auto px-4">
                  <div className="flex items-center justify-center py-2">
                    {stickyTabs}
                  </div>
                </div>
              </div>
            )}

            {/* Main content area */}
            <main className="flex-1">
              {children}
            </main>
          </SidebarInset>
        </div>
      ) : (
        <div className="flex-1 w-full">
          {children}
        </div>
      )}
    </SidebarProvider>
  );
};

export default AppLayout;
