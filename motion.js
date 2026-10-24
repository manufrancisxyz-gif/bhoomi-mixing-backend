// Site motion with GSAP (iart-ai web-animation-skills: gsap-web + accessible-animation).
// Content is visible without this file; the .js class only hides hero parts while it loads.
if (window.gsap) {
  gsap.registerPlugin(ScrollTrigger, SplitText);
  const mm = gsap.matchMedia();

  mm.add({ ok: '(prefers-reduced-motion: no-preference)', reduce: '(prefers-reduced-motion: reduce)' }, (ctx) => {
    if (ctx.conditions.reduce) {
      // Tier 2: keep a short fade, drop every movement
      gsap.from('.hero-copy, .earth', { opacity: 0, duration: 0.15 });
      return;
    }

    document.fonts.ready.then(() => {
      gsap.set('.hero-copy h1, .hero-copy .lead, .feature, .hero-actions, .earth, .wordmark .mark', { visibility: 'visible' });
      const tl = gsap.timeline({ defaults: { ease: 'power3.out', duration: 0.7 } });

      // The seed logo: ground line draws across, then the seed settles under it
      tl.from('.wordmark .mark-line', { scaleX: 0, transformOrigin: '0% 50%', duration: 0.5 })
        .from('.wordmark .mark-seed', { y: -10, opacity: 0, duration: 0.45 }, '-=0.15');

      // Headline rises line by line from behind a mask
      SplitText.create('.hero-copy h1', {
        type: 'lines', mask: 'lines', autoSplit: true,
        onSplit(self) {
          return tl.from(self.lines, { yPercent: 110, stagger: 0.09, duration: 0.8, ease: 'power4.out' }, 0.15);
        },
      });

      tl.from('.hero-copy .lead', { y: 16, opacity: 0 }, 0.55)
        .from('.hero-actions', { y: 16, opacity: 0 }, 0.65)
        .from('.feature', { y: 16, opacity: 0 }, 0.75)
        .from('.earth', { scale: 0.96, opacity: 0, duration: 1.2 }, 0.2);
    });

    // Scroll reveals: a short rise and fade, once per element
    const reveal = (selector, opts = {}) => {
      gsap.set(selector, { opacity: 0, y: 24 });
      ScrollTrigger.batch(selector, {
        start: 'top 88%', once: true,
        onEnter: (els) => gsap.to(els, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', stagger: 0.08, ...opts }),
      });
    };
    reveal('section h2');
    reveal('.artist');
    reveal('.releases-head .lead');
    reveal('.rail > li', { stagger: 0.06 });
    reveal('.about-cols > p');
    reveal('.facts > div');
    reveal('.contact-intro, .details, .contact-earth, .form');

    // The footer mark replays the logo's growth when it comes into view
    gsap.timeline({ scrollTrigger: { trigger: '.mast', start: 'top 92%', once: true } })
      .from('.mast .mark-line', { scaleX: 0, transformOrigin: '0% 50%', duration: 0.6, ease: 'power3.out' })
      .from('.mast .mark-seed', { y: -10, opacity: 0, duration: 0.5, ease: 'power3.out' }, '-=0.2');
  });
} else {
  document.documentElement.classList.remove('js');
}
