"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatedWord } from "@/components/ui/animated-words";
import { LiquidButton } from "@/components/ui/liquid-glass-button";

function isInAppBrowser(): boolean {
  if (typeof window === "undefined") return false;
  return /instagram|fban|fbav|fb_iab|line|wv|snapchat|twitter|tiktok/i.test(window.navigator.userAgent);
}

function buildSmsHref(target: string | undefined, body: string): string {
  if (!target) return "";
  const encodedBody = encodeURIComponent(body);
  const isIOS =
    typeof window !== "undefined" && /iphone|ipad|ipod/i.test(window.navigator.userAgent);

  return isIOS ? `sms:${target}&body=${encodedBody}` : `sms:${target}?body=${encodedBody}`;
}

/* ─── Onboarding Mockup ─── */
function OnboardingMockup() {
  return (
    <div className="mockup-snippet onboarding-snippet">
      <div className="onboarding-header">
        <div className="onboarding-avatar-placeholder" />
        <div style={{ flex: 1 }}>
          <div style={{ width: '60px', height: '6px', background: 'rgba(0,0,0,0.05)', borderRadius: '3px', marginBottom: '4px' }}/>
          <div style={{ width: '40px', height: '4px', background: 'rgba(0,0,0,0.03)', borderRadius: '2px' }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <div className="onboarding-tag">tell me a non-negotiable</div>
        <div className="onboarding-tag" style={{ background: "rgba(0,0,0,0.03)", color: "var(--text-secondary)", boxShadow: 'none' }}>...</div>
      </div>
      <div className="voice-waveform">
        <div style={{ fontSize: '10px', marginRight: '4px', opacity: 0.4 }}>🎙️</div>
        {[12, 18, 14, 24, 10, 20, 16, 22, 14, 18, 12, 16, 20, 14, 18, 12].map((h, i) => (
          <div 
            key={i} 
            className="voice-bar" 
            style={{ animationDelay: `${i * 0.08}s`, height: `${h}px` }} 
          />
        ))}
      </div>
    </div>
  );
}

/* ─── Matching Mockup ─── */
function MatchingMockup() {
  return (
    <div className="mockup-snippet matching-snippet">
      <div className="match-ring">
        <span className="match-score">93%</span>
      </div>
      <div className="pulse-dot" style={{ top: '15%', left: '15%' }} />
      <div className="pulse-dot" style={{ bottom: '20%', right: '15%', animationDelay: '0.8s' }} />
    </div>
  );
}

/* ─── iMessage Mockup ─── */
function IMessageMockup() {
  return (
    <div className="imessage-frame">
      <div className="imessage-notch" />
      <div className="imessage-header">
        <div className="imessage-avatar">i</div>
        <div>
          <div className="imessage-sender">inyo</div>
          <div className="imessage-sub">SMS</div>
        </div>
      </div>
      <div className="imessage-body">
        <div className="imessage-bubble gray">
          <p className="imessage-text">
            hey! we found someone for you ✨
          </p>
        </div>
        <div className="imessage-bubble gray">
          <div className="imessage-match-card">
            <div className="imessage-match-photo" />
            <div className="imessage-match-info">
              <span className="imessage-match-name">Sarah, 26</span>
              <span className="imessage-match-hood">west village</span>
            </div>
          </div>
          <p className="imessage-text" style={{ marginTop: 10 }}>
            93% match · you both love long walks, hate small talk, and think pineapple belongs on pizza.
          </p>
          <p className="imessage-text" style={{ marginTop: 6, opacity: 0.5, fontSize: ".7rem" }}>
            @sarah.nyc · 📸 4 photos attached
          </p>
        </div>
        <div className="imessage-bubble gray">
          <p className="imessage-text">reply <strong>YES</strong> to connect</p>
        </div>
        <div className="imessage-bubble blue self">
          <p className="imessage-text">YES</p>
        </div>
        <div className="imessage-bubble gray">
          <p className="imessage-text">
            done! we shared your numbers. go say hi 💛
          </p>
        </div>
      </div>
    </div>
  );
}

export default function TestLandingPage() {
  const SMS_TARGET = process.env.NEXT_PUBLIC_INYO_SMS_TARGET;

  const [faqOpen, setFaqOpen] = useState<number | null>(null);
  const [showSmsFallback, setShowSmsFallback] = useState(false);
  const [smsCopyInfo, setSmsCopyInfo] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const smsTarget = SMS_TARGET;
  const smsBody = "Hey Inyo, help me find a match!";
  const smsHref = buildSmsHref(smsTarget, smsBody);



  // Draggable slider logic
  useEffect(() => {
    const slider = scrollRef.current;
    if (!slider) return;

    let isDown = false;
    let startX: number;
    let scrollLeft: number;
    let animationId: number;
    const speed = 0.3; // Refined slower speed
    let lastTime = 0;

    // Use a more robust way to find the "single set" width
    // We'll calculate it based on the number of items and their widths
    const getSetWidth = () => {
      if (!slider) return 0;
      // Since it's multiplied by 6, total / 6 is one set
      return slider.scrollWidth / 6;
    };

    const animate = (time: number) => {
      if (!isDown && slider) {
        if (!lastTime) lastTime = time;
        const delta = time - lastTime;
        lastTime = time;

        // Use delta to keep speed consistent regardless of monitor refresh rate
        slider.scrollLeft += speed * (delta / 16); 
        
        const setWidth = getSetWidth();
        if (setWidth > 0) {
          // With 6 sets, we have plenty of room.
          // We'll jump back to the 'middle' area whenever we stray too far.
          if (slider.scrollLeft >= setWidth * 4) {
            slider.scrollLeft -= setWidth;
          } else if (slider.scrollLeft <= setWidth) {
            slider.scrollLeft += setWidth;
          }
        }
      } else {
        lastTime = 0;
      }
      animationId = requestAnimationFrame(animate);
    };

    const handleMouseDown = (e: MouseEvent) => {
      isDown = true;
      setIsDragging(true);
      startX = e.pageX - slider.offsetLeft;
      scrollLeft = slider.scrollLeft;
    };

    const handleMouseLeave = () => {
      isDown = false;
      setIsDragging(false);
    };

    const handleMouseUp = () => {
      isDown = false;
      setIsDragging(false);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - slider.offsetLeft;
      const walk = (x - startX) * 2;
      slider.scrollLeft = scrollLeft - walk;

      // Teleportation during drag
      const setWidth = getSetWidth();
      if (setWidth > 0) {
        if (slider.scrollLeft >= setWidth * 4) {
          slider.scrollLeft -= setWidth;
          scrollLeft -= setWidth;
          startX = e.pageX - slider.offsetLeft; 
        } else if (slider.scrollLeft <= setWidth) {
          slider.scrollLeft += setWidth;
          scrollLeft += setWidth;
          startX = e.pageX - slider.offsetLeft;
        }
      }
    };

    // Set initial position to the middle area
    if (slider) {
      const setWidth = slider.scrollWidth / 6;
      slider.scrollLeft = setWidth * 2;
    }

    slider.addEventListener('mousedown', handleMouseDown);
    slider.addEventListener('mouseleave', handleMouseLeave);
    slider.addEventListener('mouseup', handleMouseUp);
    slider.addEventListener('mousemove', handleMouseMove);
    animationId = requestAnimationFrame(animate);

    return () => {
      slider.removeEventListener('mousedown', handleMouseDown);
      slider.removeEventListener('mouseleave', handleMouseLeave);
      slider.removeEventListener('mouseup', handleMouseUp);
      slider.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(animationId);
    };
  }, []);

  function handleWaitlistClick() {
    setShowSmsFallback(false);
    setSmsCopyInfo(null);
    void openSmsComposer();
  }

  async function openSmsComposer() {
    if (typeof window === "undefined") return;
    if (!smsTarget) {
      setShowSmsFallback(true);
      return;
    }

    if (isInAppBrowser()) {
      setShowSmsFallback(true);
      return;
    }

    window.location.assign(smsHref);
  }

  async function copySmsMessage() {
    if (typeof window === "undefined") return;
    const text = `${smsTarget ?? ""}\n${smsBody}`.trim();
    if (!text) return;
    try {
      await window.navigator.clipboard.writeText(text);
      setSmsCopyInfo("Copied number + message.");
      setTimeout(() => setSmsCopyInfo(null), 2500);
    } catch {
      setSmsCopyInfo("Copy failed. Long-press to copy manually.");
    }
  }

  return (
    <>
      {/* Backgrounds */}
      <div className="bg-grid" />
      <div className="bg-glow" />
      <div className="bg-radial" />

      {/* 01: NAV */}
      <nav className="nav">
        <span>inyo</span>
        <div style={{ display: "flex", gap: 16, fontFamily: "var(--font-body)", fontSize: "0.9rem" }}>
          <Link href="/privacy" className="nav-brand">privacy</Link>
          <Link href="/terms" className="nav-brand">terms</Link>
        </div>
      </nav>

      {/* 02: HERO */}
      <section className="hero">
        <div className="hero-content">
          <h1 className="hero-title">
            <span className="title-row block">
              Your <AnimatedWord words={["partner", "person", "soulmate"]} className="animated-word" />
            </span>
            <span className="title-row block">is out there.</span>
          </h1>

          <p className="hero-sub">
            <i>Some things </i> are worth waiting for. We&apos;ll text you when it&apos;s time.
          </p>

          <div className="hero-form">
            <LiquidButton size="xl" onClick={handleWaitlistClick} className="liquid-button">
              tap to find your match
            </LiquidButton>
          </div>

          <p className="hero-note" style={{ marginTop: 8 }}>
            By continuing, you agree to our{" "}
            <Link href="/terms" className="underline hover:text-[#27AE60] transition-colors">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/terms" className="underline hover:text-[#27AE60] transition-colors">
              Privacy
            </Link>
            .
          </p>

          <div className="scroll-hint">
            <div className="scroll-line" />
          </div>
        </div>
      </section>

      {/* ══════ BENTO CONTAINER ══════ */}
      <section className="bento-container">
        <div className="bento-grid">
          
          {/* 03: STEP CARDS */}
          <div className="premium-card span-6 glass" style={{ background: "linear-gradient(135deg, #fff, #f0f4ff)" }}>
            <div className="step-card-row">
              <div style={{ flex: 1 }}>
                <p className="section-label">step 01</p>
                <h2 className="card-title" style={{ fontSize: "1.8rem" }}>tell us who you are.</h2>
                <p className="card-body" style={{ fontSize: "0.9rem" }}>
                  your voice tells us more than any profile ever could. takes 3 minutes.
                </p>
                <div style={{ marginTop: 24, padding: '12px 16px', background: 'rgba(0,0,0,0.03)', borderRadius: 16 }}>
                   <p style={{ fontSize: '0.75rem', fontWeight: 600, opacity: 0.6 }}>🔒 private profile</p>
                   <p style={{ fontSize: '0.7rem', opacity: 0.5 }}>your data is never public. only the matching engine sees it.</p>
                </div>
              </div>
              <OnboardingMockup />
            </div>
          </div>

          <div className="premium-card span-6 glass" style={{ background: "linear-gradient(135deg, #fff, #f0f4ff)" }}>
            <p className="section-label">step 02</p>
            <h2 className="card-title" style={{ fontSize: "1.8rem" }}>we find your person.</h2>
            <div className="step-card-row" style={{ alignItems: 'flex-end' }}>
              <p className="card-body" style={{ fontSize: "0.9rem" }}>
                science backed matchmaking analyzes your personality, lifestyle, and values. we score compatibility across six dimensions.
              </p>
              <MatchingMockup />
            </div>
          </div>

          <div className="premium-card span-12 glass" style={{ background: "linear-gradient(135deg, #fff, #f0f4ff)" }}>
            <div className="how-it-works-preview">
              <div style={{ flex: 1 }}>
                <p className="section-label">step 03</p>
                <h2 className="card-title">the moment.</h2>
                <p className="card-body">
                  no app. no notifications. just a text with someone we think you should meet.
                  one photo, one reason, one question: <i>yes or no?</i>
                </p>
                <div className="anti-ghost-card" style={{ marginTop: 32, padding: '24px 32px', borderRadius: 24, background: '#111', color: '#fff' }}>
                   <p className="section-label" style={{ color: 'rgba(255,255,255,0.4) !important', fontSize: '0.7rem !important', marginBottom: '12px !important' }}>anti-ghost system</p>
                   <p style={{ fontSize: '0.95rem', fontStyle: 'italic', opacity: 0.9 }}>
                     &quot;if someone ghosts the intro, we let it go after 48h — so neither of you is left wondering.&quot;
                   </p>
                </div>
              </div>
              <div className="imessage-container" style={{ alignSelf: 'center' }}>
                <IMessageMockup />
              </div>
            </div>
          </div>

          {/* 04: PHILOSOPHY */}
          <div className="premium-card span-12 glass" style={{ background: "linear-gradient(135deg, #ffffff2e, #f0f4ffff)" }}>
            <p className="section-label">the philosophy</p>
            <h2 className="card-title">
              dating apps were supposed to make it easier.
              instead they made it lonelier.
            </h2>
            <p className="card-body">
              endless swiping. curated profiles that say nothing real.
              conversations that go nowhere. the paradox of choice disguised as opportunity.
              <br /><br />
              inyo takes a different approach — no app, no profiles to browse, no swiping.
              you answer questions honestly, share a few photos,
              and we do the rest. when we find your person, you get a text.
              that&apos;s it.
            </p>
          </div>

          {/* 05: REAL VOICES */}
          <div className="span-12" style={{ margin: "40px 0" }}>
             <p className="section-label">real voices</p>
              <div className={`social-proof-strip ${isDragging ? 'is-dragging' : ''}`} ref={scrollRef}>
                <div className="scroll-container" style={{ display: 'flex', gap: '24px', flexWrap: 'nowrap' }}>
                  {[...Array(6)].flatMap((_, i) => (
                    [
                      "at this point i'm not even looking for a girlfriend anymore. i'm just looking for someone who can hold a conversation.",
                      "99% of my most compatibles are a joke. i don't want kids, yet all the guys i'm supposedly compatible with want them.",
                      "i don't get no likes at all. and no conversations. just ghost mid convo.",
                      "i tried ditto and didn't hear back from them. so that's ruled out.",
                      "my most compatible always seems to be at the opposite end of the country to me.",
                    ].map((q, j) => (
                      <div key={`${i}-${j}`} className="quote-card">
                        <p className="quote-text">&quot;{q}&quot;</p>
                        <p className="quote-author">— nyc dater</p>
                      </div>
                    ))
                  ))}
                  {/* Spacer to make scrollWidth perfectly divisible for seamless looping */}
                  <div style={{ width: '24px', flexShrink: 0 }} />
                </div>
              </div>
          </div>

          {/* 06: KOREAN ORIGIN (INYON) */}
          <div className="span-12 inyon-section">
             <div className="thread-visual">
               <div className="thread-line" />
               <div style={{ position: 'absolute', top: '50%', left: '0', width: 8, height: 8, background: '#d4af37', borderRadius: '50%', transform: 'translateY(-50%)' }} />
               <div style={{ position: 'absolute', top: '50%', right: '0', width: 8, height: 8, background: '#d4af37', borderRadius: '50%', transform: 'translateY(-50%)' }} />
             </div>
             <p className="section-label">our name</p>
             <h2 className="hero-title" style={{ fontSize: 'clamp(2.5rem, 6vw, 4rem)', marginBottom: 24 }}>인연 (inyon)</h2>
             <p className="card-body" style={{ margin: '0 auto', maxWidth: 650, fontSize: '1.1rem' }}>
               in korean culture, <strong>inyon</strong> is the belief that if two people cross paths, it was always meant to happen.
               not random. not algorithmic. <strong>meant.</strong>
               <br /><br />
               inyo is built on this idea. we are not trying to manufacture a connection.
               we are trying to make sure the one that was already coming finds its way to you.
             </p>
          </div>

          {/* 07: FAQ */}
          <div className="span-12 faq-section">
             <p className="section-label">frequently asked questions</p>
             <div className="faq-grid">
               {[
                 { q: "is this free?", a: "yes — completely free during our launch period. when we move to a paid model, you'll hear from us first." },
                 { q: "how many matches will i get?", a: "we don't guarantee a number. when we find someone who genuinely fits, we'll text you. quality over volume." },
                 { q: "do i have to download anything?", a: "no. nothing. we text you. you reply. that's the whole product." },
                 { q: "is my information private?", a: "yes. your profile is never public. nobody can search for you. your data exists only inside the matching engine." },
                 { q: "is this only for straight people?", a: "no. inyo is for everyone. you tell us who you're looking for and we match accordingly." },
                 { q: "why nyc only?", a: "we're starting where the problem is most acute and the density supports it. more cities are coming." },
               ].map((item, i) => (
                 <div key={i} className={`faq-item ${faqOpen === i ? 'open' : ''}`}>
                   <button className="faq-question" onClick={() => setFaqOpen(faqOpen === i ? null : i)}>
                     <span>{item.q}</span>
                     <span className="faq-icon" style={{ transform: faqOpen === i ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s' }}>↓</span>
                   </button>
                   <div className="faq-answer" style={{ 
                     maxHeight: faqOpen === i ? '200px' : '0', 
                     opacity: faqOpen === i ? 1 : 0,
                     transition: 'all 0.4s cubic-bezier(0.2, 0, 0, 1)'
                   }}>
                     <p style={{ paddingTop: 16 }}>{item.a}</p>
                   </div>
                 </div>
               ))}
             </div>
          </div>

          {/* 08: SAFETY & TRUST */}
          <div className="premium-card span-12 glass" style={{ background: '#f8fafc' }}>
            <p className="section-label">safety & trust</p>
            <h2 className="card-title">we take the intro seriously. the rest is yours.</h2>
            <div className="stats-grid" style={{ marginTop: 32, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              {[
                { t: "id verified", d: "every user confirms identity via government id before activation." },
                { t: "photo verified", d: "live selfie matched against photos. no catfishing." },
                { t: "contact blocking", d: "sync contacts and we never match you with someone you know." },
                { t: "report by text", d: "anything feels wrong? reply REPORT to any message." },
                { t: "auto-suspension", d: "two reports trigger an automatic account suspension." },
              ].map((s, i) => (
                <div key={i} style={{ textAlign: 'left', padding: 20 }}>
                  <p style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 8 }}>{s.t}</p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{s.d}</p>
                </div>
              ))}
            </div>
          </div>

        </div>
      </section>

      {/* 09: FOOTER */}
      <div className="site-footer-wrapper">
        <footer className="site-footer">
          <div className="footer-bottom" style={{ border: 'none', paddingTop: 0, alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span className="footer-brand">
                inyo - Locations
              </span>
              <p style={{ fontSize: '0.75rem', opacity: 0.5, textTransform: 'lowercase' }}>nyc (only) — other locations soon</p>
              <div className="footer-copy">
                &copy; 2026 inyo &middot; nyc &middot; <Link href="/privacy" className="hover:underline">privacy</Link> &middot; <Link href="/terms" className="hover:underline">terms &amp; conditions</Link>
              </div>
            </div>
            
            <div className="footer-col" style={{ marginTop: 0 }}>
               <h4>socials</h4>
               <div className="footer-links">
                 <a href="https://www.tiktok.com/@joininyo?_r=1&_t=ZP-95Ul9yy8Ijm" target="_blank" rel="noopener noreferrer" style={{ marginBottom: 4 }}>tiktok</a>
                 <a href="https://www.instagram.com/joininyo?igsh=MXUyaWN4NTJsYzBvMw%3D%3D&utm_source=qr" target="_blank" rel="noopener noreferrer">instagram</a>
               </div>
            </div>
          </div>
        </footer>
      </div>

      {showSmsFallback && (
        <div className="modal-overlay" onClick={() => setShowSmsFallback(false)}>
          <div className="modal-content consent-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowSmsFallback(false)}>×</button>
            <h2>open your sms app</h2>
            <p className="sub">
              some in-app browsers block automatic SMS redirects. tap below to open your SMS app and send the prefilled message.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
              <a
                href={smsHref || "#"}
                onClick={(e) => {
                  if (!smsHref) {
                    e.preventDefault();
                    return;
                  }
                  void openSmsComposer();
                }}
                style={{ textDecoration: "none", width: "100%" }}
              >
                <LiquidButton size="lg" onClick={() => void openSmsComposer()} style={{ width: "100%" }}>
                  open sms app
                </LiquidButton>
              </a>
              <LiquidButton size="lg" onClick={() => void copySmsMessage()} style={{ width: "100%" }}>
                copy sms details
              </LiquidButton>
              {smsTarget && (
                <p className="hero-note" style={{ marginTop: 2, wordBreak: "break-word" }}>
                  to: {smsTarget}
                </p>
              )}
              <p className="hero-note" style={{ marginTop: 0, wordBreak: "break-word" }}>
                message: {smsBody}
              </p>
              {smsCopyInfo && (
                <p className="hero-note" style={{ marginTop: 0 }}>
                  {smsCopyInfo}
                </p>
              )}
              <LiquidButton
                size="lg"
                onClick={() => setShowSmsFallback(false)}
                style={{ width: "100%", background: "#111827", color: "#fff" }}
              >
                close
              </LiquidButton>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
