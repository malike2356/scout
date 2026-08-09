// scout-engine/src/lib/org-workspace.ts
// Resolves (and lazily creates) the default workspace for an organization, so
// public/dashboard API consumers never have to think in workspace_id terms.
import { db } from '../db/index.js';

export async function getOrCreateDefaultWorkspace(organizationId: string): Promise<string> {
  const existing = await db('workspaces')
    .where({ organization_id: organizationId })
    .orderBy('created_at', 'asc')
    .first();

  if (existing) return existing.id;

  const organization = await db('organizations').where({ id: organizationId }).first();
  const name = organization?.name ? `${organization.name} Workspace` : 'Default Workspace';

  const [workspace] = await db('workspaces')
    .insert({ organization_id: organizationId, name, active: true })
    .returning('*');

  return workspace.id;
}
