import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — inyo",
  description:
    "How inyo collects, uses, and protects your information when you use our SMS-based matchmaking service.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="legal-page">
      <header className="legal-topbar">
        <div className="legal-topbar-inner">
          <Link href="/" className="legal-brand">inyo</Link>
          <nav className="legal-nav">
            <Link href="/privacy" className="legal-nav-link is-active">privacy</Link>
            <Link href="/terms" className="legal-nav-link">terms</Link>
            <Link href="/" className="legal-nav-link">back to site →</Link>
          </nav>
        </div>
      </header>

      <div className="legal-container">
        <div className="legal-eyebrow">Legal</div>
        <h1 className="legal-title">Privacy Policy</h1>
        <p className="legal-meta">
          Effective April 29, 2026 · Last updated April 29, 2026
        </p>

        <article className="legal-article">
          <Section n="Plain-language summary" title="">
            <p>
              inyo (operated by JOININYO LTD) runs over text message. We collect your phone number, onboarding answers, photos and voice notes you send us, and basic profile information to match you with other people. We do not sell your data. You can stop SMS any time by replying STOP, and request deletion by emailing <a href="mailto:andy@joininyo.com" className="legal-link">andy@joininyo.com</a>. If you choose to connect Onairos on our landing page, selected social or AI accounts can share personality signals with us through them.
            </p>
          </Section>

          <Section n="1" title="Information We Collect">
            <p>We collect information you provide directly, information collected automatically, and optional partner data.</p>
            <ul className="legal-list">
              <li><strong>Contact information:</strong> phone number, email address, and first name (and last name if you choose to share it).</li>
              <li><strong>Profile information:</strong> age, gender, photos, voice notes, neighborhood-level location, occupation, and details shared in onboarding.</li>
              <li><strong>Onboarding answers and SMS content:</strong> responses to onboarding prompts and message content you exchange with inyo, including media.</li>
              <li><strong>Match feedback:</strong> YES/NO responses and feedback about dates or matches.</li>
              <li><strong>Payment information:</strong> if you become a paying member, payment is processed by Stripe and we do not store full card details.</li>
              <li><strong>Automatically collected data:</strong> IP address, browser, OS, pages viewed, timestamps, SMS metadata, and minimal cookies for preferences and conversion measurement.</li>
            </ul>
            <p>
              <strong>Optional Onairos integration:</strong> If you opt in, Onairos processes data from platforms you authorize and shares resulting personality signals with inyo. We do not receive your raw Instagram/TikTok/ChatGPT content. Onairos processing is governed by their policy at <a href="https://onairos.uk/privacy" target="_blank" rel="noopener noreferrer" className="legal-link">onairos.uk/privacy</a>.
            </p>
          </Section>

          <Section n="2" title="How We Use Your Information">
            <ul className="legal-list">
              <li>Provide the Service, onboard you, send and receive messages, and run matchmaking.</li>
              <li>Match you with others using onboarding answers, profile details, media, and optional Onairos signals.</li>
              <li>Improve matching and onboarding through aggregate analysis.</li>
              <li>Communicate transactional and service messages, support responses, and account updates.</li>
              <li>Process payments via Stripe where applicable.</li>
              <li>Prevent fraud/abuse, protect users, and comply with legal obligations.</li>
            </ul>
            <p>We do not sell personal information, and we do not share onboarding answers or match conversations with advertisers.</p>
          </Section>

          <Section n="3" title="SMS Messaging Consent (TCPA Disclosure)">
            <p>
              By providing your phone number and joining inyo, you expressly consent to recurring SMS for onboarding, match notifications, service updates, and optional check-ins. Message frequency varies. Message and data rates may apply.
            </p>
            <ul className="legal-list">
              <li>Reply HELP for help, or email <a href="mailto:andy@joininyo.com" className="legal-link">andy@joininyo.com</a>.</li>
              <li>Supported carriers include major U.S. carriers. Carriers are not liable for delayed or undelivered messages.</li>
            </ul>
            <p className="legal-callout">
              <strong>Opt out any time:</strong> Reply STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, or QUIT. After one final confirmation, no further SMS of any kind will be sent unless you opt back in. SMS consent/opt-out records are retained for at least 4 years.
            </p>
          </Section>

          <Section n="4" title="How We Share Your Information">
            <p>We only share personal information in limited circumstances:</p>
            <ul className="legal-list">
              <li><strong>With matched users:</strong> curated profile subset such as first name, age, neighborhood, approved photos, and selected highlights.</li>
              <li><strong>With service providers/subprocessors:</strong> such as Twilio, Supabase, Anthropic, Stripe, Vercel, optional Onairos, and email/CRM tools.</li>
              <li><strong>For legal reasons:</strong> to comply with law and protect rights/safety.</li>
              <li><strong>Business transactions:</strong> merger, acquisition, financing, asset sale, or bankruptcy.</li>
              <li><strong>With your consent:</strong> where you explicitly direct us to share data.</li>
            </ul>
          </Section>

          <Section n="5" title="How Long We Keep Your Information">
            <ul className="legal-list">
              <li>Active account data: retained while account is active.</li>
              <li>SMS conversation logs: up to 12 months after last activity unless legally required longer.</li>
              <li>TCPA consent/opt-out records: at least 4 years after consent withdrawal.</li>
              <li>Payment records: 7 years for tax/accounting compliance.</li>
              <li>Deletion requests: personal information deleted within 30 days of verified request (subject to legal retention).</li>
              <li>Anonymized aggregate data may be retained indefinitely.</li>
            </ul>
          </Section>

          <Section n="6" title="Your Privacy Rights and Choices">
            <ul className="legal-list">
              <li>Access, correction, deletion, data portability, withdrawal of consent, and non-discrimination.</li>
              <li>California users: additional CCPA/CPRA rights.</li>
              <li>EU/UK/Swiss users: GDPR/UK GDPR rights and complaint rights with local authority.</li>
            </ul>
            <p>To exercise rights, email <a href="mailto:andy@joininyo.com" className="legal-link">andy@joininyo.com</a>. We respond within 30 days (or 45 days where permitted).</p>
          </Section>

          <Section n="7" title="Children">
            <p>The Service is for users 18+ only. We do not knowingly collect personal information from anyone under 18 and will delete it promptly if discovered.</p>
          </Section>

          <Section n="8" title="Data Security">
            <p>We use commercially reasonable technical and organizational safeguards, including encryption in transit, encryption at rest for sensitive data, access controls, and routine security review. No method is 100% secure, and we cannot guarantee absolute security.</p>
          </Section>

          <Section n="9" title="International Data Transfers">
            <p>inyo operates in the United States. If you access the Service from outside the U.S., your information may be transferred to and processed in the U.S. or other countries where providers operate. For EEA/UK/Switzerland, we rely on appropriate safeguards such as Standard Contractual Clauses.</p>
          </Section>

          <Section n="10" title="Changes to This Privacy Policy">
            <p>We may update this policy to reflect legal, product, or operational changes. For material changes, we provide notice by SMS (if not opted out), email, or prominent website notice at least 14 days before changes take effect.</p>
          </Section>

          <Section n="11" title="Contact Us">
            <p>If you have questions or requests regarding this Privacy Policy or data practices, contact:</p>
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
            <Link href="/">home</Link>
            <Link href="/terms">terms →</Link>
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
 