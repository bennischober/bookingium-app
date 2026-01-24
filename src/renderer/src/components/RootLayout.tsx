import { Outlet, Link } from '@tanstack/react-router'

export default function RootLayout() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b p-4">
        <div className="flex gap-4">
          <Link to="/" className="hover:underline [&.active]:font-bold">
            Home
          </Link>
          <Link to="/about" className="hover:underline [&.active]:font-bold">
            About
          </Link>
        </div>
      </nav>
      <Outlet />
    </div>
  )
}
