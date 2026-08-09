// scout-engine/src/lib/api-keys.ts
// Organization API key lifecycle: create, look up, list, revoke.
// Raw keys look like sk_live_<hex>; only the bcrypt hash and a short prefix are stored.
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';

export const API_KEY_PREFIX = 'sk_live_';
const BCRYPT_ROUNDS = 10;
const PREFIX_LOOKUP_LENGTH = API_KEY_PREFIX.length + 8;

export interface ApiKeyRecord {
  id: string;
  organization_id: string;
  key_prefix: string;
  name: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface CreatedApiKey extends ApiKeyRecord {
  key: string;
}

function generateRawKey(): string {
  return `${API_KEY_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
}

export async function createApiKey(
  organizationId: string,
  name: string,
  scopes: string[] = ['read', 'write'],
): Promise<CreatedApiKey> {
  const rawKey = generateRawKey();
  const keyPrefix = rawKey.slice(0, PREFIX_LOOKUP_LENGTH);
  const keyHash = await bcrypt.hash(rawKey, BCRYPT_ROUNDS);

  const [row] = await db('api_keys')
    .insert({
      organization_id: organizationId,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      name,
      scopes,
    })
    .returning('*');

  return {
    id: row.id,
    organization_id: row.organization_id,
    key_prefix: row.key_prefix,
    name: row.name,
    scopes: row.scopes,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
    revoked_at: row.revoked_at,
    key: rawKey,
  };
}

export async function getOrganizationFromApiKey(
  rawKey: string,
): Promise<Record<string, unknown> | null> {
  if (!rawKey || !rawKey.startsWith(API_KEY_PREFIX)) return null;

  const keyPrefix = rawKey.slice(0, PREFIX_LOOKUP_LENGTH);
  const candidates = await db('api_keys')
    .where({ key_prefix: keyPrefix })
    .whereNull('revoked_at');

  for (const candidate of candidates) {
    const matches = await bcrypt.compare(rawKey, candidate.key_hash);
    if (!matches) continue;

    await db('api_keys')
      .where({ id: candidate.id })
      .update({ last_used_at: new Date().toISOString() });

    const organization = await db('organizations').where({ id: candidate.organization_id }).first();
    return organization ?? null;
  }

  return null;
}

export async function listApiKeys(organizationId: string): Promise<ApiKeyRecord[]> {
  return db('api_keys')
    .where({ organization_id: organizationId })
    .select('id', 'organization_id', 'key_prefix', 'name', 'scopes', 'last_used_at', 'created_at', 'revoked_at')
    .orderBy('created_at', 'desc');
}

export async function revokeApiKey(organizationId: string, keyId: string): Promise<boolean> {
  const updated = await db('api_keys')
    .where({ id: keyId, organization_id: organizationId })
    .whereNull('revoked_at')
    .update({ revoked_at: new Date().toISOString() });

  return updated > 0;
}
