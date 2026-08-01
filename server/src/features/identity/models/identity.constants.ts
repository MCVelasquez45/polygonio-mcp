// Collection names for the Identity Platform. All prefixed `identity_` so they
// never collide with existing trading collections. Existing trading collections
// are NOT modified by Phase 1.

export const IDENTITY_COLLECTIONS = {
  users: 'identity_users',
  sessions: 'identity_sessions',
  emailTokens: 'identity_email_tokens',
  oauthAttempts: 'identity_oauth_attempts',
  auditLogs: 'identity_audit_logs',
  brokerConnections: 'identity_broker_connections',
  apiTokens: 'identity_api_tokens',
  organizations: 'identity_organizations',
  memberships: 'identity_memberships',
  workspaceProfiles: 'identity_workspace_profiles',
  roles: 'identity_roles',
} as const;
