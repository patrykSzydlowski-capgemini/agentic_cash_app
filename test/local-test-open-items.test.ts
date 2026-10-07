import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import cds from '@sap/cds';
import { PaymentsRepository } from '../srv/repository/PaymentsRepository.js';
import { LOCAL_TEST_OPEN_ITEMS, localTestOpenItemRows, localTestOpenItemsEnabled } from '../srv/fixtures/local-test-open-items.js';

const repository = new PaymentsRepository();
const localIds = LOCAL_TEST_OPEN_ITEMS.map(item => item.OpenItemId);

// cds.deploy exists at runtime but is missing from @cap-js/cds-types.
const { deploy } = cds as unknown as { deploy: (model: string) => { to: (db: string) => Promise<unknown> } };

before(async () => {
  await deploy('db').to('sqlite::memory:');
});

const openItems = () => cds.entities('poc.cash').OpenItem;

test('local test items are enabled by default and switched off only by LOCAL_TEST_OPEN_ITEMS=false', () => {
  assert.equal(localTestOpenItemsEnabled({}), true);
  assert.equal(localTestOpenItemsEnabled({ LOCAL_TEST_OPEN_ITEMS: 'true' }), true);
  assert.equal(localTestOpenItemsEnabled({ LOCAL_TEST_OPEN_ITEMS: 'FALSE' }), false);
});

test('local test item ids never collide with each other and are all OPEN/LOCAL rows', () => {
  assert.equal(new Set(localIds).size, localIds.length);
  for (const row of localTestOpenItemRows()) {
    assert.equal(row.source, 'LOCAL');
    assert.equal(row.ClearingStatus, 'OPEN');
    assert.equal(row.dismissed, false);
  }
});

test('seeding inserts missing local items only and keeps their state on re-seed', async () => {
  assert.equal(await repository.insertMissingOpenItems(localTestOpenItemRows()), localIds.length);
  await repository.markOpenItemsCleared([localIds[0]]);
  assert.equal(await repository.insertMissingOpenItems(localTestOpenItemRows()), 0);
  const cleared = await SELECT.one.from(openItems()).where({ OpenItemId: localIds[0] });
  assert.equal(cleared.ClearingStatus, 'CLEARED', 're-seeding must not reopen a locally cleared item');
});

test('S/4 sync deletes stale S/4 rows (also rows without source) but keeps local test items', async () => {
  await UPSERT.into(openItems()).entries([
    { OpenItemId: 'S4-KEEP', CustomerName: 'Kept', ClearingStatus: 'OPEN', source: 'S4' },
    { OpenItemId: 'S4-GONE', CustomerName: 'Gone', ClearingStatus: 'OPEN', source: 'S4' },
  ]);
  await UPDATE(openItems()).set({ source: null }).where({ OpenItemId: '9123456799' });

  await repository.deleteOpenItemsNotIn(['S4-KEEP']);
  const ids = (await SELECT.from(openItems()).columns('OpenItemId') as Array<{ OpenItemId: string }>).map(row => row.OpenItemId);
  assert.ok(ids.includes('S4-KEEP'));
  assert.ok(!ids.includes('S4-GONE'));
  assert.ok(!ids.includes('9123456799'), 'rows cached before the source column existed count as S/4 rows');
  for (const id of localIds) assert.ok(ids.includes(id), `local item ${id} survives the sync`);

  await repository.deleteOpenItemsNotIn([]);
  const remaining = await SELECT.from(openItems()) as Array<{ source: string }>;
  assert.equal(remaining.length, localIds.length);
  assert.ok(remaining.every(row => row.source === 'LOCAL'));
});

test('findLocalOpenItemIds returns only local test items', async () => {
  await UPSERT.into(openItems()).entries([{ OpenItemId: 'S4-ITEM', ClearingStatus: 'OPEN', source: 'S4' }]);
  const found = await repository.findLocalOpenItemIds(['S4-ITEM', localIds[1], 'UNKNOWN']);
  assert.deepEqual([...found], [localIds[1]]);
});
