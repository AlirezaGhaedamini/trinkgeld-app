import type { Language } from '@/types';

/**
 * The legal texts behind #/imprint and #/privacy.
 *
 * Kept here rather than in src/i18n/strings.ts on purpose. strings.ts ships in
 * the main bundle to every signed-in user on every screen; these texts are long,
 * change only on legal review, and are read on two public pages. This module is
 * imported by LegalPage only, so it rides in that page's lazy chunk. It is still
 * keyed by the app's own `Language` and chosen through useI18n(), so there is one
 * language switch and one source of the current language — not a second system.
 *
 * The German text is authoritative; the English one is a convenience
 * translation and says so. Every fact below was supplied by the operator for
 * this purpose. Nothing may be added here that the operator has not confirmed:
 * no legal form, register entry, VAT ID, phone number or DPO exists for TipCrew.
 *
 * Email addresses inside a text are turned into mailto links when rendered, so
 * they are written as plain text here.
 */

export type LegalBlock =
  | { kind: 'p'; text: string }
  | { kind: 'lines'; lines: string[] }
  | { kind: 'address'; lines: string[] }
  | { kind: 'list'; items: string[] };

export interface LegalSection {
  heading: string;
  blocks: LegalBlock[];
}

export interface LegalDocument {
  title: string;
  /** "Stand: …" / "Last updated: …" */
  updated: string;
  sections: LegalSection[];
  /** Closing paragraphs after the last section. */
  closing?: LegalBlock[];
}

export type LegalKind = 'imprint' | 'privacy';

const OPERATOR_ADDRESS_DE = [
  'Alireza Ghaedamini Harouni',
  'Gutenbergstraße 31',
  '35037 Marburg',
  'Deutschland',
];

const OPERATOR_ADDRESS_EN = [
  'Alireza Ghaedamini Harouni',
  'Gutenbergstraße 31',
  '35037 Marburg',
  'Germany',
];

const IMPRINT: Record<Language, LegalDocument> = {
  Deutsch: {
    title: 'Impressum',
    updated: 'Stand: 18. Oktober 2026',
    sections: [
      {
        heading: 'Angaben gemäß § 5 DDG',
        blocks: [
          { kind: 'lines', lines: ['TipCrew', 'Studentisches Projekt'] },
          { kind: 'p', text: 'Betreiber:' },
          { kind: 'address', lines: OPERATOR_ADDRESS_DE },
        ],
      },
      {
        heading: 'Kontakt',
        blocks: [
          { kind: 'lines', lines: ['E-Mail: info@tipcrew.de', 'Support: support@tipcrew.de'] },
        ],
      },
    ],
    closing: [
      {
        kind: 'p',
        text: 'TipCrew wird derzeit als studentisches Projekt von Alireza Ghaedamini Harouni betrieben.',
      },
    ],
  },
  English: {
    title: 'Imprint',
    updated: 'Last updated: 18 October 2026',
    sections: [
      {
        // Convenience translation of the authoritative German heading.
        heading: 'Information pursuant to § 5 DDG',
        blocks: [
          { kind: 'lines', lines: ['TipCrew', 'Student project'] },
          { kind: 'p', text: 'Operator:' },
          { kind: 'address', lines: OPERATOR_ADDRESS_EN },
        ],
      },
      {
        heading: 'Contact',
        blocks: [
          { kind: 'lines', lines: ['Email: info@tipcrew.de', 'Support: support@tipcrew.de'] },
        ],
      },
    ],
    closing: [
      {
        kind: 'p',
        text: 'TipCrew is currently operated as a student project by Alireza Ghaedamini Harouni.',
      },
    ],
  },
};

/**
 * The privacy policy, as approved by the operator on 18 October 2026.
 *
 * Taken over verbatim from the approved draft with one kind of edit only: the
 * draft carried source labels after some sentences ("Vercel", "Supabase",
 * "resend.com", "Gesetze im Internet", "Eur-Lex", "datenschutz.hessen.de") —
 * citation markers from where it was researched, not part of the text — and
 * those are left out, and so is one sentence in German section 14 that was an
 * author's note rather than policy text. The English version is a translation
 * of the German one and carries the same substance, section by section; where
 * the approved English draft left out a German sentence, the translation was
 * added so the two do not differ in what they say.
 *
 * Facts in here that the code can confirm were checked against it: hosting on
 * Vercel, Supabase in eu-central-1, IONOS for inbound mail (public MX records,
 * mailboxes confirmed by the operator), Resend for invitation mail
 * (supabase/functions/send-invitation), invitation tokens stored only as a
 * SHA-256 hash with an expiry (migration 7), browser storage limited to
 * session, language, invitation/return and workplace-selection keys, and no
 * analytics, advertising, error-reporting or embedded third-party content.
 */
const PRIVACY: Record<Language, LegalDocument> = {
  Deutsch: {
    title: 'Datenschutzerklärung',
    updated: 'Stand: 18. Oktober 2026',
    sections: [
      {
        heading: '1. Verantwortlicher',
        blocks: [
          {
            kind: 'p',
            text: 'Verantwortlicher für die Verarbeitung personenbezogener Daten im Zusammenhang mit TipCrew ist:',
          },
          {
            kind: 'address',
            lines: [
              'Alireza Ghaedamini Harouni',
              'TipCrew – studentisches Projekt',
              'Gutenbergstraße 31',
              '35037 Marburg',
              'Deutschland',
            ],
          },
          { kind: 'lines', lines: ['E-Mail: info@tipcrew.de', 'Support: support@tipcrew.de'] },
        ],
      },
      {
        heading: '2. Wofür diese Datenschutzerklärung gilt',
        blocks: [
          {
            kind: 'p',
            text: 'Diese Datenschutzerklärung gilt für die öffentliche Website unter tipcrew.de sowie für die TipCrew-Webanwendung.',
          },
          {
            kind: 'p',
            text: 'TipCrew unterstützt Gastronomiebetriebe und deren Teams bei der Verwaltung von Arbeitszeiten, Teammitgliedschaften und der Verteilung von Trinkgeldern.',
          },
          {
            kind: 'p',
            text: 'Je nach Nutzung können insbesondere folgende personenbezogene Daten verarbeitet werden:',
          },
          {
            kind: 'p',
            text: 'Name, E-Mail-Adresse, Kontodaten und Authentifizierungsinformationen, Arbeitsplatz- und Teamzugehörigkeiten, Bereiche und Rollen, Einladungsinformationen, Arbeitszeiten, Beginn und Ende von Schichten, Pausen, Freigabe- und Ablehnungsstatus, gegebenenfalls dazugehörige Hinweise, Trinkgeldpools, Verteilungsdaten, persönliche Trinkgeldanteile, historische Verteilungen sowie technische Sicherheits- und Protokolldaten.',
          },
        ],
      },
      {
        heading: '3. Aufruf der Website und Hosting',
        blocks: [
          { kind: 'p', text: 'Die Website wird über Vercel bereitgestellt.' },
          {
            kind: 'p',
            text: 'Beim Aufruf der Website können technisch erforderliche Daten verarbeitet werden, insbesondere IP-Adresse, Zeitpunkt des Zugriffs, aufgerufene Inhalte, Browser- und Geräteinformationen sowie technische Protokoll- und Fehlerdaten.',
          },
          {
            kind: 'p',
            text: 'Die Verarbeitung erfolgt, soweit erforderlich, zur sicheren, zuverlässigen und performanten Bereitstellung der Website auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse besteht im sicheren und störungsfreien Betrieb von TipCrew.',
          },
          {
            kind: 'p',
            text: 'Hosting-Dienstleister ist Vercel Inc. Vercel setzt für seine Dienste Unterauftragnehmer ein und sieht für einschlägige internationale Datentransfers Datenschutzmechanismen einschließlich der EU-Standardvertragsklauseln vor.',
          },
        ],
      },
      {
        heading: '4. TipCrew-Konto und Nutzung der Anwendung',
        blocks: [
          { kind: 'p', text: 'Für die Nutzung bestimmter Funktionen kann ein TipCrew-Konto erforderlich sein.' },
          {
            kind: 'p',
            text: 'Dabei werden insbesondere Name, E-Mail-Adresse, Authentifizierungsdaten, Arbeitsplatzmitgliedschaften, Rollen, Bereiche und weitere für die Nutzung von TipCrew erforderliche Informationen verarbeitet.',
          },
          {
            kind: 'p',
            text: 'Die Verarbeitung erfolgt insbesondere zur Bereitstellung des Nutzerkontos und der gewünschten TipCrew-Funktionen auf Grundlage von Art. 6 Abs. 1 lit. b DSGVO sowie, soweit erforderlich, auf Grundlage unseres berechtigten Interesses an einem sicheren und nachvollziehbaren Betrieb gemäß Art. 6 Abs. 1 lit. f DSGVO.',
          },
          {
            kind: 'p',
            text: 'Passwörter werden über den eingesetzten Authentifizierungsdienst verarbeitet. TipCrew speichert Passwörter nicht im Klartext.',
          },
        ],
      },
      {
        heading: '5. Datenbank und Authentifizierung über Supabase',
        blocks: [
          {
            kind: 'p',
            text: 'TipCrew verwendet Supabase für Datenbank-, Authentifizierungs- und Backend-Funktionen.',
          },
          {
            kind: 'p',
            text: 'Das TipCrew-Projekt verwendet derzeit die Region Central EU (Frankfurt / eu-central-1). Supabase gibt an, dass Datenbank, Auth-Dienst, Storage und Backups grundsätzlich in der ausgewählten Projektregion betrieben werden. Bestimmte begrenzte Verarbeitungsvorgänge können jedoch außerhalb dieser Region stattfinden.',
          },
          {
            kind: 'p',
            text: 'Supabase verarbeitet Kundendaten grundsätzlich als Auftragsverarbeiter. Die aktuelle Supabase-Datenschutzvereinbarung sieht außerdem Schutzmechanismen für internationale Übermittlungen, einschließlich EU-Standardvertragsklauseln, vor.',
          },
        ],
      },
      {
        heading: '6. Arbeitszeiten und Trinkgeldverteilung',
        blocks: [
          {
            kind: 'p',
            text: 'TipCrew kann Informationen über Arbeitszeiten, Schichten, Pausen, Rollen, Bereiche und Trinkgeldverteilungen verarbeiten.',
          },
          {
            kind: 'p',
            text: 'Diese Daten werden verwendet, um die vom jeweiligen Arbeitsplatz festgelegten Regeln anzuwenden, Verteilungen zu berechnen, Ergebnisse darzustellen und historische Vorgänge nachvollziehbar zu halten.',
          },
          {
            kind: 'p',
            text: 'Je nach konkreter Nutzung kann der jeweilige Arbeitsplatz selbst für bestimmte Verarbeitungen von Beschäftigtendaten datenschutzrechtlich verantwortlich sein. Informationen über die Verarbeitung von Beschäftigtendaten durch einen Arbeitgeber oder Arbeitsplatz können deshalb zusätzlich dessen eigener Datenschutzerklärung unterliegen.',
          },
        ],
      },
      {
        heading: '7. Einladungen zu einem Arbeitsplatz',
        blocks: [
          { kind: 'p', text: 'Ein Manager kann eine Person zu einem TipCrew-Arbeitsplatz einladen.' },
          {
            kind: 'p',
            text: 'Dafür können vor der Registrierung insbesondere Name, E-Mail-Adresse, vorgesehener Bereich und vorgesehene Rolle verarbeitet werden.',
          },
          {
            kind: 'p',
            text: 'Diese Angaben werden verwendet, um die Einladung bereitzustellen und den Beitritt zum entsprechenden Arbeitsplatz vorzubereiten.',
          },
          {
            kind: 'p',
            text: 'Persönliche Einladungslinks verwenden einmalige bzw. zeitlich begrenzte Einladungsinformationen. Sicherheitsrelevante Token werden serverseitig nicht im Klartext als wiederverwendbare Einladung gespeichert.',
          },
        ],
      },
      {
        heading: '8. E-Mail-Versand',
        blocks: [
          {
            kind: 'p',
            text: 'TipCrew verwendet Resend für transaktionale E-Mails, beispielsweise Einladungen, Registrierungsbestätigungen und Passwort-Zurücksetzungen.',
          },
          {
            kind: 'p',
            text: 'Hierbei können insbesondere E-Mail-Adresse, Absender- und Empfängerinformationen, Versandzeitpunkt sowie technisch erforderliche Zustellinformationen verarbeitet werden.',
          },
          {
            kind: 'p',
            text: 'Resend sieht in seinem Data Processing Addendum Regelungen für Unterauftragsverarbeiter und internationale Übermittlungen einschließlich EU-Standardvertragsklauseln vor.',
          },
          {
            kind: 'p',
            text: 'Die Verarbeitung erfolgt zur Durchführung der angeforderten Account- und Anwendungsfunktionen gemäß Art. 6 Abs. 1 lit. b DSGVO sowie zur zuverlässigen und sicheren Zustellung auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO.',
          },
        ],
      },
      {
        heading: '9. Kontaktaufnahme',
        blocks: [
          {
            kind: 'p',
            text: 'Wenn Sie uns über info@tipcrew.de oder support@tipcrew.de kontaktieren, verarbeiten wir die von Ihnen übermittelten Daten, insbesondere Ihre E-Mail-Adresse, den Inhalt Ihrer Nachricht und gegebenenfalls weitere von Ihnen bereitgestellte Informationen.',
          },
          {
            kind: 'p',
            text: 'Die Verarbeitung erfolgt zur Bearbeitung Ihrer Anfrage. Je nach Inhalt beruht sie auf Art. 6 Abs. 1 lit. b DSGVO oder Art. 6 Abs. 1 lit. f DSGVO.',
          },
          {
            kind: 'p',
            text: 'Für den Empfang von E-Mails an unsere @tipcrew.de-Adressen nutzen wir Dienste von IONOS.',
          },
        ],
      },
      {
        heading: '10. Browser-Speicher und technisch notwendige Informationen',
        blocks: [
          {
            kind: 'p',
            text: 'TipCrew verwendet technisch erforderliche Browser-Speichermechanismen, beispielsweise für die Anmeldung, Spracheinstellungen und bestimmte Authentifizierungs-, Einladungs- oder Weiterleitungsabläufe.',
          },
          {
            kind: 'p',
            text: 'Diese Funktionen sind erforderlich, damit die vom Nutzer ausdrücklich gewünschte Anwendung technisch bereitgestellt werden kann.',
          },
          {
            kind: 'p',
            text: 'Derzeit verwendet TipCrew keine Werbe- oder Analyse-Tracker und kein Marketing-Tracking.',
          },
          {
            kind: 'p',
            text: 'Für technisch unbedingt erforderliche Speicherung bzw. Zugriffe auf Informationen im Endgerät sieht § 25 Abs. 2 TDDDG eine Ausnahme von der Einwilligungspflicht vor.',
          },
          {
            kind: 'p',
            text: 'Sollten künftig Analyse-, Marketing- oder andere nicht erforderliche Technologien eingesetzt werden, wird diese Datenschutzerklärung entsprechend aktualisiert und erforderlichenfalls zuvor eine Einwilligung eingeholt.',
          },
        ],
      },
      {
        heading: '11. Empfänger und Dienstleister',
        blocks: [
          {
            kind: 'p',
            text: 'Zur technischen Bereitstellung von TipCrew setzen wir insbesondere folgende Dienstleister ein:',
          },
          {
            kind: 'list',
            items: [
              'Vercel – Hosting und Bereitstellung der Webanwendung',
              'Supabase – Datenbank, Authentifizierung und Backend-Infrastruktur',
              'Resend – transaktionaler E-Mail-Versand',
              'IONOS – E-Mail-Empfang für @tipcrew.de-Adressen',
            ],
          },
          {
            kind: 'p',
            text: 'Dienstleister erhalten personenbezogene Daten nur soweit dies zur Erbringung ihrer jeweiligen Leistungen erforderlich ist.',
          },
        ],
      },
      {
        heading: '12. Verarbeitung außerhalb des Europäischen Wirtschaftsraums',
        blocks: [
          {
            kind: 'p',
            text: 'Bei einzelnen eingesetzten Dienstleistern kann eine Verarbeitung personenbezogener Daten außerhalb des Europäischen Wirtschaftsraums stattfinden.',
          },
          {
            kind: 'p',
            text: 'Soweit hierfür kein Angemessenheitsbeschluss besteht, werden nach Angaben der jeweiligen Anbieter geeignete Garantien wie die von der Europäischen Kommission verabschiedeten Standardvertragsklauseln eingesetzt. Supabase, Vercel und Resend dokumentieren entsprechende Transfermechanismen in ihren Datenschutzunterlagen.',
          },
        ],
      },
      {
        heading: '13. Speicherdauer',
        blocks: [
          {
            kind: 'p',
            text: 'Personenbezogene Daten werden grundsätzlich nur so lange gespeichert, wie dies für den jeweiligen Verarbeitungszweck erforderlich ist.',
          },
          {
            kind: 'p',
            text: 'Kontodaten und Arbeitsplatzdaten können für die Dauer des Nutzerkontos beziehungsweise der jeweiligen Mitgliedschaft verarbeitet werden.',
          },
          {
            kind: 'p',
            text: 'Bestimmte historische Verteilungs-, Abrechnungs-, Sicherheits- oder Nachweisdaten können länger gespeichert werden, soweit dies zur nachvollziehbaren Darstellung früherer Vorgänge, zur Abwehr oder Durchsetzung von Ansprüchen oder aufgrund gesetzlicher Aufbewahrungspflichten erforderlich ist.',
          },
          {
            kind: 'p',
            text: 'Technische Protokolldaten werden entsprechend der jeweiligen technischen Konfiguration und nur so lange gespeichert, wie sie für Betrieb, Fehleranalyse und Sicherheit erforderlich sind.',
          },
          {
            kind: 'p',
            text: 'Wenn gesetzliche Aufbewahrungspflichten bestehen, erfolgt die Löschung nach Ablauf dieser Fristen.',
          },
        ],
      },
      {
        heading: '14. Rechtsgrundlagen',
        blocks: [
          { kind: 'p', text: 'Je nach Verarbeitung stützen wir uns insbesondere auf:' },
          {
            kind: 'list',
            items: [
              'Art. 6 Abs. 1 lit. b DSGVO – Durchführung eines Vertrags oder vorvertraglicher Maßnahmen;',
              'Art. 6 Abs. 1 lit. f DSGVO – berechtigte Interessen, insbesondere sicherer Betrieb, Missbrauchsprävention, technische Bereitstellung und Bearbeitung von Anfragen;',
              'Art. 6 Abs. 1 lit. c DSGVO – Erfüllung rechtlicher Verpflichtungen, soweit einschlägig;',
              'Art. 6 Abs. 1 lit. a DSGVO – Einwilligung, sofern eine Verarbeitung ausdrücklich auf einer Einwilligung beruht.',
            ],
          },
        ],
      },
      {
        heading: '15. Ihre Rechte',
        blocks: [
          {
            kind: 'p',
            text: 'Im Rahmen der gesetzlichen Voraussetzungen haben Sie insbesondere das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung und Datenübertragbarkeit.',
          },
          {
            kind: 'p',
            text: 'Soweit eine Verarbeitung auf Art. 6 Abs. 1 lit. f DSGVO beruht, können Sie unter den gesetzlichen Voraussetzungen Widerspruch gegen die Verarbeitung einlegen.',
          },
          {
            kind: 'p',
            text: 'Eine erteilte Einwilligung kann jederzeit mit Wirkung für die Zukunft widerrufen werden.',
          },
          {
            kind: 'p',
            text: 'Zur Ausübung Ihrer Rechte können Sie uns unter info@tipcrew.de kontaktieren.',
          },
        ],
      },
      {
        heading: '16. Beschwerderecht',
        blocks: [
          {
            kind: 'p',
            text: 'Sie haben das Recht, sich bei einer Datenschutzaufsichtsbehörde zu beschweren.',
          },
          {
            kind: 'p',
            text: 'Für einen Verantwortlichen mit Sitz in Hessen ist insbesondere zuständig:',
          },
          {
            kind: 'address',
            lines: [
              'Der Hessische Beauftragte für Datenschutz und Informationsfreiheit',
              'Wilhelmstraße 7',
              '65185 Wiesbaden',
              'Deutschland',
            ],
          },
          { kind: 'lines', lines: ['E-Mail: poststelle@datenschutz.hessen.de'] },
          {
            kind: 'p',
            text: 'Die Behörde ist für nicht öffentliche Stellen mit Sitz in Hessen zuständig.',
          },
        ],
      },
      {
        heading: '17. Änderungen dieser Datenschutzerklärung',
        blocks: [
          {
            kind: 'p',
            text: 'Wir können diese Datenschutzerklärung anpassen, wenn sich TipCrew, eingesetzte Dienste oder rechtliche Anforderungen ändern. Die jeweils aktuelle Fassung wird auf tipcrew.de veröffentlicht.',
          },
        ],
      },
    ],
  },
  English: {
    title: 'Privacy Policy',
    updated: 'Last updated: 18 October 2026',
    sections: [
      {
        heading: '1. Controller',
        blocks: [
          {
            kind: 'p',
            text: 'The controller responsible for the processing of personal data in connection with TipCrew is:',
          },
          {
            kind: 'address',
            lines: [
              'Alireza Ghaedamini Harouni',
              'TipCrew – student project',
              'Gutenbergstraße 31',
              '35037 Marburg',
              'Germany',
            ],
          },
          { kind: 'lines', lines: ['Email: info@tipcrew.de', 'Support: support@tipcrew.de'] },
        ],
      },
      {
        heading: '2. Scope and data processed',
        blocks: [
          {
            kind: 'p',
            text: 'This Privacy Policy applies to the public website at tipcrew.de and the TipCrew web application.',
          },
          {
            kind: 'p',
            text: 'TipCrew helps hospitality workplaces and their teams manage working-time information, workplace memberships and tip distributions.',
          },
          {
            kind: 'p',
            text: 'Depending on how TipCrew is used, personal data may include your name, email address, account and authentication information, workplace memberships, areas and roles, invitation information, working hours, shift start and end times, breaks, approval or rejection information, related notes, tip pools, distribution information, individual tip shares, historical distributions and technical security or log data.',
          },
        ],
      },
      {
        heading: '3. Website hosting',
        blocks: [
          { kind: 'p', text: 'TipCrew is hosted using Vercel.' },
          {
            kind: 'p',
            text: 'When the website is accessed, technically necessary data may be processed, such as IP address, access time, requested resources, browser/device information and technical log or error information.',
          },
          {
            kind: 'p',
            text: 'This processing is carried out where necessary on the basis of Art. 6(1)(f) GDPR for the secure, reliable and efficient operation of TipCrew. Our legitimate interest lies in the secure and uninterrupted operation of TipCrew.',
          },
          {
            kind: 'p',
            text: 'The hosting provider is Vercel Inc. Vercel uses subprocessors for its services and provides data-protection mechanisms, including the EU Standard Contractual Clauses, for relevant international data transfers.',
          },
        ],
      },
      {
        heading: '4. Accounts and use of TipCrew',
        blocks: [
          { kind: 'p', text: 'A TipCrew account may be required to use certain functions.' },
          {
            kind: 'p',
            text: 'We may process information such as name, email address, authentication information, workplace memberships, roles, areas and other information required to provide the TipCrew service.',
          },
          {
            kind: 'p',
            text: 'Processing is based in particular on Art. 6(1)(b) GDPR for providing the user account and the requested TipCrew functions and, where necessary, on our legitimate interest in secure and traceable operation under Art. 6(1)(f) GDPR.',
          },
          {
            kind: 'p',
            text: 'Passwords are handled through the authentication service and are not stored by TipCrew in plain text.',
          },
        ],
      },
      {
        heading: '5. Supabase',
        blocks: [
          {
            kind: 'p',
            text: 'TipCrew uses Supabase for database, authentication and backend functionality.',
          },
          {
            kind: 'p',
            text: 'The TipCrew project currently uses the Central EU (Frankfurt / eu-central-1) region. Supabase states that the primary database, Auth service, Storage objects and backups are hosted in the selected project region, while certain limited processing may occur outside that region.',
          },
          {
            kind: 'p',
            text: 'Supabase generally acts as a processor for customer data, and its current DPA includes safeguards for relevant international transfers, including the EU Standard Contractual Clauses.',
          },
        ],
      },
      {
        heading: '6. Working-time and tip-distribution data',
        blocks: [
          {
            kind: 'p',
            text: 'TipCrew may process working hours, shifts, breaks, roles, workplace areas and tip-distribution information.',
          },
          {
            kind: 'p',
            text: 'These data are used to apply the rules configured for the relevant workplace, calculate distributions, display results and preserve historical records.',
          },
          {
            kind: 'p',
            text: "Depending on the specific workplace relationship, the workplace using TipCrew may itself be responsible for certain employee-related processing. Such processing may therefore also be subject to the workplace's own privacy information.",
          },
        ],
      },
      {
        heading: '7. Workplace invitations',
        blocks: [
          { kind: 'p', text: 'A manager may invite a person to join a TipCrew workplace.' },
          {
            kind: 'p',
            text: "Before registration, this may involve processing the invitee's name, email address, intended area and intended role.",
          },
          {
            kind: 'p',
            text: 'These data are used to deliver the invitation and prepare the relevant workplace membership.',
          },
          {
            kind: 'p',
            text: 'Personal invitation links use single-use or time-limited invitation information. Security-relevant tokens are not stored on the server in plain text as a reusable invitation.',
          },
        ],
      },
      {
        heading: '8. Transactional emails',
        blocks: [
          {
            kind: 'p',
            text: 'TipCrew uses Resend to send transactional emails such as workplace invitations, registration confirmations and password-reset messages.',
          },
          {
            kind: 'p',
            text: 'This may involve processing email addresses, sender/recipient information, timestamps and technical delivery information.',
          },
          {
            kind: 'p',
            text: "Resend's Data Processing Addendum provides terms regarding subprocessors and international transfers, including EU Standard Contractual Clauses.",
          },
          {
            kind: 'p',
            text: 'This processing is carried out to perform the requested account and application functions under Art. 6(1)(b) GDPR and, for reliable and secure delivery, on the basis of Art. 6(1)(f) GDPR.',
          },
        ],
      },
      {
        heading: '9. Contact',
        blocks: [
          {
            kind: 'p',
            text: 'If you contact us at info@tipcrew.de or support@tipcrew.de, we process the information you provide, including your email address, message and any additional information voluntarily supplied.',
          },
          {
            kind: 'p',
            text: 'This is processed to respond to your request under Art. 6(1)(b) or Art. 6(1)(f) GDPR, depending on the nature of the request.',
          },
          {
            kind: 'p',
            text: 'We use IONOS to receive email sent to our @tipcrew.de addresses.',
          },
        ],
      },
      {
        heading: '10. Browser storage',
        blocks: [
          {
            kind: 'p',
            text: 'TipCrew uses technically necessary browser-storage mechanisms, for example for signing in, language settings and certain authentication, invitation or redirect flows.',
          },
          {
            kind: 'p',
            text: 'These functions are required so that the application expressly requested by the user can be provided technically.',
          },
          {
            kind: 'p',
            text: 'TipCrew currently does not use advertising or analytics trackers or any marketing tracking.',
          },
          {
            kind: 'p',
            text: 'For storing or accessing information on a device where this is strictly necessary, § 25(2) of the German TDDDG provides an exemption from the consent requirement.',
          },
          {
            kind: 'p',
            text: 'If analytics, marketing or other non-essential technologies are used in the future, this Privacy Policy will be updated accordingly and, where required, consent will be obtained beforehand.',
          },
        ],
      },
      {
        heading: '11. Service providers',
        blocks: [
          {
            kind: 'p',
            text: 'To provide TipCrew technically, we use in particular the following service providers:',
          },
          {
            kind: 'list',
            items: [
              'Vercel – website hosting and delivery',
              'Supabase – database, authentication and backend infrastructure',
              'Resend – transactional email delivery',
              'IONOS – inbound email for @tipcrew.de addresses',
            ],
          },
          {
            kind: 'p',
            text: 'Personal data is provided to these service providers only to the extent required to provide their respective services.',
          },
        ],
      },
      {
        heading: '12. International data transfers',
        blocks: [
          {
            kind: 'p',
            text: "Some of TipCrew's service providers may process personal data outside the European Economic Area.",
          },
          {
            kind: 'p',
            text: "Where no adequacy decision applies, appropriate safeguards such as the Standard Contractual Clauses adopted by the European Commission are used, according to the respective providers. Supabase, Vercel and Resend document the relevant transfer mechanisms in their data-protection documentation.",
          },
        ],
      },
      {
        heading: '13. Retention',
        blocks: [
          {
            kind: 'p',
            text: 'Personal data is retained only for as long as necessary for the relevant processing purpose.',
          },
          {
            kind: 'p',
            text: 'Account and workplace data may be retained for the duration of the relevant account or membership.',
          },
          {
            kind: 'p',
            text: 'Certain historical distribution, settlement, security or evidentiary records may be retained for a longer period where necessary to preserve historical accuracy, establish or defend legal claims, or comply with statutory retention obligations.',
          },
          {
            kind: 'p',
            text: 'Technical logs are retained according to the relevant technical configuration and only for as long as required for operation, troubleshooting and security.',
          },
          {
            kind: 'p',
            text: 'Where statutory retention obligations apply, data is deleted once those periods have expired.',
          },
        ],
      },
      {
        heading: '14. Legal bases',
        blocks: [
          { kind: 'p', text: 'Depending on the processing activity, we rely in particular on:' },
          {
            kind: 'list',
            items: [
              'Art. 6(1)(b) GDPR – performance of a contract or pre-contractual measures;',
              'Art. 6(1)(f) GDPR – legitimate interests, in particular secure operation, prevention of misuse, technical provision and handling of enquiries;',
              'Art. 6(1)(c) GDPR – compliance with legal obligations, where applicable;',
              'Art. 6(1)(a) GDPR – consent, where processing is expressly based on consent.',
            ],
          },
        ],
      },
      {
        heading: '15. Your rights',
        blocks: [
          {
            kind: 'p',
            text: 'Subject to the applicable legal requirements, you may have rights including access, rectification, erasure, restriction of processing and data portability.',
          },
          {
            kind: 'p',
            text: 'Where processing is based on legitimate interests, you may also have a right to object.',
          },
          { kind: 'p', text: 'Consent can be withdrawn at any time with effect for the future.' },
          { kind: 'p', text: 'To exercise your rights, contact info@tipcrew.de.' },
        ],
      },
      {
        heading: '16. Complaints',
        blocks: [
          {
            kind: 'p',
            text: 'You have the right to lodge a complaint with a competent data-protection supervisory authority.',
          },
          {
            kind: 'p',
            text: 'For a controller established in Hesse, the competent authority is generally:',
          },
          {
            kind: 'address',
            lines: [
              'The Hessian Commissioner for Data Protection and Freedom of Information',
              'Wilhelmstraße 7',
              '65185 Wiesbaden',
              'Germany',
            ],
          },
          { kind: 'lines', lines: ['Email: poststelle@datenschutz.hessen.de'] },
          {
            kind: 'p',
            text: 'The authority is responsible for non-public bodies established in Hesse.',
          },
        ],
      },
      {
        heading: '17. Changes to this Privacy Policy',
        blocks: [
          {
            kind: 'p',
            text: 'We may update this Privacy Policy if TipCrew, the services we use or applicable legal requirements change. The current version will be made available on tipcrew.de.',
          },
        ],
      },
    ],
  },
};

const DOCUMENTS: Record<LegalKind, Record<Language, LegalDocument>> = {
  imprint: IMPRINT,
  privacy: PRIVACY,
};

export function legalDocument(kind: LegalKind, language: Language): LegalDocument {
  return DOCUMENTS[kind][language];
}

/** Shown on every English legal page, under the title. */
export const CONVENIENCE_NOTE_EN =
  'The English version is provided for convenience. The German version is authoritative.';
