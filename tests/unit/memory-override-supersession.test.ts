/**
 * Supersession path for store_memory with isOverride + preference_key.
 *
 * Tests the fix for the "I overrode a rule but the old one is still in my
 * context" gap: when MCP store_memory is called with isOverride=true and a
 * preference_key, previous active rules sharing that key should be marked
 * superseded (is_active=0) and their keys returned so the agent can ignore
 * stale text upstream.
 */

import { MemoryStorage } from '../../src/memory/storage';

describe('store_memory override supersession', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage(':memory:');
  });

  afterEach(() => {
    storage.close();
  });

  it('getActiveByPreferenceKeyAnyType returns active rules regardless of type', () => {
    storage.save({
      key: 'devops_1', value: { content: 'old devops' }, type: 'devops',
      project_id: 'proj-a', preference_key: 'deploy_cmd', is_active: true,
    });
    storage.save({
      key: 'pref_1', value: { content: 'old pref' }, type: 'preference',
      project_id: 'proj-a', preference_key: 'deploy_cmd', is_active: true,
    });
    storage.save({
      key: 'other_1', value: { content: 'unrelated' }, type: 'devops',
      project_id: 'proj-a', preference_key: 'other_key', is_active: true,
    });

    const results = storage.getActiveByPreferenceKeyAnyType('deploy_cmd', 'proj-a');
    const keys = results.map(r => r.key).sort();
    expect(keys).toEqual(['devops_1', 'pref_1']);
  });

  it('excludes already-superseded rules from getActiveByPreferenceKeyAnyType', () => {
    storage.save({
      key: 'old', value: { content: 'v1' }, type: 'devops',
      project_id: 'proj-a', preference_key: 'deploy_cmd', is_active: true,
    });
    storage.markSuperseded('old', 'new');

    const results = storage.getActiveByPreferenceKeyAnyType('deploy_cmd', 'proj-a');
    expect(results).toHaveLength(0);
  });

  it('matches universal (project_id=null) rules when querying by project', () => {
    storage.save({
      key: 'universal_1', value: { content: 'global rule' }, type: 'devops',
      preference_key: 'deploy_cmd', is_active: true,
    });

    const results = storage.getActiveByPreferenceKeyAnyType('deploy_cmd', 'proj-a');
    expect(results.map(r => r.key)).toEqual(['universal_1']);
  });

  it('MemoryService.supersedeByPreferenceKey marks prior rules superseded and returns their keys', () => {
    // Use an isolated storage + service by injecting via the service's internals.
    // We swap in our in-memory storage to avoid touching the real DB.
    const { MemoryService } = require('../../src/services/memory');
    const service = MemoryService.getInstance();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalStorage = (service as any).storage;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).storage = storage;

    try {
      storage.save({
        key: 'old_devops', value: { content: 'old' }, type: 'devops',
        project_id: 'proj-a', preference_key: 'deploy_cmd', is_active: true,
      });
      storage.save({
        key: 'new_devops', value: { content: 'new' }, type: 'devops',
        project_id: 'proj-a', preference_key: 'deploy_cmd', is_active: true,
      });

      const supersededKeys = service.supersedeByPreferenceKey(
        'deploy_cmd',
        'new_devops',
        { projectId: 'proj-a' },
      );

      expect(supersededKeys).toEqual(['old_devops']);

      const old = storage.retrieve('old_devops');
      expect(old?.is_active).toBe(false);
      expect(old?.superseded_by).toBe('new_devops');

      const fresh = storage.retrieve('new_devops');
      expect(fresh?.is_active).toBe(true);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).storage = originalStorage;
    }
  });

  it('supersedeByPreferenceKey is a no-op when no prior active rules exist', () => {
    const { MemoryService } = require('../../src/services/memory');
    const service = MemoryService.getInstance();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalStorage = (service as any).storage;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).storage = storage;

    try {
      const result = service.supersedeByPreferenceKey('nonexistent', 'new_key', { projectId: 'proj-a' });
      expect(result).toEqual([]);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).storage = originalStorage;
    }
  });

  it('MemoryService.store persists preference_key so future overrides find the rule', () => {
    const { MemoryService } = require('../../src/services/memory');
    const service = MemoryService.getInstance();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalStorage = (service as any).storage;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).storage = storage;

    try {
      service.store({
        key: 'rule_1',
        value: { content: 'v1' },
        type: 'devops',
        preferenceKey: 'build_cmd',
        context: { projectId: 'proj-a', timestamp: Date.now() },
      });

      const found = storage.getActiveByPreferenceKeyAnyType('build_cmd', 'proj-a');
      expect(found.map(m => m.key)).toEqual(['rule_1']);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).storage = originalStorage;
    }
  });
});
