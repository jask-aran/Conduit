import { ChevronsUpDownIcon, SettingsIcon, UserRoundIcon } from "lucide-react";
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

export function NavUser({ onOpenSettings }) {
  const { isMobile } = useSidebar();

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
              <span className="truncate text-[13px]">Local workspace</span>
            </div>
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
              <span className="text-xs text-muted-foreground">Local Pi workspace</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={onOpenSettings}>
              <SettingsIcon absoluteStrokeWidth />
              Manage settings
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>;
}
