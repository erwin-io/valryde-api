export const OpenApiTags = {
  system: '01 — System & Health',
  authentication: '02 — Authentication & Sessions',
  accounts: '03 — User Profiles & Accounts',
  jeepneys: '04 — Jeepney Management',
  fleetGroups: '05 — Fleet Groups & Membership',
  transit: '06 — Transit Routes & Directions',
  vehicleApplications: '07 — Vehicle Applications & Approvals',
  gps: '08 — GPS Devices & Installation',
  liveTracking: '09 — Live Tracking & Availability',
  trackingHistory: '10 — Tracking History & Events',
  compliance: '11 — Route Compliance & Geospatial',
  realtime: '12 — Realtime & Channels',
  placeSearch: '13 — Place Search & Transit Discovery',
  operatorReports: '14 — Operator Operations & Reports',
  administration: '15 — Administration & Reports',
} as const;

export const openApiTagDefinitions = [
  { name: OpenApiTags.system, description: 'API health, readiness, and diagnostics.' },
  {
    name: OpenApiTags.authentication,
    description: 'Public authentication flows and refresh-token session lifecycle.',
  },
  {
    name: OpenApiTags.accounts,
    description: 'Authenticated profile maintenance and Admin-controlled user status.',
  },
  {
    name: OpenApiTags.jeepneys,
    description: 'Role-scoped jeepney records and driver-to-jeepney assignments.',
  },
  {
    name: OpenApiTags.fleetGroups,
    description: 'Operator-owned fleet groups and their driver and jeepney memberships.',
  },
  {
    name: OpenApiTags.transit,
    description: 'Public route data, Admin-managed route geometry, and transit assignments.',
  },
  {
    name: OpenApiTags.vehicleApplications,
    description: 'Vehicle application submission and Admin approval or rejection.',
  },
  {
    name: OpenApiTags.gps,
    description: 'GPS setup requests, installation verification, and Traccar device mapping.',
  },
  {
    name: OpenApiTags.liveTracking,
    description: 'Future contract area for latest vehicle state and route-filtered availability.',
  },
  {
    name: OpenApiTags.trackingHistory,
    description: 'Future contract area for scoped tracking history and normalized events.',
  },
  {
    name: OpenApiTags.compliance,
    description: 'Future contract area for route corridors, geofences, and compliance state.',
  },
  {
    name: OpenApiTags.realtime,
    description: 'Future contract area for realtime channel authorization and event contracts.',
  },
  {
    name: OpenApiTags.placeSearch,
    description: 'Normalized place search and direct (no-transfer) transit discovery.',
  },
  {
    name: OpenApiTags.operatorReports,
    description: 'Future contract area for Operator fleet summaries and reports.',
  },
  {
    name: OpenApiTags.administration,
    description: 'Admin read-only audit trail; future area for monitoring, reporting, and exports.',
  },
];
