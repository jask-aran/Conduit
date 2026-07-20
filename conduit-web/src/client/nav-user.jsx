import { ChevronsUpDownIcon, LogOutIcon, RefreshCwIcon, SettingsIcon, UserRoundIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const connectivityCopy = {
  connecting: "Connecting to server…",
  online: "Server connected",
  reconnecting: "Reconnecting…",
  offline: "Server unavailable",
};

export function NavUser({ onOpenSettings, connectivity = "online", onRetryConnection, onLogout }) {
  const { isMobile } = useSidebar();
  const status = connectivityCopy[connectivity] || connectivityCopy.online;
  const tone = {
    connecting: "muted",
    online: "success",
    reconnecting: "warn",
    offline: "danger",
  }[connectivity] || "muted";

  return <SidebarMenu>
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
            <Avatar className="rounded-lg">
              <AvatarFallback className="rounded-lg text-sidebar-foreground">
                <UserRoundIcon absoluteStrokeWidth />
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-[15px] leading-tight">
              <span className="truncate font-medium">Conduit</span>
              <span className="truncate text-[13px] text-muted-foreground">{status}</span>
            </div>
            <span className={cn("server-status-dot", `server-status-${tone}`)} aria-hidden="true">
              {["connecting", "reconnecting"].includes(connectivity)
                ? <Spinner className="size-3" />
                : <span className="server-status-mark" />}
            </span>
            <ChevronsUpDownIcon absoluteStrokeWidth className="ml-auto text-sidebar-foreground" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
          side={isMobile ? "bottom" : "right"}
          align="end"
          sideOffset={4}
        >
          <DropdownMenuLabel className="font-normal">
            <div className="grid text-left text-sm leading-tight">
              <span className="font-medium">Conduit</span>
              <span className="text-xs text-muted-foreground">{status}</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={onOpenSettings}>
              <SettingsIcon absoluteStrokeWidth />
              Manage settings
            </DropdownMenuItem>
            {onLogout && <DropdownMenuItem onSelect={onLogout}>
              <LogOutIcon absoluteStrokeWidth />
              Sign out
            </DropdownMenuItem>}
            {connectivity !== "online" && onRetryConnection && <DropdownMenuItem onSelect={onRetryConnection}>
              <RefreshCwIcon absoluteStrokeWidth />
              Retry connection
            </DropdownMenuItem>}
            {connectivity === "offline" && <DropdownMenuItem onSelect={() => location.reload()}>
              <RefreshCwIcon absoluteStrokeWidth />
              Reload Conduit
            </DropdownMenuItem>}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>;
}
