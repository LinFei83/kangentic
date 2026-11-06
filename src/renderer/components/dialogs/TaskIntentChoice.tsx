import { useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/runtime-macro';
import { ChoiceCard } from '../ChoiceCard';
import { cachePerCatalogBy } from '../../i18n/catalog-cache';
import { translateText } from '../../i18n/translate';
import type { SegmentedControlOption } from '../SegmentedControl';
import type { TaskIntent } from '../../../shared/types';

interface TaskIntentChoiceProps {
  value: TaskIntent;
  onChange: (value: TaskIntent) => void;
  /**
   * Segmented-control test id. Option ids are `${testId}-work` and
   * `${testId}-discuss`, so New Task keeps `new-task-intent` and the edit
   * form uses `task-intent`.
   */
  testId: string;
}

/**
 * Work / Discuss as a ChoiceCard: title and one-line description on the left,
 * the two options on the right. Shared by New Task and the To Do edit form so
 * the copy and the row cannot drift. Cached until the catalog changes:
 * `SegmentedControl` keys its measuring effect on the `options` array, so a
 * fresh array per keystroke in the title would re-measure the thumb.
 */
const TASK_INTENT_OPTIONS = cachePerCatalogBy((testId: string): readonly SegmentedControlOption<TaskIntent>[] => [
  {
    value: 'work',
    label: translateText(msg({ message: 'Work', context: 'task intent' })),
    tip: translateText(msg`Implement on the current board path. No OpenSpec change.`),
    testId: `${testId}-work`,
  },
  {
    value: 'discuss',
    label: translateText(msg({ message: 'Discuss', context: 'task intent' })),
    tip: translateText(msg`Explore first. The agent opens with /opsx-explore. Propose the change yourself when the discussion is enough.`),
    testId: `${testId}-discuss`,
  },
]);

export function TaskIntentChoice({ value, onChange, testId }: TaskIntentChoiceProps) {
  const { t } = useLingui();
  return (
    <ChoiceCard
      label={t`How this task starts`}
      description={t`Work implements on the board path, and Discuss explores first with /opsx-explore.`}
      info={t`Work starts the agent on this board with no OpenSpec change. Discuss opens with /opsx-explore so you can talk the change through first, then propose it yourself when the discussion is enough.`}
      options={TASK_INTENT_OPTIONS(testId)}
      value={value}
      onChange={onChange}
      testId={testId}
    />
  );
}
