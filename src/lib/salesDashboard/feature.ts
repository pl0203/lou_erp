/** Build-time rollout only; navigation never initializes the data client. */
export const dashboardFeatureEnabled = import.meta.env.VITE_SALES_DASHBOARD_V3 === 'true'
