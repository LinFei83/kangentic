/**
 * Wave 0 OpenSpec board-card schema: the task columns, the dual automation
 * list, and a real-SQL round-trip through the repositories.
 *
 * Suites that mock prepare() would stay green if the ALTER TABLE were missing
 * or the unique index still keyed only on (swimlane_id, name). The upgrade
 * path that matters on a user's machine is tables that already exist, with
 * rows in them, from before these columns. The fixture bootstraps a modern
 * schema, drops only the new pieces, seeds rows, and runs the migration again.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type DatabaseType from 'better-sqlite3';
import { runProjectMigrations } from '../../src/main/db/migrations/project-schema';
import { AutomationRepository } from '../../src/main/db/repositories/automation-repository';
import { SwimlaneRepository } from '../../src/main/db/repositories/swimlane-repository';
import { TaskRepository } from '../../src/main/db/repositories/task-repository';
import { openTestDatabase } from './helpers/test-database';

const openDatabases: DatabaseType.Database[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
});

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
}

function openDatabase(): DatabaseType.Database {
  const database = openTestDatabase();
  openDatabases.push(database);
  database.exec('PRAGMA foreign_keys = ON');
  return database;
}

function columnInfo(database: DatabaseType.Database, tableName: string, columnName: string): ColumnInfo | undefined {
  return (database.pragma(`table_info(${tableName})`) as ColumnInfo[]).find((column) => column.name === columnName);
}

function indexSql(database: DatabaseType.Database, indexName: string): string | undefined {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(indexName) as { sql: string } | undefined;
  return row?.sql;
}

const TASK_COLUMNS = [
  { column: 'card_kind', notnull: 1, defaultContains: 'regular' },
  { column: 'task_intent', notnull: 1, defaultContains: 'work' },
  { column: 'openspec_change', notnull: 0, defaultContains: 'NULL' },
  { column: 'openspec_note', notnull: 0, defaultContains: 'NULL' },
] as const;

describe('OpenSpec board-card migration', () => {
  it('adds the task and automation columns with the Wave 0 defaults', () => {
    const database = openDatabase();
    runProjectMigrations(database);

    for (const expected of TASK_COLUMNS) {
      const column = columnInfo(database, 'tasks', expected.column);
      expect(column, expected.column).toBeDefined();
      expect(column!.notnull).toBe(expected.notnull);
      expect(column!.dflt_value).toContain(expected.defaultContains);
    }

    const appliesTo = columnInfo(database, 'column_automations', 'applies_to');
    expect(appliesTo).toBeDefined();
    expect(appliesTo!.notnull).toBe(1);
    expect(appliesTo!.dflt_value).toContain('regular');

    const uniqueName = indexSql(database, 'idx_column_automations_name');
    expect(uniqueName).toContain('applies_to');
    expect(indexSql(database, 'idx_tasks_openspec_change')).toContain('openspec_change');
  });

  it('is idempotent across repeated runs', () => {
    const database = openDatabase();
    runProjectMigrations(database);
    expect(() => runProjectMigrations(database)).not.toThrow();
    expect(() => runProjectMigrations(database)).not.toThrow();

    expect(
      (database.pragma('table_info(tasks)') as ColumnInfo[]).filter((column) => column.name === 'card_kind'),
    ).toHaveLength(1);
    expect(
      (database.pragma('table_info(column_automations)') as ColumnInfo[])
        .filter((column) => column.name === 'applies_to'),
    ).toHaveLength(1);
  });

  it('backfills existing rows to regular/work and rebuilds the unique name index', () => {
    const database = openDatabase();
    runProjectMigrations(database);

    database.exec('DROP INDEX IF EXISTS idx_tasks_openspec_change');
    for (const column of ['card_kind', 'task_intent', 'openspec_change', 'openspec_note']) {
      if (columnInfo(database, 'tasks', column)) database.exec(`ALTER TABLE tasks DROP COLUMN ${column}`);
    }
    database.exec('DROP INDEX IF EXISTS idx_column_automations_name');
    if (columnInfo(database, 'column_automations', 'applies_to')) {
      database.exec('ALTER TABLE column_automations DROP COLUMN applies_to');
    }
    database.exec(
      'CREATE UNIQUE INDEX idx_column_automations_name ON column_automations(swimlane_id, name COLLATE NOCASE)',
    );

    const laneId = (database.prepare('SELECT id FROM swimlanes LIMIT 1').get() as { id: string }).id;
    database
      .prepare(
        `INSERT INTO tasks (id, title, description, swimlane_id, position, created_at, updated_at)
         VALUES ('t-old', 'Old', '', ?, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run(laneId);
    database
      .prepare(
        `INSERT INTO column_automations
          (id, swimlane_id, name, type, trigger, position, enabled, config_json, created_at, updated_at)
         VALUES ('a-old', ?, 'Ping', 'notify', 'enter', 0, 1, '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run(laneId);

    runProjectMigrations(database);

    const task = database.prepare('SELECT card_kind, task_intent, openspec_change, openspec_note FROM tasks WHERE id = ?')
      .get('t-old') as {
      card_kind: string;
      task_intent: string;
      openspec_change: string | null;
      openspec_note: string | null;
    };
    expect(task.card_kind).toBe('regular');
    expect(task.task_intent).toBe('work');
    expect(task.openspec_change).toBeNull();
    expect(task.openspec_note).toBeNull();

    const automation = database.prepare('SELECT applies_to FROM column_automations WHERE id = ?')
      .get('a-old') as { applies_to: string };
    expect(automation.applies_to).toBe('regular');
    expect(indexSql(database, 'idx_column_automations_name')).toContain('applies_to');
  });
});

describe('OpenSpec repository round-trip', () => {
  function setup() {
    const database = openDatabase();
    runProjectMigrations(database);
    const lanes = new SwimlaneRepository(database);
    const tasks = new TaskRepository(database);
    const automations = new AutomationRepository(database);
    const todo = lanes.list().find((lane) => lane.role === 'todo');
    if (!todo) throw new Error('expected a To Do column in the seeded board');
    const column = lanes.list().find((lane) => lane.role === null);
    if (!column) throw new Error('expected a non-role column in the seeded board');
    return { tasks, automations, todoId: todo.id, columnId: column.id };
  }

  it('creates defaults, persists an OpenSpec change card, and finds it by directory name', () => {
    const { tasks, todoId } = setup();

    const regular = tasks.create({ title: 'Bug', description: '', swimlane_id: todoId });
    expect(regular.card_kind).toBe('regular');
    expect(regular.task_intent).toBe('work');
    expect(tasks.getByOpenspecChange('add-rate-limiting')).toBeUndefined();

    const discuss = tasks.create({
      title: 'Explore',
      description: '',
      swimlane_id: todoId,
      task_intent: 'discuss',
    });
    expect(discuss.card_kind).toBe('regular');
    expect(discuss.task_intent).toBe('discuss');

    const change = tasks.create({
      title: 'Add rate limiting',
      description: '',
      swimlane_id: todoId,
      card_kind: 'change',
      openspec_change: 'add-rate-limiting',
      openspec_note: 'ready',
      externalSource: 'openspec',
      externalId: 'add-rate-limiting',
    });
    expect(change.card_kind).toBe('change');
    expect(change.openspec_change).toBe('add-rate-limiting');
    expect(change.external_source).toBe('openspec');
    expect(change.external_id).toBe('add-rate-limiting');

    const found = tasks.getByOpenspecChange('add-rate-limiting');
    expect(found?.id).toBe(change.id);

    const updated = tasks.update({ id: change.id, openspec_note: 'tasks:3/12' });
    expect(updated.openspec_note).toBe('tasks:3/12');
    expect(tasks.getById(change.id)?.openspec_note).toBe('tasks:3/12');
  });

  it('stores both automation lists and filters getForTrigger by appliesTo', () => {
    const { automations, columnId } = setup();
    automations.replaceForColumn(columnId, [
      {
        name: 'Start',
        type: 'notify',
        trigger: 'enter',
        enabled: true,
        config: {},
        final_line: null,
      },
      {
        name: 'Start',
        type: 'notify',
        trigger: 'enter',
        enabled: true,
        config: {},
        final_line: null,
        applies_to: 'change',
      },
    ]);

    expect(automations.getForTrigger(columnId, 'enter').map((row) => row.applies_to)).toEqual(['regular']);
    expect(automations.getForTrigger(columnId, 'enter', 'change').map((row) => row.name)).toEqual(['Start']);
    expect(automations.listForColumn(columnId).map((row) => row.applies_to).sort()).toEqual(['change', 'regular']);
  });
});
