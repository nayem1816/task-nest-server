/**
 * The permission catalog. Guards check these keys, so the list is owned by code:
 * a role stored in the database can only reference keys defined here.
 */
export const PERMISSIONS = {
  'conversation.read': 'View conversations and messages',
  'conversation.reply': 'Send replies and internal notes',
  'conversation.assign': 'Assign conversations to members and teams',
  'conversation.manage': 'Change status, priority and tags of conversations',
  'conversation.delete': 'Delete conversations',

  'contact.read': 'View contacts and customer profiles',
  'contact.update': 'Create and edit contacts',
  'contact.delete': 'Delete contacts',

  'lead.read': 'View leads and the pipeline',
  'lead.manage': 'Create, move and assign leads',

  'commerce.read': 'View products and orders',
  'commerce.manage': 'Create and edit products and orders',

  'knowledge.read': 'View knowledge sources',
  'knowledge.manage': 'Add, update and remove knowledge sources',

  'agent.read': 'View AI agents and their activity',
  'agent.manage': 'Configure, test and activate AI agents',

  'automation.read': 'View workflows and their runs',
  'automation.manage': 'Create, edit and enable workflows',

  'analytics.view': 'View dashboards and analytics',
  'report.manage': 'Create, export and schedule reports',

  'team.read': 'View members and teams',
  'team.manage': 'Invite members, change roles and manage teams',

  'channel.manage': 'Connect and configure channels',
  'integration.manage': 'Connect and configure integrations',
  'apikey.manage': 'Create and revoke API keys',

  'audit.read': 'View the audit log',
  'settings.manage': 'Change organization settings',
  'billing.manage': 'Manage plan, payment method and invoices',
} as const satisfies Record<string, string>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}
