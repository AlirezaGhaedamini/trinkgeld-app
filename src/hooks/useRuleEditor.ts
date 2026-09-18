import { useContext } from 'react';
import { RuleEditorContext, type RuleEditorValue } from '@/rules/ruleEditorContext';

/**
 * The Settings area's shared rules editor. Only available beneath
 * <RuleEditorProvider>, i.e. on the Settings overview and its rule sections.
 */
export function useRuleEditor(): RuleEditorValue {
  const value = useContext(RuleEditorContext);
  if (!value) throw new Error('useRuleEditor must be used inside <RuleEditorProvider>');
  return value;
}
