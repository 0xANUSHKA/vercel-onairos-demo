import Link from "next/link";

export const metadata = {
  title: "Terms & Conditions — inyo",
  description: "The terms that govern your use of inyo's SMS-based matchmaking service.",
};

export default function TermsPage() {
  return (
    <main className="legal-page">
      <header className="legal-topbar">
        <div className="legal-topbar-inner">
          <Link href="/" className="legal-brand">inyo</Link>
          <nav className="legal-nav">
            <Link href="/privacy" className="legal-nav-link">privacy</Link>
            <Link href="/terms" className="legal-nav-link is-active">terms</Link>
            <Link href="/" className="legal-nav-link">back to site →</Link>
          </nav>
        </div>
      </header>

      <div className="legal-container">
        <div className="legal-eyebrow">Legal</div>
        <h1 className="legal-title">Terms &amp; Conditions</h1>
        <p className="legal-meta">
          Effective April 29, 2026 · Last updated April 29, 2026
        </p>

        <article className="legal-article">
          <Section n="" title="Important notice">
            <p className="legal-callout">
              PLEASE READ THESE TERMS CAREFULLY. These Terms include a binding arbitration agreement and class action waiver in Section 16 that affects how disputes are resolved.
            </p>
          </Section>

          <Section n="1" title="Eligibility">
            <ul className="legal-list">
              <li>You must be at least 18 years old.</li>
              <li>You must have legal capacity to enter a binding contract.</li>
              <li>You cannot be barred from receiving services under applicable law.</li>
              <li>You cannot be previously suspended/removed from the Service.</li>
              <li>You must be a resident of, or have local presence in, an area we serve (currently NYC).</li>
              <li>You must provide accurate, current, and complete information.</li>
            </ul>
            <p>We may verify age, identity, and submitted information, and may refuse, suspend, or terminate access for lawful reasons including suspected misrepresentation.</p>
          </Section>

          <Section n="2" title="Description of the Service">
            <p>inyo is an SMS-based matchmaking service. Users onboard via text and receive curated match notifications by SMS. inyo is not a swiping app, social feed, or location-based discovery tool. We do not guarantee any specific match outcome, speed, or relationship result.</p>
            <p>Matching may combine automated processing and human review, and may use anonymized signals including onboarding responses and optional third-party persona data.</p>
          </Section>

          <Section n="3" title="SMS Messaging — Express Written Consent (TCPA)">
            <p>By signing up and providing your phone number, you expressly consent to recurring SMS from inyo under the TCPA and FCC rules, including onboarding, match notifications, service messages, loyalty engine messages, and support replies.</p>
            <ul className="legal-list">
              <li>Message frequency varies by activity and match availability.</li>
              <li>Message and data rates may apply per carrier plans.</li>
              <li>Reply HELP for help, or email <a href="mailto:andy@joininyo.com" className="legal-link">andy@joininyo.com</a>.</li>
              <li>Consent to SMS is required to use this SMS-based Service.</li>
            </ul>
            <p className="legal-callout">
              <strong>Opt-out right:</strong> reply STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, or QUIT at any time. After one confirmation, no further SMS messages of any kind are sent unless you opt back in with START or by signing up again.
            </p>
            <p>Opting out ends active Service use (matching paused and subscription billing suspended). Opting out stops SMS but does not automatically delete stored data; deletion requests can be sent to <a href="mailto:andy@joininyo.com" className="legal-link">andy@joininyo.com</a>. Consent and opt-out records are retained for at least 4 years.</p>
          </Section>

          <Section n="4" title="Your Account and Conduct">
            <p>You agree to provide truthful account/profile details and maintain confidentiality of access to your phone number and account.</p>
            <p>You agree not to misuse the Service, including impersonation, underage use, harassment, scams, soliciting money, posting others' data without consent, using bots/scrapers, attempting to extract source code, or bypassing security restrictions.</p>
            <p>Violations may result in immediate suspension/termination, forfeiture of prepaid fees, and reporting to law enforcement where appropriate.</p>
          </Section>

          <Section n="5" title="Your Content">
            <p>You retain ownership of content you submit (profile information, photos, voice notes, onboarding answers, messages, and feedback), and grant inyo a worldwide, non-exclusive, royalty-free, sublicensable license to use it solely to operate/improve the Service, share with potential matches as described in the Privacy Policy, enforce Terms, and comply with legal obligations.</p>
            <p>You represent that you have rights to submit your content and that it does not violate law or third-party rights.</p>
          </Section>

          <Section n="6" title="Subscriptions, Fees, and Payment">
            <ul className="legal-list">
              <li>Current model: $20/month, billed monthly, beginning after your first inyo-arranged date.</li>
              <li>Pricing may change with at least 30 days notice.</li>
              <li>Payments are processed by Stripe; subscriptions auto-renew unless canceled before renewal.</li>
              <li>You can cancel by replying STOP, emailing <a href="mailto:andy@joininyo.com" className="legal-link">andy@joininyo.com</a>, or via any account portal made available.</li>
              <li>Fees are non-refundable except where required by law.</li>
            </ul>
          </Section>

          <Section n="7" title="Optional Third-Party Integrations (Onairos)">
            <p>Onairos connection is optional. If you opt in, Onairos may process authorized Instagram, TikTok, or ChatGPT data and share resulting personality profile signals with inyo. Onairos use is governed by Onairos terms/privacy at <a href="https://onairos.uk" target="_blank" rel="noopener noreferrer" className="legal-link">onairos.uk</a>.</p>
          </Section>

          <Section n="8" title="Safety, Risks, and Personal Responsibility">
            <p>inyo facilitates introductions and does not guarantee user truthfulness, behavior, or safety outcomes. You are solely responsible for your interactions with other users, including in-person meetings.</p>
            <p>Meet in public places, use your own transportation, avoid sharing financial information, and report unsafe behavior to <a href="mailto:andy@joininyo.com" className="legal-link">andy@joininyo.com</a> and local law enforcement where appropriate.</p>
          </Section>

          <Section n="9" title="inyo Intellectual Property">
            <p>All rights in the Service (software, branding, content, systems) are owned by JOININYO LTD or licensors. You receive a limited, non-exclusive, non-transferable, revocable license for personal, non-commercial use only.</p>
          </Section>

          <Section n="10" title="Suspension and Termination">
            <p>You may terminate at any time by replying STOP and/or requesting account deletion via email. inyo may suspend or terminate access for lawful reasons, including Terms violations, fraud, abuse, risk to users, or legal violations.</p>
          </Section>

          <Section n="11" title="Disclaimers of Warranties">
            <p>THE SERVICE IS PROVIDED ON AN &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; BASIS WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, TO THE FULLEST EXTENT PERMITTED BY LAW.</p>
          </Section>

          <Section n="12" title="Limitation of Liability">
            <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, JOININYO LTD AND RELATED PARTIES ARE NOT LIABLE FOR INDIRECT, INCIDENTAL, CONSEQUENTIAL, SPECIAL, EXEMPLARY, OR PUNITIVE DAMAGES.</p>
            <p>Total aggregate liability is limited to the greater of (a) amounts you paid in the prior 12 months or (b) $100 USD.</p>
          </Section>

          <Section n="13" title="Indemnification">
            <p>You agree to indemnify and hold harmless JOININYO LTD and related parties against claims, damages, losses, liabilities, costs, and expenses arising out of your use of the Service, violation of these Terms/law, your content, or your interactions with others.</p>
          </Section>

          <Section n="14" title="Changes to the Service and These Terms">
            <p>We may modify/suspend/discontinue all or part of the Service and revise these Terms. For material changes, we provide notice by SMS (if not opted out), email, or prominent website notice at least 14 days before the effective date.</p>
          </Section>

          <Section n="15" title="Governing Law">
            <p>These Terms are governed by Delaware law. Subject to arbitration in Section 16, disputes not subject to arbitration are brought exclusively in state or federal courts in New York County, New York.</p>
          </Section>

          <Section n="16" title="Binding Arbitration and Class Action Waiver">
            <p>You and JOININYO LTD agree to resolve disputes by binding individual arbitration (AAA Consumer Arbitration Rules), except for permitted exceptions such as small claims and certain equitable relief.</p>
            <p className="legal-callout">
              YOU AND INYO AGREE TO BRING CLAIMS ONLY IN AN INDIVIDUAL CAPACITY, NOT AS A PLAINTIFF OR CLASS MEMBER IN ANY CLASS, COLLECTIVE, OR REPRESENTATIVE ACTION.
            </p>
            <p>You have a 30-day right to opt out of arbitration by emailing <a href="mailto:andy@joininyo.com" className="legal-link">andy@joininyo.com</a> with your name, phone number, and clear opt-out statement.</p>
          </Section>

          <Section n="17" title="General Provisions">
            <ul className="legal-list">
              <li>These Terms and the Privacy Policy are the entire agreement.</li>
              <li>If any provision is unenforceable, remaining provisions remain in force.</li>
              <li>Failure to enforce is not a waiver.</li>
              <li>You may not assign without consent; JOININYO LTD may assign freely.</li>
              <li>Force majeure applies for causes beyond reasonable control.</li>
              <li>No third-party beneficiaries except specified subprocessors relying on relevant protections.</li>
            </ul>
          </Section>

          <Section n="18" title="Contact Information">
            <p>For questions about these Terms, contact:</p>
            <ul className="legal-list">
              <li><strong>Entity:</strong> JOININYO LTD (operating as &ldquo;inyo&rdquo;)</li>
              <li><strong>Entity details:</strong> Delaware Corporation · EIN 42-2102851</li>
              <li><strong>Email:</strong> <a href="mailto:andy@joininyo.com" className="legal-link">andy@joininyo.com</a></li>
              <li><strong>Website:</strong> joininyo.com</li>
            </ul>
          </Section>
        </article>

        <footer className="legal-footer">
          <span>© 2026 inyo · NYC</span>
          <div className="legal-footer-links">
            <Link href="/privacy">← privacy</Link>
            <Link href="/">home</Link>
          </div>
        </footer>
      </div>
    </main>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="legal-section">
      <h2 className="legal-section-title">
        {n ? <span className="legal-section-num">{n}</span> : null}
        {title}
      </h2>
      <div className="legal-section-body">{children}</div>
    </section>
  );
}
