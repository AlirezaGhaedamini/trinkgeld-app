import { Fragment, type ReactNode } from 'react';
import { PublicShell } from '@/components/marketing/PublicShell';
import styles from '@/components/marketing/marketing.module.css';
import { useI18n } from '@/hooks/useI18n';
import {
  CONVENIENCE_NOTE_EN,
  legalDocument,
  type LegalBlock,
  type LegalKind,
} from '@/pages/marketing/legalContent';

/**
 * The imprint and privacy policy.
 *
 * One article per page: the h1 is the document title, every section an h2, so
 * the outline is flat and a screen reader can jump between sections. The text
 * itself lives in legalContent.ts.
 *
 * No reveal animation: nobody should have to wait for legal text to fade in.
 */
export function LegalPage({ kind }: { kind: LegalKind }) {
  const { t, language } = useI18n();
  const doc = legalDocument(kind, language);

  return (
    <PublicShell>
      <article className={`${styles.container} ${styles.legalPage}`}>
        <header>
          <p className={styles.kicker}>{t('lgKicker')}</p>
          <h1 className={styles.h2}>{doc.title}</h1>
          <p className={styles.legalUpdated}>{doc.updated}</p>
          {language === 'English' ? (
            <p className={styles.legalNote} lang="en">
              {CONVENIENCE_NOTE_EN}
            </p>
          ) : null}
        </header>
        <div className={styles.legalBody}>
          {doc.sections.map((section) => (
            <section key={section.heading} className={styles.legalSection}>
              <h2 className={styles.legalH2}>{section.heading}</h2>
              {section.blocks.map((block, index) => (
                <Block key={index} block={block} />
              ))}
            </section>
          ))}
          {doc.closing?.map((block, index) => (
            <Block key={`closing-${index}`} block={block} />
          ))}
        </div>
      </article>
    </PublicShell>
  );
}

function Block({ block }: { block: LegalBlock }) {
  switch (block.kind) {
    case 'p':
      return <p>{linkify(block.text)}</p>;
    case 'lines':
      return (
        <p>
          {block.lines.map((line, index) => (
            <Fragment key={index}>
              {index > 0 ? <br /> : null}
              {linkify(line)}
            </Fragment>
          ))}
        </p>
      );
    case 'address':
      return (
        <address className={styles.legalAddress}>
          {block.lines.map((line, index) => (
            <Fragment key={index}>
              {index > 0 ? <br /> : null}
              {line}
            </Fragment>
          ))}
        </address>
      );
    case 'list':
      return (
        <ul className={styles.legalList}>
          {block.items.map((item, index) => (
            <li key={index}>{linkify(item)}</li>
          ))}
        </ul>
      );
  }
}

const EMAIL = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/** Every email address in a legal text becomes a mailto link. */
function linkify(text: string): ReactNode {
  const parts = text.split(EMAIL);
  if (parts.length === 1) return text;
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <a key={index} href={`mailto:${part}`} className={styles.legalLink}>
        {part}
      </a>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
