import React, { useEffect, useState } from 'react';
import { X, ArrowUpRight, Check } from 'lucide-react';

export type StudioSection = 'work' | 'about' | 'journal' | 'contact' | null;

interface StudioDrawerProps {
  section: StudioSection;
  onClose: () => void;
  onSelectSection: (section: Exclude<StudioSection, null>) => void;
}

const WORK_ITEMS = [
  {
    title: 'Kauri Canopy Atlas',
    meta: 'Forestry Trust · Spatial Cartography · 2026',
    summary:
      'Interactive watershed and old-growth biodiversity map built on real-time acoustic canopy sensors across Aotearoa.',
    impact: '42,000 hectares mapped in real time',
  },
  {
    title: 'Tidal Seed Archive',
    meta: 'Marine Restoration · Living Archive · 2025',
    summary:
      'Digital herbarium and germination ledger tracking seagrass restoration across fourteen coastal estuaries.',
    impact: '68% faster seasonal planting coordination',
  },
  {
    title: 'Solar Commons Grid',
    meta: 'Community Energy · Product & Brand · 2025',
    summary:
      'Neighborhood microgrid interface helping rural households balance rooftop generation with nocturnal storage.',
    impact: '19,400 MWh shared locally in year one',
  },
];

const JOURNAL_ENTRIES = [
  {
    title: 'Interfaces That Grow Like Meadows, Not Factories',
    meta: 'Essay · October 2026 · 6 min read',
    excerpt:
      'Why digital products borrowed industrial assembly-line metaphors—and what shifts when we design for seasonal rhythm and stewardship.',
  },
  {
    title: 'Low-Wattage Shaders for Living Landscapes',
    meta: 'Field Notes · August 2026 · 4 min read',
    excerpt:
      'Reducing GPU draw and frame energy on interactive WebGL experiences without sacrificing atmospheric depth.',
  },
  {
    title: 'Listening to Soil Moisture Before Writing Copy',
    meta: 'Studio Practice · June 2026 · 5 min read',
    excerpt:
      'Notes from a three-week residency with regenerative pastoralists shaping our discovery sprints.',
  },
];

export const StudioDrawer: React.FC<StudioDrawerProps> = ({
  section,
  onClose,
  onSelectSection,
}) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (section) {
      window.addEventListener('keydown', onKeyDown);
    }
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [section, onClose]);

  if (!section) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedMessage = message.trim();

    if (!trimmedName) {
      setError('Please share your name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (trimmedMessage.length < 10) {
      setError('Tell us a little about your project (at least 10 characters).');
      return;
    }

    setError('');
    setSubmitted(true);
  };

  return (
    <div
      className="studio-drawer-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className="studio-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`ECOsonic ${section}`}
      >
        <div className="flex items-center justify-between border-b border-[#f5efe2]/15 pb-5">
          <div className="flex items-center gap-6 text-xs uppercase tracking-[0.16em] text-[#f5efe2]/70">
            {(['work', 'about', 'journal', 'contact'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  setSubmitted(false);
                  setError('');
                  onSelectSection(tab);
                }}
                className={`transition-opacity ${
                  section === tab
                    ? 'text-[#f5efe2] underline underline-offset-8'
                    : 'text-[#f5efe2]/55 hover:text-[#f5efe2]'
                }`}
              >
                {tab === 'contact' ? 'Let’s talk' : tab}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="grid h-10 w-10 place-items-center rounded-full border border-[#f5efe2]/25 text-[#f5efe2] transition-colors hover:bg-[#f5efe2] hover:text-[#151510]"
          >
            <X size={18} />
          </button>
        </div>

        {section === 'work' && (
          <div className="flex flex-col gap-8">
            <div>
              <h2
                className="text-4xl font-normal tracking-tight text-[#f5efe2]"
                style={{ fontFamily: 'Fraunces, Georgia, serif', fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
              >
                Selected Work
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[#f5efe2]/75">
                Digital systems crafted alongside ecological stewards, clean-energy cooperatives, and living-material labs.
              </p>
            </div>

            <div className="flex flex-col divide-y divide-[#f5efe2]/12">
              {WORK_ITEMS.map((item) => (
                <article key={item.title} className="py-6 first:pt-2 last:pb-0">
                  <div className="text-xs text-[#f5efe2]/55">{item.meta}</div>
                  <div className="mt-2 flex items-baseline justify-between gap-4">
                    <h3 className="text-lg font-medium text-[#f5efe2]">{item.title}</h3>
                    <ArrowUpRight size={16} className="shrink-0 text-[#f5efe2]/60" />
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-[#f5efe2]/75">
                    {item.summary}
                  </p>
                  <p className="mt-3 text-xs font-medium text-[#f5efe2]/90">
                    {item.impact}
                  </p>
                </article>
              ))}
            </div>
          </div>
        )}

        {section === 'about' && (
          <div className="flex flex-col gap-6">
            <h2
              className="text-4xl font-normal tracking-tight text-[#f5efe2]"
              style={{ fontFamily: 'Fraunces, Georgia, serif', fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
            >
              Rooted in nature. Built for what’s next.
            </h2>
            <p className="text-sm leading-relaxed text-[#f5efe2]/80">
              ECOsonic is an independent regenerative design studio. We partner with climate researchers, land trusts, and sustainable hardware founders to build quiet, durable software and living web experiences.
            </p>
            <div className="border-t border-[#f5efe2]/15 pt-5">
              <h3 className="text-xs uppercase tracking-[0.16em] text-[#f5efe2]/60">
                Disciplines
              </h3>
              <ul className="mt-4 flex flex-col gap-3 text-sm text-[#f5efe2]/85">
                <li>01. Ecological Brand & Narrative Systems</li>
                <li>02. Interactive WebGL & Spatial Storytelling</li>
                <li>03. Low-Carbon Product & Platform Architecture</li>
              </ul>
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => onSelectSection('contact')}
                className="inline-flex h-11 items-center rounded-full bg-[#f5efe2] px-6 text-xs font-medium uppercase tracking-[0.14em] text-[#151510] transition-transform hover:-translate-y-0.5"
              >
                Start a conversation
              </button>
            </div>
          </div>
        )}

        {section === 'journal' && (
          <div className="flex flex-col gap-6">
            <div>
              <h2
                className="text-4xl font-normal tracking-tight text-[#f5efe2]"
                style={{ fontFamily: 'Fraunces, Georgia, serif', fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
              >
                Field Journal
              </h2>
              <p className="mt-2 text-sm text-[#f5efe2]/75">
                Essays on regenerative technology, calm interfaces, and ecological craft.
              </p>
            </div>
            <div className="flex flex-col divide-y divide-[#f5efe2]/12">
              {JOURNAL_ENTRIES.map((entry) => (
                <article key={entry.title} className="py-5 first:pt-2 last:pb-0">
                  <div className="text-xs text-[#f5efe2]/55">{entry.meta}</div>
                  <h3 className="mt-2 text-base font-medium text-[#f5efe2]">
                    {entry.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#f5efe2]/75">
                    {entry.excerpt}
                  </p>
                </article>
              ))}
            </div>
          </div>
        )}

        {section === 'contact' && (
          <div className="flex flex-col gap-6">
            <div>
              <h2
                className="text-4xl font-normal tracking-tight text-[#f5efe2]"
                style={{ fontFamily: 'Fraunces, Georgia, serif', fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
              >
                Let’s talk
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[#f5efe2]/75">
                Tell us what you are growing. We take on four collaborative partnerships each season.
              </p>
            </div>

            {submitted ? (
              <div className="border border-[#f5efe2]/20 p-6">
                <div className="flex items-center gap-3 text-[#f5efe2]">
                  <Check size={18} />
                  <span className="text-base font-medium">Note received</span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-[#f5efe2]/75">
                  Thank you, {name}. We will respond to {email} within two working days.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSubmitted(false);
                    setName('');
                    setEmail('');
                    setMessage('');
                  }}
                  className="mt-5 text-xs uppercase tracking-[0.14em] text-[#f5efe2]/80 underline underline-offset-4 hover:text-[#f5efe2]"
                >
                  Send another note
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
                <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.14em] text-[#f5efe2]/70">
                  Name
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className="border border-[#f5efe2]/20 bg-transparent px-4 py-3 text-sm normal-case tracking-normal text-[#f5efe2] placeholder:text-[#f5efe2]/35"
                  />
                </label>

                <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.14em] text-[#f5efe2]/70">
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@organization.org"
                    className="border border-[#f5efe2]/20 bg-transparent px-4 py-3 text-sm normal-case tracking-normal text-[#f5efe2] placeholder:text-[#f5efe2]/35"
                  />
                </label>

                <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.14em] text-[#f5efe2]/70">
                  Project notes
                  <textarea
                    rows={4}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Scope, timeline, or ecological focus..."
                    className="resize-none border border-[#f5efe2]/20 bg-transparent px-4 py-3 text-sm normal-case tracking-normal text-[#f5efe2] placeholder:text-[#f5efe2]/35"
                  />
                </label>

                {error && (
                  <p role="alert" className="text-xs text-[#f5c2b8]">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  className="mt-1 inline-flex h-12 items-center justify-center rounded-full bg-[#f5efe2] px-6 text-xs font-medium uppercase tracking-[0.16em] text-[#151510] transition-transform hover:-translate-y-0.5"
                >
                  Send message
                </button>
              </form>
            )}
          </div>
        )}
      </aside>
    </div>
  );
};
