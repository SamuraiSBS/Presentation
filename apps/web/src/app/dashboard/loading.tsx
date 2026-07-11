export default function DashboardLoading() {
  return (
    <main className="page account-page" aria-busy="true" aria-label="Загружаем обзор">
      <div className="skeleton skeleton-heading" />
      <div className="dashboard-skeleton-grid">
        <div className="skeleton skeleton-panel" />
        <div className="skeleton skeleton-panel" />
        <div className="skeleton skeleton-panel" />
      </div>
      <div className="skeleton skeleton-list" />
    </main>
  );
}
