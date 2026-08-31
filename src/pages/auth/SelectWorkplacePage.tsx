import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Card } from '@/components/ui/Card';
import { ListRow } from '@/components/ui/ListRow';
import { Lede } from '@/components/ui/Note';
import { useI18n } from '@/hooks/useI18n';
import { useWorkplace } from '@/hooks/useWorkplace';
import ui from '@/components/ui/ui.module.css';

/**
 * Pick which workplace to work in.
 *
 * Deliberately the smallest thing that can work: the existing Screen, one
 * existing Card, and the existing ListRow — the same three components the
 * profile settings list is built from. No new stylesheet, no switcher in the
 * chrome, no per-screen workplace menu. Someone with one workplace never sees
 * this screen at all.
 */
export function SelectWorkplacePage() {
  const { t } = useI18n();
  const workplace = useWorkplace();
  const navigate = useNavigate();

  const rows = workplace.memberships;
  const activeId = workplace.activeMembership?.workplaceId ?? null;

  return (
    // Back only makes sense when there is already somewhere to go back to.
    <Screen title={t('wpChoose')} titleSize={26} back={activeId !== null ? 'arrow' : false}>
      <Lede>{t('wpChooseBody')}</Lede>

      <Card padding="none" clip>
        {rows.map((membership) => (
          <ListRow
            key={membership.id}
            inset
            chevron
            strong
            title={membership.workplace.name}
            meta={
              membership.role === 'manager'
                ? `${t('mgrRole')}${membership.workplace.city ? ` · ${membership.workplace.city}` : ''}`
                : `${t('empRole')}${membership.workplace.city ? ` · ${membership.workplace.city}` : ''}`
            }
            metaColor={
              membership.workplaceId === activeId ? 'var(--color-accent)' : undefined
            }
            onClick={() => {
              workplace.setActiveWorkplace(membership.workplaceId);
              navigate(membership.role === 'manager' ? '/manager' : '/home', { replace: true });
            }}
          />
        ))}
      </Card>

      {rows.length === 0 ? <p className={ui.note}>{t('wpNoneYet')}</p> : null}
    </Screen>
  );
}
