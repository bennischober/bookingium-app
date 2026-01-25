import * as React from 'react'
import { Link } from '@tanstack/react-router'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail
} from '@/components/ui/sidebar'

const data = {
  navMain: [
    {
      title: 'Main Menu',
      url: '#',
      items: [
        {
          title: '📊 Dashboard',
          url: '/',
          isActive: true
        },
        {
          title: '📅 Calendar',
          url: '/calendar'
        }
      ]
    },
    {
      title: 'Production',
      url: '#',
      items: [
        {
          title: '🎸 Events',
          url: '/events'
        },
        {
          title: '📄 Invoices',
          url: '/invoices'
        }
      ]
    },
    {
      title: 'Directory',
      url: '#',
      items: [
        {
          title: '🥁 Bands',
          url: '/bands'
        },
        {
          title: '📍 Venues',
          url: '/venues'
        },
        {
          title: '🏨 Hotels',
          url: '/hotels'
        }
      ]
    }
  ]
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [activeItem, setActiveItem] = React.useState<string>('📊 Dashboard')

  const itemClick = (itemTitle: string) => {
    setActiveItem(itemTitle)
  }

  return (
    <Sidebar variant="sidebar" {...props}>
      <SidebarHeader>
        <h1 className="text-lg font-bold">BOOKINGIUM</h1>
      </SidebarHeader>
      <SidebarContent>
        {data.navMain.map((item) => (
          <SidebarGroup key={item.title}>
            <SidebarGroupLabel>{item.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {item.items?.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={item.title === activeItem}>
                      <Link
                        to={item.url}
                        onClick={() => {
                          itemClick(item.title)
                        }}
                      >
                        {item.title}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
