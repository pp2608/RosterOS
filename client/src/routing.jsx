import React from 'react'

// Native path navigation keeps local/offline installations dependency free.
// The interface uses ordinary URLs and Vite's SPA fallback.
export function BrowserRouter({ children }) { return children }
export function NavLink({ to, className, children, onClick }) {
  const active = window.location.pathname === to || (to === '/' && window.location.pathname === '/index.html')
  return <a href={to} onClick={onClick} className={typeof className === 'function' ? className({ isActive: active }) : className}>{children}</a>
}
export function Route() { return null }
export function Routes({ children }) {
  const routes = React.Children.toArray(children)
  const path = window.location.pathname
  return routes.find(route => route.props.path === path)?.props.element || routes.find(route => route.props.path === '*')?.props.element || null
}
