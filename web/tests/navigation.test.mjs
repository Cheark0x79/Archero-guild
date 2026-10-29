import assert from 'node:assert/strict';
import test from 'node:test';
import { ADMIN_ROLE, USER_ROLE, roleCanAccessPath } from '../lib/auth.js';
import { navigationGroupsForRole } from '../lib/navigation.js';

test('administrators discover history alongside member management in intentional groups', () => {
  const groups = navigationGroupsForRole(ADMIN_ROLE);
  assert.deepEqual(groups.map(({ label }) => label), ['Guild', 'Manage members · Admin', 'Configure guild · Admin', 'Reference · Admin']);
  assert.deepEqual(groups[1].items.map(item => item[2]), ['/admin', '/admin/members', '/admin/member-history']);
  assert.deepEqual(groups[2].items.map(item => item[2]), ['/admin/notifications', '/admin/rules']);
  assert.deepEqual(groups[3].items.map(item => item[2]), ['/api-docs']);
  const links = groups.flatMap(group => group.items);
  assert.equal(new Set(links.map(item => item[2])).size, links.length);
  for (const [, , path] of links) assert.equal(roleCanAccessPath(path, ADMIN_ROLE), true);
});

test('viewers and unknown roles never receive restricted groups even with development tools enabled', () => {
  for (const role of [USER_ROLE, null, undefined, 'unknown']) {
    const groups = navigationGroupsForRole(role, { testToolsEnabled: true });
    assert.deepEqual(groups.map(group => group.label), ['Guild']);
    assert.deepEqual(groups[0].items.map(item => item[2]), ['/dashboard', '/members', '/boss']);
    for (const [, , path] of groups[0].items) assert.equal(roleCanAccessPath(path, USER_ROLE), true);
  }
});

test('development tools require both administrator role and explicit enablement', () => {
  assert.equal(navigationGroupsForRole(ADMIN_ROLE).some(group => group.id === 'development'), false);
  assert.deepEqual(navigationGroupsForRole(ADMIN_ROLE, { testToolsEnabled: true }).at(-1).items, [['test', 'Test tools', '/test']]);
});
