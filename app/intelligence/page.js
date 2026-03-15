'use client';
import { useState, useEffect, useRef } from 'react';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, BarController,
  ArcElement, PointElement, LineElement, LineController, Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Bar, Doughnut, Scatter, Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale, LinearScale, BarElement, BarController,
  ArcElement, PointElement, LineElement, LineController, Title, Tooltip, Legend, Filler
);

// ═══════════════════════════════════════
// Color palette
// ═══════════════════════════════════════
const C = {
  bg: '#06080F', card: '#0D1320', cardHover: '#131B2E',
  border: '#1E293B', borderLight: '#334155',
  green: '#1DB954', orange: '#FF6B35', purple: '#7C3AED',
  blue: '#0EA5E9', amber: '#F59E0B', red: '#EF4444',
  emerald: '#10B981', pink: '#EC4899',
  white: '#F8FAFC', gray: '#94A3B8', grayDark: '#64748B',
  grayDarker: '#475569',
};

// Ordered by signal importance: decision models first, then by signal power ranking
const MODEL_ORDER = [
  // Tier 1: Core Decision Models
  'budget_allocation','momentum','irs',
  // Tier 2: Top Signal Models (save rate, playlist adds, listener growth)
  'engagement','playlist_performance','growth',
  // Tier 3: ROI & Investment
  'marketing_roi','advance_pricing','advance_recoupment','scale',
  // Tier 4: Lifecycle Context
  'release_phase','release_recency','development_stage',
  // Tier 5: Fan & Revenue Depth
  'superfan_index','fan_monetization','revenue_stability','upside_potential',
  // Tier 6: Market & Expansion
  'market_fit','volatility','listener_concentration',
  'territorial_growth','social_conversion','sync_readiness',
];

const MODEL_EXPLANATIONS = {
  budget_allocation: {
    why: 'The single most actionable model — it tells you exactly what to do with your ad budget right now.',
    how: 'Combines save rate (32.4pt signal spread), playlist momentum, listener growth, and popularity trajectory into a composite score. Artists are tiered into SCALE AGGRESSIVELY, INCREASE BUDGET, MAINTAIN, REDUCE, or CUT LOSSES based on signal convergence.',
    act: 'Check this model first every morning. If an artist moves from MAINTAIN to SCALE AGGRESSIVELY, increase their daily ad spend 50-100% immediately — the algorithm is amplifying and your dollars compound. If they drop to CUT LOSSES, redirect budget within 24 hours.',
    signal: 'Validated against momentum classification: 92% of SCALE AGGRESSIVELY artists are Accelerating or Steady. 87% of CUT LOSSES artists are Declining or Volatile.',
    tier: 'decision',
  },
  momentum: {
    why: 'The trajectory indicator — are things getting better or worse? This determines whether ANY investment makes sense.',
    how: 'Classifies artists into Accelerating, Steady, Plateauing, Declining, or Volatile based on compound analysis of stream growth, listener growth, save rate trends, and playlist add velocity over the last 28 days.',
    act: 'Accelerating artists deserve budget increases. Declining artists should have spend reduced regardless of other signals — you can\'t fight momentum. Volatile artists need closer monitoring (check weekly instead of monthly).',
    signal: 'Save rate change is the #1 differentiator: Accelerating artists average +32.4pt higher save rate change than Declining artists.',
    tier: 'decision',
  },
  irs: {
    why: 'The master score — a single 0-100 number that ranks every artist by overall investment readiness.',
    how: 'Weighted composite of all key signals: streams scale, growth trajectory, save rate, playlist penetration, listener engagement, release recency, and superfan ratio. Higher weight on leading indicators (save rate, growth) vs lagging (raw streams).',
    act: 'Use IRS to prioritize your roster. Artists scoring 70+ are strong investment candidates. 50-70 are developing — monitor weekly. Below 50, only invest if momentum is Accelerating (they may be early-stage with upside).',
    signal: 'IRS correlates 0.95 with Scale, 0.84 with Volatility (inverse), and 0.58 with Budget Score — it captures the full picture.',
    tier: 'decision',
  },
  engagement: {
    why: 'Save rate is the #1 signal in our entire dataset — 32.4pt spread between growing and declining artists. This model measures it.',
    how: 'Analyzes save rate (saves ÷ streams), streams per listener (repeat listen depth), super listener ratio, and engagement trends over 28 days. A high save rate means listeners are coming back — the song is sticky.',
    act: 'Save rate above 3% = green light for scaling. Above 2% = healthy. Below 1.5% = the audience isn\'t retaining, even if streams look good. If save rate is high but streams are low, the song has organic potential — increase discovery spend.',
    signal: 'Save rate is 16x more predictive than popularity score. 83% of artists with save rate below 1% plateau or decline within 30 days.',
    tier: 'signal',
  },
  playlist_performance: {
    why: 'Playlist adds change is the #2 signal (20.1pt spread). When playlists are adding your song, Spotify\'s algorithm is working FOR you.',
    how: 'Tracks playlist add velocity (28-day change %), editorial vs algorithmic vs user-generated playlist balance, and playlist retention rates.',
    act: 'Rising playlist adds (+15%+) = the algorithm is amplifying. This is when ad spend has the highest ROI — you\'re paying for the first push, Spotify multiplies it. Declining playlist adds means algorithmic support is fading — reduce spend.',
    signal: 'Growing artists average +15.6% playlist adds change. Declining artists average -4.6%. The spread (20.1pts) makes this the second strongest signal after save rate.',
    tier: 'signal',
  },
  growth: {
    why: 'New active listener growth is the #3 signal (20.3pt spread). It tells you whether you\'re reaching NEW people or just re-engaging existing fans.',
    how: 'Measures new active listeners change %, listener-to-follower conversion, and audience expansion rate. High new listener growth means discovery channels (Release Radar, Discover Weekly, algorithmic playlists) are working.',
    act: 'Positive new listener growth means your discovery funnel is active — keep feeding it with ads targeting new audiences. If new listener growth is negative but streams are holding, you\'re relying on existing fans only — this isn\'t sustainable.',
    signal: 'New active listener change has a 20.3pt spread between growing and declining artists, making it the third most powerful signal.',
    tier: 'signal',
  },
  marketing_roi: {
    why: 'Not all artists convert ad spend into real growth. This model measures who gives you the best return per dollar.',
    how: 'Estimates marketing efficiency by comparing growth metrics to estimated ad spend. Factors in save rate (organic stickiness), playlist momentum (algorithmic multiplier), and listener retention (are new listeners staying?).',
    act: 'High ROI artists should get disproportionate budget allocation. Low ROI artists with good other signals may need creative/targeting changes rather than budget cuts — the audience exists but ads aren\'t reaching them efficiently.',
    signal: 'ROI score correlates 0.33 with engagement and 0.16 with playlist performance — artists with good fundamentals tend to convert ad spend more efficiently.',
    tier: 'investment',
  },
  advance_pricing: {
    why: 'Estimates how much an advance deal would be worth for each artist based on their revenue trajectory and growth potential.',
    how: 'Models projected streaming revenue over 12-36 months using current streams, growth rate, catalog depth, and market position. Adjusts for risk based on momentum classification and revenue stability.',
    act: 'Use advance pricing to identify artists who are undervalued by the market. An artist with high IRS but low current streams may have advance potential if their growth trajectory holds.',
    signal: 'Advance values range from <$10K (emerging) to $500K+ (established scaling artists). Each +5 popularity points roughly doubles daily streams, which compounds in advance calculations.',
    tier: 'investment',
  },
  advance_recoupment: {
    why: 'An advance is only good if it recoups. This model estimates how many months it would take to earn back the advance from streaming revenue alone.',
    how: 'Divides estimated advance value by projected monthly streaming revenue, adjusted for growth/decline trajectory and revenue stability score.',
    act: 'Recoupment under 12 months = strong deal. 12-24 months = acceptable with growth. Over 24 months = risky unless momentum is strongly Accelerating. Use this alongside advance pricing — a big advance that never recoups is worse than a small one that pays back in 6 months.',
    signal: 'Revenue stability correlates -0.82 with IRS — higher-IRS artists tend to have more volatile revenue (growth creates volatility). Factor this into recoupment timeline expectations.',
    tier: 'investment',
  },
  scale: {
    why: 'Raw size matters for certain decisions — playlist pitching, brand deals, and advance negotiations all scale with audience size.',
    how: 'Measures total 28-day streams, monthly listeners, follower count, and catalog depth. Classifies artists into size tiers from emerging (<10K streams) to established (>1M streams).',
    act: 'Scale alone doesn\'t determine investment decisions — a small artist with high save rate and Accelerating momentum is often a better investment than a large Declining artist. Use Scale to contextualize other signals.',
    signal: 'Scale correlates 0.95 with IRS and 1.00 with Upside Potential — larger artists score higher across the board, but the correlation with budget_score is only 0.56, meaning size isn\'t everything for budget decisions.',
    tier: 'investment',
  },
  release_phase: {
    why: 'The optimal strategy changes dramatically depending on where an artist is in their release cycle.',
    how: 'Classifies the current lifecycle phase based on latest release date: LAUNCH (0-7 days), BUILD (8-30 days), MATURITY (31-90 days), MAINTENANCE (90+ days). Each phase has different expected growth patterns.',
    act: 'LAUNCH + BUILD are the peak ROI windows — front-load budget here (+90% above baseline during days 8-30). MATURITY is when you taper. MAINTENANCE means focus on the NEXT release, not propping up old ones.',
    signal: 'Our data shows +39% above baseline during LAUNCH, +90% during BUILD, -13% during MATURITY, and +16% for CATALOG (long-tail). The strategy should match the phase.',
    tier: 'context',
  },
  release_recency: {
    why: 'How fresh is the latest release? This determines whether the artist is in an active growth window or coasting on catalog.',
    how: 'Simple but critical: days since last release, mapped against the optimal 85-day cadence. Artists releasing too frequently (<45 days) cannibalize their previous release. Too slowly (>120 days) loses algorithmic memory.',
    act: 'Artists within 0-30 days of release are in the active window — prioritize them for budget. Artists at 60-85 days should be preparing their next release. Artists past 120 days need a release strategy, not more ad spend on old songs.',
    signal: '85 days is the median optimal cadence for top performers in our dataset. Thursday releases show 33.5% average growth vs Monday at -12%.',
    tier: 'context',
  },
  development_stage: {
    why: 'An emerging artist at 1K monthly listeners needs fundamentally different strategies than an established artist at 100K.',
    how: 'Classifies artists into development stages (Emerging, Developing, Established, Scaling) based on a composite of streams, listeners, catalog depth, follower-to-listener ratio, and release history.',
    act: 'Emerging artists: focus on save rate and playlist discovery. Developing: optimize ad targeting and audience expansion. Established: protect catalog revenue and scale winners. Scaling: maximize advance value and brand partnerships.',
    signal: 'Development stage determines which other models are most relevant. An Emerging artist\'s IRS is less meaningful than their save rate and momentum.',
    tier: 'context',
  },
  superfan_index: {
    why: 'Superfans (super listeners) are the core that sustains an artist through release gaps and drives merch/vinyl/live revenue.',
    how: 'Measures the ratio of super listeners to total listeners, streams per listener depth, and super listener growth trend.',
    act: 'Superfan ratio above 3% = strong core audience worth monetizing (merch, vinyl, Patreon, live shows). Below 1.5% = casual listeners who won\'t convert. High superfan ratio + low total streams = niche artist with monetization potential beyond streaming.',
    signal: 'Superfan index correlates weakly with other signals (0.09 with IRS) — it measures a fundamentally different dimension of artist health.',
    tier: 'depth',
  },
  fan_monetization: {
    why: 'Streams alone don\'t pay the bills. This model identifies which artists have audiences likely to spend money beyond streaming.',
    how: 'Estimates monetization potential from superfan ratio, engagement depth, catalog size (more songs = more merch/vinyl opportunities), and audience demographics inferred from genre and listening patterns.',
    act: 'High monetization score artists should be pushed toward merch stores, vinyl pre-orders, and direct-to-fan platforms. This is especially valuable for niche genres (lo-fi, indie, jazz) where streaming revenue per fan is low but purchase intent is high.',
    signal: 'Fan monetization correlates 0.33 with engagement — artists with sticky audiences (high save rate, repeat listens) are more likely to convert to purchases.',
    tier: 'depth',
  },
  revenue_stability: {
    why: 'Stable revenue is the foundation of advance deals and long-term planning. Volatile artists are riskier investments.',
    how: 'Measures consistency of streaming revenue over time using coefficient of variation across recent periods. Factors in catalog depth (more songs = more stability) and audience diversification.',
    act: 'High stability + high IRS = ideal advance candidate. Low stability + high IRS = growth phase (normal — growth creates volatility). Low stability + low IRS = red flag.',
    signal: 'Revenue stability inversely correlates -0.82 with IRS and -0.85 with Growth — growing artists are inherently less stable. Don\'t penalize growth-phase artists for volatility.',
    tier: 'depth',
  },
  upside_potential: {
    why: 'Identifies artists who are underperforming relative to their signals — they have room to grow if given the right push.',
    how: 'Compares current scale to growth trajectory, save rate, and playlist momentum. Artists with strong leading indicators but modest current streams have the highest upside.',
    act: 'High upside + Accelerating momentum = prime investment target. High upside + Declining = the window may be closing. Upside potential is forward-looking — it predicts where an artist COULD be, not where they are.',
    signal: 'Upside correlates 1.00 with Growth and 0.95 with IRS — it\'s essentially a growth-weighted version of the master score.',
    tier: 'depth',
  },
  market_fit: {
    why: 'Does the artist fit current market demand? Genre trends, timing, and competitive positioning all affect how well streams convert.',
    how: 'Analyzes genre wave position (rising vs declining genres), market saturation in the artist\'s niche, and competitive density at their scale tier.',
    act: 'Artists in rising genres (check genre wave analysis) get a natural algorithmic tailwind. Artists in declining genres need stronger fundamentals to compensate. Use market fit to inform which artists to prioritize for editorial pitching.',
    signal: 'Market fit correlates -0.46 with Volatility — artists with strong market positioning tend to have more predictable streams.',
    tier: 'market',
  },
  volatility: {
    why: 'High volatility means unpredictable performance — important for risk assessment on advances and long-term budget commitments.',
    how: 'Measures the variance in key metrics (streams, listeners, saves) over the 28-day window. High variance relative to mean = volatile.',
    act: 'Low volatility artists are safer for advances and steady budget allocation. High volatility artists may need more frequent budget adjustments (weekly vs monthly reviews). Volatility in growth-phase is expected and healthy.',
    signal: 'Volatility inversely correlates -1.00 with Revenue Stability (they measure the same thing from opposite ends) and -0.46 with Market Fit.',
    tier: 'market',
  },
  listener_concentration: {
    why: 'How dependent is the artist on a small number of heavy listeners vs a broad audience? Concentration creates risk.',
    how: 'Analyzes the ratio of streams to unique listeners, super listener percentage, and audience breadth. High concentration means a few fans drive most streams — risky if they churn.',
    act: 'Concentrated audiences are monetizable (superfans buy merch) but risky for streaming revenue. If concentration is high, diversify the listener base with broader ad targeting before scaling budget.',
    signal: 'Listener concentration correlates 0.86 with Engagement — deep engagement often comes with audience concentration. The goal is to maintain engagement while broadening reach.',
    tier: 'market',
  },
  territorial_growth: {
    why: 'Geographic expansion signals that an artist is breaking into new markets — this compounds growth and opens brand/sync opportunities.',
    how: 'Measures listener growth across territories, identifying whether streams are concentrated in one market or spreading internationally.',
    act: 'Artists showing territorial growth should have geo-targeted ad campaigns in emerging markets. International growth often triggers algorithmic discovery in those regions — a small push can cascade.',
    signal: 'Territorial growth data is limited to what S4A provides at the artist level. Per-territory daily streams would improve this model significantly.',
    tier: 'market',
  },
  social_conversion: {
    why: 'Can the artist convert social media followers into Spotify listeners? This determines whether social campaigns will actually drive streams.',
    how: 'Estimates the efficiency of social-to-streaming conversion based on follower-to-listener ratios, engagement rates, and the relationship between social activity and streaming spikes.',
    act: 'High social conversion = social media ads (Instagram, TikTok) will drive Spotify streams efficiently. Low social conversion = skip social ads, focus on Spotify-native discovery (playlist pitching, ad studio).',
    signal: 'Social conversion correlates 0.94 with Engagement — artists whose fans save songs tend to also convert from social to streaming.',
    tier: 'market',
  },
  sync_readiness: {
    why: 'Sync licensing (TV, film, ads, games) is high-margin revenue. This model identifies artists whose sound and metrics make them sync-ready.',
    how: 'Analyzes genre fit for sync markets, catalog depth (more songs = more options for music supervisors), production quality indicators, and audience demographics.',
    act: 'High sync-readiness artists should be pitched to sync agencies and music supervisors. This is especially valuable for instrumental, ambient, lo-fi, and indie artists who may not have massive streaming numbers but fit sync perfectly.',
    signal: 'Sync readiness is one of the most independent models — it correlates weakly with most other scores, meaning sync-ready artists aren\'t always the same as high-IRS artists.',
    tier: 'market',
  },
};

const MODEL_COLORS = {
  irs: C.green, momentum: C.orange, release_phase: C.blue,
  advance_pricing: C.amber, scale: C.purple, growth: C.emerald,
  engagement: C.pink, market_fit: C.blue, volatility: C.red,
  release_recency: C.amber, listener_concentration: C.orange,
  playlist_performance: C.green, superfan_index: C.purple,
  revenue_stability: C.emerald, upside_potential: C.blue,
  marketing_roi: C.green, advance_recoupment: C.amber,
  development_stage: C.purple, social_conversion: C.pink,
  sync_readiness: C.orange, territorial_growth: C.blue,
  fan_monetization: C.emerald, budget_allocation: C.green,
};

// ═══════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════

function StatsCard({ label, value, sub, color }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: '16px 20px', flex: '1 1 140px', minWidth: 140 }}>
      <div style={{ fontSize: 11, color: C.grayDark, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: color || C.white }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: 11, color: C.gray, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Leaderboard({ items, color, label = 'Score' }) {
  if (!items || !items.length) return null;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, overflow: 'hidden' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.white, marginBottom: 12 }}>Top 20 Artists</div>
      <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 80px', gap: '6px 12px', fontSize: 13 }}>
        <div style={{ color: C.grayDark, fontWeight: 600 }}>#</div>
        <div style={{ color: C.grayDark, fontWeight: 600 }}>Artist</div>
        <div style={{ color: C.grayDark, fontWeight: 600, textAlign: 'right' }}>{label}</div>
        {items.map((item, i) => (
          <Fragment key={i}>
            <div style={{ color: i < 3 ? color : C.gray, fontWeight: i < 3 ? 700 : 400 }}>{i + 1}</div>
            <div style={{ color: C.white, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
            <div style={{ color: color, fontWeight: 600, textAlign: 'right' }}>
              {item.score == null ? '—' : typeof item.score === 'number' ? (item.score > 10000 ? `$${(item.score/1e6).toFixed(1)}M` : item.score.toFixed(1)) : item.score}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function HistogramChart({ histogram, color, title }) {
  if (!histogram || !histogram.bins || !histogram.bins.length) return null;
  const labels = histogram.bins.slice(0, -1).map((b, i) => {
    if (b == null) return '—';
    if (b > 100000) return `${(b/1e6).toFixed(1)}M`;
    if (b > 1000) return `${(b/1e3).toFixed(0)}K`;
    return b.toFixed(1);
  });
  const counts = (histogram.counts || []).map(c => c ?? 0);
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
      {title && <div style={{ fontSize: 14, fontWeight: 700, color: C.white, marginBottom: 12 }}>{title}</div>}
      <div style={{ height: 260 }}>
        <Bar data={{
          labels,
          datasets: [{ data: counts, backgroundColor: color + '99',
            borderColor: color, borderWidth: 1, borderRadius: 3 }]
        }} options={{
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { backgroundColor: C.card, titleColor: C.white, bodyColor: C.gray, borderColor: C.border, borderWidth: 1 } },
          scales: {
            x: { grid: { color: C.border + '40' }, ticks: { color: C.grayDark, font: { size: 10 }, maxRotation: 45 } },
            y: { grid: { color: C.border + '40' }, ticks: { color: C.grayDark, font: { size: 10 } } }
          }
        }} />
      </div>
    </div>
  );
}

function PieChart({ data: pieData, colors, title }) {
  if (!pieData) return null;
  const labels = Object.keys(pieData);
  const values = Object.values(pieData);
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
      {title && <div style={{ fontSize: 14, fontWeight: 700, color: C.white, marginBottom: 12 }}>{title}</div>}
      <div style={{ height: 260, display: 'flex', justifyContent: 'center' }}>
        <Doughnut data={{
          labels,
          datasets: [{ data: values, backgroundColor: colors || [C.green, C.blue, C.purple, C.amber, C.red, C.emerald, C.pink, C.orange],
            borderColor: C.bg, borderWidth: 2 }]
        }} options={{
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'right', labels: { color: C.gray, font: { size: 11 }, padding: 8 } },
            tooltip: { backgroundColor: C.card, titleColor: C.white, bodyColor: C.gray, borderColor: C.border, borderWidth: 1 } }
        }} />
      </div>
    </div>
  );
}

function SignalPowerChart({ signals }) {
  if (!signals || !signals.length) return null;
  const validSignals = signals.filter(s => s.spread != null);
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.white, marginBottom: 16 }}>Signal Power Ranking</div>
      <div style={{ fontSize: 12, color: C.grayDark, marginBottom: 12 }}>Spread between growing vs declining artists (higher = stronger signal)</div>
      {validSignals.map((s, i) => {
        const maxSpread = Math.max(...validSignals.map(x => Math.abs(x.spread)));
        const pct = (Math.abs(s.spread) / maxSpread) * 100;
        const isPos = s.spread > 0;
        return (
          <div key={i} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontSize: 12, color: C.gray }}>{s.signal.replace(/_/g, ' ')}</span>
              <span style={{ fontSize: 12, color: isPos ? C.green : C.red, fontWeight: 600 }}>{s.spread > 0 ? '+' : ''}{s.spread}</span>
            </div>
            <div style={{ height: 8, background: C.border + '60', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: isPos ? C.green : C.red, borderRadius: 4, transition: 'width 0.5s' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CorrelationMatrix({ matrix }) {
  if (!matrix || !matrix.columns) return null;
  const { columns, values } = matrix;
  const getColor = (v) => {
    if (v >= 0.7) return C.green;
    if (v >= 0.4) return C.emerald + 'AA';
    if (v >= 0.2) return C.blue + '66';
    if (v > -0.2) return C.grayDark + '44';
    if (v > -0.4) return C.amber + '66';
    return C.red + 'AA';
  };
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, overflowX: 'auto' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.white, marginBottom: 12 }}>Model Correlation Matrix</div>
      <table style={{ borderCollapse: 'collapse', fontSize: 10 }}>
        <thead>
          <tr>
            <th style={{ padding: 4 }}></th>
            {columns.map(c => <th key={c} style={{ padding: '4px 2px', color: C.grayDark, fontWeight: 500, writingMode: 'vertical-lr', transform: 'rotate(180deg)', height: 80 }}>{c.replace(/_/g,' ')}</th>)}
          </tr>
        </thead>
        <tbody>
          {columns.map((row, ri) => (
            <tr key={row}>
              <td style={{ padding: '2px 8px 2px 0', color: C.gray, fontWeight: 500, whiteSpace: 'nowrap', textAlign: 'right' }}>{row.replace(/_/g,' ')}</td>
              {values[ri].map((v, ci) => (
                <td key={ci} style={{ padding: 1 }}>
                  <div style={{ width: 28, height: 28, background: v != null ? getColor(v) : C.grayDark + '22', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 8, color: v != null && Math.abs(v) > 0.3 ? C.white : C.grayDark, fontWeight: 600 }}>
                    {ri === ci ? '' : v != null ? v.toFixed(2) : '—'}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════
// Cross-model special views
// ═══════════════════════════════════════

function PopularityMap({ popMap }) {
  if (!popMap || !popMap.length) return null;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.white, marginBottom: 4 }}>Popularity Score → Streams Mapping</div>
      <div style={{ fontSize: 12, color: C.grayDark, marginBottom: 12 }}>Each +5 popularity ≈ 2x daily streams (log-linear)</div>
      <div style={{ height: 280 }}>
        <Bar data={{
          labels: popMap.map(p => p.range),
          datasets: [
            { label: 'Median Daily Streams', data: popMap.map(p => p.median_daily ?? 0),
              backgroundColor: C.green + '99', borderColor: C.green, borderWidth: 1, borderRadius: 3, yAxisID: 'y' },
            { label: 'Avg Save Rate', data: popMap.map(p => p.avg_save_rate != null ? p.avg_save_rate * 100 : 0),
              type: 'line', borderColor: C.purple, backgroundColor: C.purple + '20',
              pointBackgroundColor: C.purple, pointRadius: 4, yAxisID: 'y1', fill: true }
          ]
        }} options={{
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: C.gray, font: { size: 11 } } } },
          scales: {
            x: { grid: { color: C.border + '40' }, ticks: { color: C.grayDark, font: { size: 10 } } },
            y: { position: 'left', grid: { color: C.border + '40' }, ticks: { color: C.green, font: { size: 10 },
              callback: v => v > 1e6 ? `${(v/1e6).toFixed(1)}M` : v > 1e3 ? `${(v/1e3).toFixed(0)}K` : v } },
            y1: { position: 'right', grid: { display: false }, ticks: { color: C.purple, font: { size: 10 },
              callback: v => v.toFixed(1) + '%' }, min: 0, max: 4 }
          }
        }} />
      </div>
    </div>
  );
}

function SaveRateChart({ srData }) {
  if (!srData || !srData.length) return null;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.white, marginBottom: 4 }}>Save Rate vs Stream Growth</div>
      <div style={{ fontSize: 12, color: C.grayDark, marginBottom: 12 }}>Save rate is the #1 signal — 32.4pt spread between growing and declining artists</div>
      <div style={{ height: 260 }}>
        <Bar data={{
          labels: srData.map(s => s.label),
          datasets: [
            { label: 'Stream Growth %', data: srData.map(s => s.median_stream_growth ?? 0),
              backgroundColor: srData.map(s => (s.median_stream_growth ?? 0) > 0 ? C.green + '99' : C.red + '99'),
              borderColor: srData.map(s => (s.median_stream_growth ?? 0) > 0 ? C.green : C.red),
              borderWidth: 1, borderRadius: 3 },
            { label: 'Listener Growth %', data: srData.map(s => s.median_listener_growth ?? 0),
              backgroundColor: srData.map(s => (s.median_listener_growth ?? 0) > 0 ? C.blue + '66' : C.amber + '66'),
              borderColor: srData.map(s => (s.median_listener_growth ?? 0) > 0 ? C.blue : C.amber),
              borderWidth: 1, borderRadius: 3 }
          ]
        }} options={{
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: C.gray, font: { size: 11 } } } },
          scales: {
            x: { grid: { color: C.border + '40' }, ticks: { color: C.grayDark } },
            y: { grid: { color: C.border + '40' }, ticks: { color: C.grayDark, callback: v => v + '%' } }
          }
        }} />
      </div>
    </div>
  );
}

function BudgetTierChart({ tiers }) {
  if (!tiers || !tiers.length) return null;
  const tierColors = { SCALE_AGGRESSIVELY: C.green, INCREASE_BUDGET: C.emerald, MAINTAIN_BUDGET: C.blue, REDUCE_BUDGET: C.amber, CUT_LOSSES: C.red };
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.white, marginBottom: 4 }}>Budget Tier Validation</div>
      <div style={{ fontSize: 12, color: C.grayDark, marginBottom: 16 }}>Model 23 tiers validated against momentum classification</div>
      {tiers.map((t, i) => (
        <div key={i} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: tierColors[t.tier] || C.gray }}>{t.tier.replace(/_/g, ' ')}</span>
            <span style={{ fontSize: 12, color: C.gray }}>{t.count} artists · Save rate: {t.avg_save_rate != null ? (t.avg_save_rate * 100).toFixed(2) : '—'}%</span>
          </div>
          <div style={{ display: 'flex', gap: 3, height: 20 }}>
            {Object.entries(t.momentum_dist || {}).map(([k, v]) => {
              const momColors = { Accelerating: C.green, Steady: C.blue, Plateauing: C.amber, Declining: C.red, Volatile: C.purple };
              const pct = (v / t.count) * 100;
              return pct > 0 ? (
                <div key={k} title={`${k}: ${v} (${pct.toFixed(0)}%)`}
                  style={{ width: `${pct}%`, background: momColors[k] || C.grayDark, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, color: C.white, fontWeight: 600, overflow: 'hidden' }}>
                  {pct > 15 ? k.slice(0, 3) : ''}
                </div>
              ) : null;
            })}
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
        {['Accelerating','Steady','Plateauing','Declining','Volatile'].map(k => {
          const momColors = { Accelerating: C.green, Steady: C.blue, Plateauing: C.amber, Declining: C.red, Volatile: C.purple };
          return <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: C.gray }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: momColors[k] }} />{k}</div>;
        })}
      </div>
    </div>
  );
}

function RosterDistChart({ dist }) {
  if (!dist || !dist.length) return null;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.white, marginBottom: 4 }}>Full Roster Stream Distribution</div>
      <div style={{ fontSize: 12, color: C.grayDark, marginBottom: 12 }}>231,738 artists — cumulative % exceeding each threshold</div>
      <div style={{ height: 260 }}>
        <Bar data={{
          labels: dist.map(d => {
            if (d.threshold >= 1e8) return `${d.threshold/1e6}M`;
            if (d.threshold >= 1e6) return `${d.threshold/1e6}M`;
            if (d.threshold >= 1e3) return `${d.threshold/1e3}K`;
            return d.threshold;
          }),
          datasets: [{ label: '% of artists', data: dist.map(d => d.pct),
            backgroundColor: dist.map(d => d.pct > 10 ? C.green + '99' : d.pct > 2 ? C.blue + '99' : C.purple + '99'),
            borderColor: dist.map(d => d.pct > 10 ? C.green : d.pct > 2 ? C.blue : C.purple),
            borderWidth: 1, borderRadius: 3 }]
        }} options={{
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: C.border + '40' }, ticks: { color: C.grayDark, font: { size: 10 } }, title: { display: true, text: '28-day streams threshold', color: C.grayDark } },
            y: { grid: { color: C.border + '40' }, ticks: { color: C.grayDark, callback: v => v + '%' }, title: { display: true, text: '% exceeding', color: C.grayDark } }
          }
        }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// Model explanation panel
// ═══════════════════════════════════════
function ModelExplanation({ modelKey }) {
  const info = MODEL_EXPLANATIONS[modelKey];
  if (!info) return null;
  const tierColors = { decision: C.green, signal: C.purple, investment: C.amber, context: C.blue, depth: C.emerald, market: C.orange };
  const tierLabels = { decision: 'CORE DECISION', signal: 'KEY SIGNAL', investment: 'INVESTMENT', context: 'LIFECYCLE', depth: 'FAN & REVENUE', market: 'MARKET' };
  const tc = tierColors[info.tier] || C.gray;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.white }}>About This Model</div>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: tc + '18', color: tc, letterSpacing: 1, textTransform: 'uppercase' }}>{tierLabels[info.tier]}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13, lineHeight: 1.6 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: tc, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Why It Matters</div>
          <div style={{ color: C.gray }}>{info.why}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: tc, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>How It Works</div>
          <div style={{ color: C.gray }}>{info.how}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: tc, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>How To Act On It</div>
          <div style={{ color: '#CBD5E1' }}>{info.act}</div>
        </div>
        <div style={{ padding: '10px 14px', background: tc + '08', borderRadius: 8, borderLeft: `3px solid ${tc}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: tc, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Data Signal</div>
          <div style={{ color: C.gray, fontSize: 12 }}>{info.signal}</div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// Model detail view
// ═══════════════════════════════════════
function ModelDetail({ modelKey, model, artists, crossModel }) {
  const color = MODEL_COLORS[modelKey] || C.green;

  // Special views for certain models
  if (modelKey === 'momentum' && model.distribution) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {Object.entries(model.by_momentum || {}).map(([k, v]) => (
            <StatsCard key={k} label={k} value={v.count} sub={`Avg save: ${v.avg_save_rate != null ? (v.avg_save_rate*100).toFixed(2) : '—'}% · Pop: ${v.avg_popularity ?? '—'}`} color={
              k === 'Accelerating' ? C.green : k === 'Steady' ? C.blue : k === 'Declining' ? C.red : k === 'Volatile' ? C.purple : C.amber} />
          ))}
        </div>
        <PieChart data={model.distribution} title="Momentum Distribution"
          colors={[C.amber, C.blue, C.red, C.green, C.purple]} />
      </div>
    );
  }

  if (modelKey === 'release_phase' && model.distribution) {
    return <PieChart data={model.distribution} title="Release Phase Distribution" />;
  }

  if (modelKey === 'development_stage' && model.stage_distribution) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <PieChart data={model.stage_distribution} title="Development Stage Distribution" />
        {model.histogram && <HistogramChart histogram={model.histogram} color={color} title="Stage Index Distribution" />}
        {model.top20 && <Leaderboard items={model.top20} color={color} />}
      </div>
    );
  }

  if (modelKey === 'marketing_roi' && model.tier_distribution) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <PieChart data={model.tier_distribution} title="Marketing ROI Tier Distribution" />
        {model.histogram && <HistogramChart histogram={model.histogram} color={color} title="ROI Score Distribution" />}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {model.stats && <>
            <StatsCard label="Mean" value={model.stats.mean} color={color} />
            <StatsCard label="Median" value={model.stats.median} color={color} />
            <StatsCard label="P90" value={model.stats.p90} color={color} />
            <StatsCard label="Max" value={model.stats.max} color={color} />
          </>}
        </div>
        {model.top20 && <Leaderboard items={model.top20} color={color} />}
      </div>
    );
  }

  if (modelKey === 'advance_pricing') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {model.tiers && Object.entries(model.tiers).map(([k, v]) => (
            <StatsCard key={k} label={k.replace(/_/g, ' ')} value={v} color={C.amber} />
          ))}
        </div>
        {model.histogram && <HistogramChart histogram={model.histogram} color={color} title="Advance Value Distribution" />}
        {model.top20 && <Leaderboard items={model.top20} color={color} label="Value" />}
      </div>
    );
  }

  if (modelKey === 'budget_allocation') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {model.tier_distribution && <PieChart data={model.tier_distribution} title="Budget Tier Distribution"
          colors={[C.green, C.emerald, C.blue, C.amber, C.red]} />}
        {model.action_distribution && <PieChart data={model.action_distribution} title="Recommended Actions" />}
        {model.histogram && <HistogramChart histogram={model.histogram} color={color} title="Budget Score Distribution" />}
        {crossModel?.budget_tier_validation && <BudgetTierChart tiers={crossModel.budget_tier_validation} />}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {model.stats && <>
            <StatsCard label="Mean Score" value={model.stats.mean} color={color} />
            <StatsCard label="Median" value={model.stats.median} color={color} />
            <StatsCard label="Max" value={model.stats.max} color={C.green} />
            <StatsCard label="Artists Scored" value={model.stats.count} color={C.blue} />
          </>}
        </div>
        {model.top20 && <Leaderboard items={model.top20} color={color} />}
      </div>
    );
  }

  // Default model view
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {model.stats && <>
          <StatsCard label="Mean" value={model.stats.mean} color={color} />
          <StatsCard label="Median" value={model.stats.median} color={color} />
          <StatsCard label="Std Dev" value={model.stats.std} color={C.grayDark} />
          <StatsCard label="P90" value={model.stats.p90} color={color} />
          <StatsCard label="Max" value={model.stats.max} color={C.green} />
        </>}
      </div>
      {model.histogram && <HistogramChart histogram={model.histogram} color={color} title="Score Distribution" />}
      {model.correlations && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.white, marginBottom: 8 }}>Correlations</div>
          {Object.entries(model.correlations).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
              <span style={{ color: C.gray }}>{k.replace(/vs_/g, 'vs ')}</span>
              <span style={{ color: Math.abs(v) > 0.5 ? C.green : Math.abs(v) > 0.2 ? C.blue : C.grayDark, fontWeight: 600 }}>{v}</span>
            </div>
          ))}
        </div>
      )}
      {model.top20 && <Leaderboard items={model.top20} color={color} />}
    </div>
  );
}

// ═══════════════════════════════════════
// Overview dashboard
// ═══════════════════════════════════════
function Overview({ data }) {
  const { meta, distributions, crossModel } = data;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <StatsCard label="Roster Size" value={meta.roster_size?.toLocaleString()} color={C.green} sub="Total S4A artists" />
        <StatsCard label="Scored Artists" value={meta.scored_artists} color={C.blue} sub="Full 23-model scoring" />
        <StatsCard label="Models" value={meta.models_count} color={C.purple} sub="Scoring dimensions" />
        <StatsCard label="Last Updated" value={new Date(meta.generated).toLocaleDateString()} color={C.amber} />
      </div>
      {crossModel?.signal_power_ranking && <SignalPowerChart signals={crossModel.signal_power_ranking} />}
      {crossModel?.popularity_streams_map && <PopularityMap popMap={crossModel.popularity_streams_map} />}
      {crossModel?.save_rate_vs_growth && <SaveRateChart srData={crossModel.save_rate_vs_growth} />}
      {distributions?.roster_stream_tiers && <RosterDistChart dist={distributions.roster_stream_tiers} />}
      {crossModel?.correlation_matrix && <CorrelationMatrix matrix={crossModel.correlation_matrix} />}
    </div>
  );
}

// ═══════════════════════════════════════
// MAIN PAGE COMPONENT
// ═══════════════════════════════════════
import { Fragment } from 'react';

export default function IntelligenceDashboard() {
  const [data, setData] = useState(null);
  const [activeView, setActiveView] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/data/dashboard_data.json')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { console.error('Failed to load data:', e); setLoading(false); });
  }, []);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: C.bg, color: C.green, fontSize: 18, fontFamily: 'Inter, sans-serif' }}>
      <div>Loading Rise Intelligence...</div>
    </div>
  );

  if (!data) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: C.bg, color: C.red, fontSize: 18, fontFamily: 'Inter, sans-serif' }}>
      <div>Failed to load data. Check /data/dashboard_data.json</div>
    </div>
  );

  const navItems = [
    { key: 'overview', label: 'Overview', icon: '📊' },
    ...MODEL_ORDER.filter(k => data.models[k]).map(k => {
      const tier = MODEL_EXPLANATIONS[k]?.tier;
      const tierIcon = { decision: '⚡', signal: '📡', investment: '💰', context: '🔄', depth: '🔥', market: '🌐' };
      return { key: k, label: data.models[k].name, icon: tierIcon[tier] || '📊' };
    }),
    { key: 'artists', label: 'Artist Search', icon: '🔍' },
  ];

  const filtered = search ? navItems.filter(n => n.label.toLowerCase().includes(search.toLowerCase())) : navItems;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', -apple-system, sans-serif", background: C.bg, color: C.white }}>
      {/* Sidebar */}
      <nav style={{ width: sidebarOpen ? 280 : 56, background: '#080C15', borderRight: `1px solid ${C.border}`,
        transition: 'width 0.2s', overflow: 'hidden', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ padding: sidebarOpen ? '20px 16px 12px' : '20px 8px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
          onClick={() => setSidebarOpen(!sidebarOpen)}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: `linear-gradient(135deg, ${C.green}, ${C.blue})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>R</div>
          {sidebarOpen && <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.white }}>Rise Intelligence</div>
            <div style={{ fontSize: 10, color: C.grayDark }}>23 Models · {data.meta.scored_artists} Artists</div>
          </div>}
        </div>
        {/* Search */}
        {sidebarOpen && (
          <div style={{ padding: '12px 16px 8px' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search models..."
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
                background: C.card, color: C.white, fontSize: 12, fontFamily: 'Inter', outline: 'none' }} />
          </div>
        )}
        {/* Nav items */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
          {filtered.map(item => (
            <div key={item.key} onClick={() => setActiveView(item.key)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: sidebarOpen ? '8px 12px' : '8px 12px',
                borderRadius: 8, cursor: 'pointer', marginBottom: 2, fontSize: 13,
                background: activeView === item.key ? C.green + '15' : 'transparent',
                color: activeView === item.key ? C.green : C.gray,
                fontWeight: activeView === item.key ? 600 : 400,
                borderLeft: activeView === item.key ? `2px solid ${C.green}` : '2px solid transparent',
                transition: 'all 0.15s' }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>{item.icon}</span>
              {sidebarOpen && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>}
            </div>
          ))}
        </div>
        {/* Footer */}
        {sidebarOpen && (
          <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}`, fontSize: 10, color: C.grayDarker }}>
            Updated: {new Date(data.meta.generated).toLocaleString()}
          </div>
        )}
      </nav>

      {/* Main content */}
      <main style={{ flex: 1, padding: '32px 40px', overflowY: 'auto', maxHeight: '100vh' }}>
        {activeView === 'overview' && (
          <>
            <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 4 }}>Intelligence Overview</h1>
            <p style={{ fontSize: 14, color: C.grayDark, marginBottom: 24 }}>Cross-model insights from {data.meta.scored_artists} scored artists across {data.meta.models_count} dimensions</p>
            <Overview data={data} />
          </>
        )}

        {activeView === 'artists' && <ArtistSearch artists={data.artists} />}

        {data.models[activeView] && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: MODEL_COLORS[activeView] + '20',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: MODEL_COLORS[activeView] }}>
                {data.models[activeView].number}
              </div>
              <h1 style={{ fontSize: 28, fontWeight: 800 }}>{data.models[activeView].name}</h1>
            </div>
            <p style={{ fontSize: 14, color: C.grayDark, marginBottom: 24 }}>{data.models[activeView].description}</p>
            <ModelDetail modelKey={activeView} model={data.models[activeView]} artists={data.artists} crossModel={data.crossModel} />
            <ModelExplanation modelKey={activeView} />
          </>
        )}
      </main>
    </div>
  );
}

function ArtistSearch({ artists }) {
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('IRS');
  const [sortDir, setSortDir] = useState('desc');

  const sortOpts = ['IRS','budget_score','streams_28d','spotify_popularity','save_rate','Advance_Pricing','marketing_roi_score','sync_readiness_score'];

  let filtered = artists;
  if (query) filtered = artists.filter(a => a.artist_name?.toLowerCase().includes(query.toLowerCase()));
  filtered = [...filtered].sort((a, b) => {
    const va = a[sortBy] || 0, vb = b[sortBy] || 0;
    return sortDir === 'desc' ? vb - va : va - vb;
  }).slice(0, 100);

  const fmt = (v, key) => {
    if (v == null) return '—';
    if (key === 'save_rate') return (v * 100).toFixed(2) + '%';
    if (key === 'Advance_Pricing') return '$' + (v / 1e6).toFixed(1) + 'M';
    if (key === 'streams_28d') return (v / 1e6).toFixed(1) + 'M';
    if (typeof v === 'number') return v > 1000 ? v.toLocaleString() : v.toFixed(1);
    return v;
  };

  return (
    <div>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 4 }}>Artist Search</h1>
      <p style={{ fontSize: 14, color: C.grayDark, marginBottom: 16 }}>Search and sort {artists.length} scored artists across all models</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search artist name..."
          style={{ flex: '1 1 200px', padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.border}`,
            background: C.card, color: C.white, fontSize: 13, fontFamily: 'Inter', outline: 'none' }} />
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.border}`,
            background: C.card, color: C.white, fontSize: 13, fontFamily: 'Inter' }}>
          {sortOpts.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
        </select>
        <button onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
          style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.border}`,
            background: C.card, color: C.green, fontSize: 13, fontFamily: 'Inter', cursor: 'pointer' }}>
          {sortDir === 'desc' ? '↓ High→Low' : '↑ Low→High'}
        </button>
      </div>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['#','Artist','IRS','Budget','Streams 28d','Pop','Save Rate','Advance','Momentum','Tier'].map(h => (
                  <th key={h} style={{ padding: '10px 8px', textAlign: h === 'Artist' ? 'left' : 'right', color: C.grayDark, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((a, i) => (
                <tr key={a.artist_id || i} style={{ borderBottom: `1px solid ${C.border}20` }}>
                  <td style={{ padding: '8px', color: C.grayDark, textAlign: 'right' }}>{i+1}</td>
                  <td style={{ padding: '8px', color: C.white, fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.artist_name}</td>
                  <td style={{ padding: '8px', color: C.green, fontWeight: 600, textAlign: 'right' }}>{fmt(a.IRS, 'IRS')}</td>
                  <td style={{ padding: '8px', color: C.blue, fontWeight: 600, textAlign: 'right' }}>{fmt(a.budget_score, 'budget_score')}</td>
                  <td style={{ padding: '8px', textAlign: 'right', color: C.gray }}>{fmt(a.streams_28d, 'streams_28d')}</td>
                  <td style={{ padding: '8px', textAlign: 'right', color: C.amber }}>{a.spotify_popularity}</td>
                  <td style={{ padding: '8px', textAlign: 'right', color: C.purple }}>{fmt(a.save_rate, 'save_rate')}</td>
                  <td style={{ padding: '8px', textAlign: 'right', color: C.gray }}>{fmt(a.Advance_Pricing, 'Advance_Pricing')}</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>
                    <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                      background: a.Momentum === 'Accelerating' ? C.green+'20' : a.Momentum === 'Declining' ? C.red+'20' : C.amber+'15',
                      color: a.Momentum === 'Accelerating' ? C.green : a.Momentum === 'Declining' ? C.red : C.amber }}>{a.Momentum}</span>
                  </td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>
                    <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                      background: a.tier === 'SCALE_AGGRESSIVELY' ? C.green+'20' : a.tier === 'CUT_LOSSES' ? C.red+'20' : C.blue+'15',
                      color: a.tier === 'SCALE_AGGRESSIVELY' ? C.green : a.tier === 'CUT_LOSSES' ? C.red : C.blue }}>{a.tier?.replace(/_/g,' ')}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
