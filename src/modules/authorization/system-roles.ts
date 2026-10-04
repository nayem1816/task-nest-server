import { ALL_PERMISSIONS, type Permission } from './permissions.js';

export type SystemRoleKey = 'owner' | 'admin' | 'manager' | 'agent' | 'sales' | 'viewer';

export interface SystemRoleDefinition {
  key: SystemRoleKey;
  name: string;
  description: string;
  permissions: readonly Permission[];
}

const READ_ONLY: Permission[] = [
  'conversation.read',
  'contact.read',
  'lead.read',
  'commerce.read',
  'knowledge.read',
  'agent.read',
  'automation.read',
  'analytics.view',
  'team.read',
];

/**
 * Created for every new organization. Changing a definition here does not
 * touch existing organizations; that needs a data migration.
 */
export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  {
    key: 'owner',
    name: 'Owner',
    description: 'Full access, including billing and deleting the organization.',
    permissions: ALL_PERMISSIONS,
  },
  {
    key: 'admin',
    name: 'Admin',
    description: 'Configures the workspace, channels, AI and team. No access to billing.',
    permissions: ALL_PERMISSIONS.filter((p) => p !== 'billing.manage'),
  },
  {
    key: 'manager',
    name: 'Manager',
    description: 'Runs the support and sales team: assignments, workflows and reports.',
    permissions: [
      ...READ_ONLY,
      'conversation.reply',
      'conversation.assign',
      'conversation.manage',
      'contact.update',
      'lead.manage',
      'automation.manage',
      'report.manage',
      'audit.read',
    ],
  },
  {
    key: 'agent',
    name: 'Agent',
    description: 'Handles customer conversations and keeps contact details up to date.',
    permissions: [
      'conversation.read',
      'conversation.reply',
      'conversation.assign',
      'conversation.manage',
      'contact.read',
      'contact.update',
      'lead.read',
      'commerce.read',
      'knowledge.read',
      'team.read',
    ],
  },
  {
    key: 'sales',
    name: 'Sales',
    description: 'Works leads and the pipeline, and replies to sales conversations.',
    permissions: [
      'conversation.read',
      'conversation.reply',
      'contact.read',
      'contact.update',
      'lead.read',
      'lead.manage',
      'commerce.read',
      'knowledge.read',
      'analytics.view',
      'team.read',
    ],
  },
  {
    key: 'viewer',
    name: 'Viewer',
    description: 'Read-only access to conversations, contacts, leads and analytics.',
    permissions: READ_ONLY,
  },
];
