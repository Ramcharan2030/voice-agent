"use client";

import type { Team } from "@stackframe/stack";
import {
  AlertTriangle,
  AudioLines,
  Brain,
  Calculator,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Database,
  FileText,
  Home,
  Key,
  List,
  LogOut,
  type LucideIcon,
  Megaphone,
  Phone,
  Settings,
  TrendingUp,
  Workflow,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React, { useRef } from "react";

import ThemeToggle from "@/components/ThemeSwitcher";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppConfig } from "@/context/AppConfigContext";
import { useTelephonyConfigWarnings } from "@/context/TelephonyConfigWarningsContext";
import type { LocalUser } from "@/lib/auth";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

type SidebarNavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  showsTelephonyWarning?: boolean;
};

type SidebarNavSection = {
  label?: string;
  items: SidebarNavItem[];
  superadminOnly?: boolean;
};

const NAV_SECTIONS: SidebarNavSection[] = [
  {
    items: [
      {
        title: "Overview",
        url: "/overview",
        icon: Home,
      },
    ],
  },
  {
    label: "BUILD",
    items: [
      {
        title: "Voice Agents",
        url: "/workflow",
        icon: Workflow,
      },
      {
        title: "Campaigns",
        url: "/campaigns",
        icon: Megaphone,
      },
      {
        title: "Models",
        url: "/model-configurations",
        icon: Brain,
      },
      {
        title: "Telephony",
        url: "/telephony-configurations",
        icon: Phone,
        showsTelephonyWarning: true,
      },
      {
        title: "Tools",
        url: "/tools",
        icon: Wrench,
      },
      {
        title: "Files",
        url: "/files",
        icon: Database,
      },
      {
        title: "Recordings",
        url: "/recordings",
        icon: AudioLines,
      },
      {
        title: "Developers",
        url: "/api-keys",
        icon: Key,
      },
    ],
  },
  {
    label: "OBSERVE",
    items: [
      {
        title: "Agent Runs",
        url: "/usage",
        icon: TrendingUp,
      },
      {
        title: "Reports",
        url: "/reports",
        icon: FileText,
      },
    ],
  },
  {
    label: "ADMIN",
    superadminOnly: true,
    items: [
      {
        title: "Superadmin",
        url: "/superadmin",
        icon: Settings,
      },
      {
        title: "Cost Analytics",
        url: "/superadmin/costs",
        icon: Calculator,
      },
      {
        title: "All Runs",
        url: "/superadmin/runs",
        icon: List,
      },
    ],
  },
];

// Lazy load SelectedTeamSwitcher - we'll pass selectedTeam from our context
const StackTeamSwitcher = React.lazy(() =>
  import("@stackframe/stack").then((mod) => ({
    default: mod.SelectedTeamSwitcher,
  }))
);

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const { provider, getSelectedTeam, logout, user } = useAuth();
  const { config } = useAppConfig();
  const { telnyxMissingWebhookPublicKeyCount } = useTelephonyConfigWarnings();
  const hasTelephonyWarning = telnyxMissingWebhookPublicKeyCount > 0;
  const isCollapsed = !isMobile && state === "collapsed";
  const canManagePlatform = provider === "local"
    ? Boolean((user as LocalUser | undefined)?.is_superuser)
    : true;
  const isSuperuser = canManagePlatform;

  // Get selected team for Stack auth (cast to Team type from Stack)
  // Stabilize the reference so SelectedTeamSwitcher only sees a change when the team ID changes,
  // preventing unnecessary PATCH calls to Stack Auth on every route navigation.
  const selectedTeamRef = useRef<Team | null>(null);
  const rawSelectedTeam = provider === "stack" && getSelectedTeam ? getSelectedTeam() as Team | null : null;
  if (rawSelectedTeam?.id !== selectedTeamRef.current?.id) {
    selectedTeamRef.current = rawSelectedTeam;
  }
  const selectedTeam = selectedTeamRef.current;

  // Version info from app config context
  const versionInfo = config ? { ui: config.uiVersion, api: config.apiVersion } : null;

  const isActive = (path: string) => pathname.startsWith(path);

  const handleMobileNavClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const SidebarLink = ({ item }: { item: SidebarNavItem }) => {
    const isItemActive = isActive(item.url);
    const Icon = item.icon;
    const showWarningDot = item.showsTelephonyWarning && hasTelephonyWarning;
    const tooltip = {
      children: (
        <div className="notranslate" translate="no">
          <p className="font-medium">{item.title}</p>
          {showWarningDot && (
            <p className="text-amber-500 mt-1 text-xs">Action required</p>
          )}
        </div>
      ),
    };
    const warningIndicator = (
      <AlertTriangle
        aria-label="Action required on a telephony configuration"
        className={cn(
          "text-amber-500",
          isCollapsed ? "absolute -right-0.5 -top-0.5 h-3 w-3" : "ml-auto h-3.5 w-3.5"
        )}
      />
    );

    return (
      <SidebarMenuButton
        asChild
        tooltip={tooltip}
        className={cn(
          "rounded-lg transition-all duration-200",
          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          isItemActive && [
            "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
            "relative",
            "before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2",
            "before:w-[3px] before:h-[60%] before:rounded-r-md",
            "before:bg-gradient-to-b before:from-[oklch(0.488_0.243_264.376)] before:to-[oklch(0.696_0.17_162.48)]",
            "before:shadow-[0_0_12px_oklch(0.488_0.243_264.376/0.5)]"
          ]
        )}
      >
        <Link
          href={item.url}
          onClick={handleMobileNavClick}
          className={cn("relative", isCollapsed && "justify-center")}
          translate="no"
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span
            className={cn("notranslate min-w-0 flex-1 truncate", isCollapsed && "sr-only")}
            translate="no"
          >
            {item.title}
          </span>
          {showWarningDot && (
            isCollapsed ? (
              warningIndicator
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  {warningIndicator}
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Action required</p>
                </TooltipContent>
              </Tooltip>
            )
          )}
        </Link>
      </SidebarMenuButton>
    );
  };

  return (
    <Sidebar collapsible="icon" className="border-r bg-sidebar">
      <SidebarHeader className="border-b border-sidebar-border/50 px-3 py-4 notranslate" translate="no">
        <div className="flex items-center justify-between">
          <div className={cn("flex items-center gap-3", isCollapsed && "hidden")}>
            <Link
              href="/"
              className="notranslate flex items-center gap-2.5 px-2 group"
              translate="no"
            >
              {/* Logo gradient badge */}
              <div className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-sidebar-primary to-sidebar-primary/80 shadow-lg shadow-sidebar-primary/20 group-hover:scale-105 transition-transform duration-200">
                <span className="text-sidebar-primary-foreground font-bold text-lg">V</span>
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-bold tracking-tight text-sidebar-foreground">Voice Console</span>
                {versionInfo && (
                  <span
                    className="notranslate text-[10px] font-medium text-sidebar-foreground/50"
                    translate="no"
                  >
                    v{versionInfo.ui}
                  </span>
                )}
              </div>
            </Link>
          </div>

          <SidebarTrigger className={cn("hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded-lg transition-all duration-200", isCollapsed && "mx-auto")}>
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </SidebarTrigger>
        </div>

        {provider === "stack" && (
          <div className={cn("mt-3 notranslate", isCollapsed && "hidden")} translate="no">
            <React.Suspense
              fallback={
                <div className="h-9 w-full animate-pulse rounded bg-muted" />
              }
            >
              <StackTeamSwitcher
                selectedTeam={selectedTeam || undefined}
                onChange={() => {
                  router.refresh();
                }}
              />
            </React.Suspense>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className={cn("notranslate", isCollapsed && "px-0")} translate="no">
        {NAV_SECTIONS
          .filter((section) => canManagePlatform || section.label !== "BUILD")
          .filter((section) => !section.superadminOnly || isSuperuser)
          .map((section, index) => (
          <SidebarGroup
            key={section.label ?? "overview"}
            className={index === 0 ? "mt-2" : "mt-6"}
          >
            {section.label && (
              <SidebarGroupLabel
                className={cn(
                  "notranslate text-[11px] font-bold uppercase tracking-wider text-sidebar-foreground/40",
                  "px-3 py-2",
                  isCollapsed && "hidden"
                )}
                translate="no"
              >
                {section.label}
              </SidebarGroupLabel>
            )}
            <SidebarMenu className="gap-1">
              {section.items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarLink item={item} />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter
        className={cn("border-t border-sidebar-border/50 p-4 notranslate", isCollapsed && "p-2")}
        translate="no"
      >
        <div className="space-y-2">
          {provider !== "stack" && (
            <div className={cn("flex", isCollapsed ? "justify-center" : "justify-start")}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer rounded-full">
                    <span className="text-xs font-medium">
                      {(user?.displayName || (user as LocalUser | undefined)?.email || "")
                        .split(/[\s@]/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((s: string) => s[0]?.toUpperCase())
                        .join("")
                        || "U"}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      {(user as LocalUser | undefined)?.email && (
                        <p className="text-xs text-muted-foreground">{(user as LocalUser).email}</p>
                      )}
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {canManagePlatform && (
                    <DropdownMenuItem onClick={() => router.push("/settings")} className="cursor-pointer">
                      <Settings className="mr-2 h-4 w-4" />
                      Platform Settings
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => logout()} className="cursor-pointer">
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {provider === "stack" && (
            <div className={cn("flex", isCollapsed ? "justify-center" : "justify-start")}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer rounded-full">
                    <span className="text-xs font-medium">
                      {(user?.displayName || (user as { primaryEmail?: string })?.primaryEmail || "")
                        .split(/[\s@]/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((s: string) => s[0]?.toUpperCase())
                        .join("")
                        || "U"}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      {user?.displayName && (
                        <p className="text-sm font-medium">{user.displayName}</p>
                      )}
                      {(user as { primaryEmail?: string })?.primaryEmail && (
                        <p className="text-xs text-muted-foreground">{(user as { primaryEmail?: string }).primaryEmail}</p>
                      )}
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => router.push("/handler/account-settings")} className="cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    Account settings
                  </DropdownMenuItem>
                  {canManagePlatform && (
                    <DropdownMenuItem onClick={() => router.push("/settings")} className="cursor-pointer">
                      <Settings className="mr-2 h-4 w-4" />
                      Platform Settings
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => router.push("/usage")} className="cursor-pointer">
                    <CircleDollarSign className="mr-2 h-4 w-4" />
                    Usage
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => logout()} className="cursor-pointer">
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          <div className={cn("mt-2 border-t pt-2", isCollapsed && "flex justify-center")}>
            {isCollapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="notranslate" translate="no">
                    <ThemeToggle
                      showLabel={false}
                      className="hover:bg-accent hover:text-accent-foreground"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Toggle theme</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <div className="notranslate" translate="no">
                <ThemeToggle
                  showLabel={true}
                  className="hover:bg-accent hover:text-accent-foreground"
                />
              </div>
            )}
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
