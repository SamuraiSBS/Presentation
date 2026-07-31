export function PageTransition({ routeKey, children }: { routeKey: string; children: React.ReactNode }) {
  // Page-level exit animations retained the previous route in the DOM. That
  // made an invisible page interactive during navigation, so route changes
  // deliberately use React/Next's single active tree instead.
  return <div className="motion-page" data-route-key={routeKey}>{children}</div>;
}
