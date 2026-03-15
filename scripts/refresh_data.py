#!/usr/bin/env python3
"""
Rise Intelligence Dashboard — Data Refresh Script
===================================================
Regenerates public/data/dashboard_data.json from scored CSVs.
Run after new scoring pipeline completes, then push to deploy.

Usage:  python3 scripts/refresh_data.py
"""
import os, json, sys
import pandas as pd, numpy as np
from pathlib import Path

# Paths
BASE = Path.home() / "Documents" / "Codex - Rise" / "tmp"
REPO = Path(__file__).parent.parent
OUT = REPO / "public" / "data" / "dashboard_data.json"

def make_histogram(series, bins=20):
    s = series.dropna()
    if len(s)==0: return {"bins":[],"counts":[]}
    counts, edges = np.histogram(s, bins=bins)
    return {"bins":[round(float(e),2) for e in edges],
            "counts":[int(c) for c in counts]}

def make_top_n(df, col, n=20):
    top = df.nlargest(n, col)[['artist_name', col]].copy()
    top[col] = top[col].round(2)
    return [{"name":r['artist_name'],"score":r[col]}
            for _,r in top.iterrows()]

def make_stats(series):
    s = series.dropna()
    return {"mean":round(float(s.mean()),2),
            "median":round(float(s.median()),2),
            "std":round(float(s.std()),2),
            "min":round(float(s.min()),2),
            "max":round(float(s.max()),2),
            "p25":round(float(s.quantile(0.25)),2),
            "p75":round(float(s.quantile(0.75)),2),
            "p90":round(float(s.quantile(0.90)),2),
            "p95":round(float(s.quantile(0.95)),2),
            "count":int(len(s))}

def main():
    print("Loading data...")
    scores = pd.read_csv(BASE / "top500_all_scores.csv")
    mkt = pd.read_csv(BASE / "marketing_models_scored.csv")
    budget = pd.read_csv(BASE / "budget_allocation_scores.csv")
    roster = json.load(open(BASE / "s4a_roster_with_ids.json"))
    rs = np.array([r['streams'] for r in roster
                   if r.get('streams') and r['streams'] > 0])

    # Merge
    m = scores.merge(mkt, on='artist_id', how='left',
                     suffixes=('','_mkt'))
    m = m.merge(
        budget[['artist_id','budget_score','tier','action',
                'budget_multiplier']],
        on='artist_id', how='left', suffixes=('','_ba'))
    m['save_rate'] = (m['saves_28d'] /
                      m['streams_28d_mkt'].replace(0, np.nan))
    m['daily_streams'] = (m['streams_28d'] / 28).round(0)

    data = {
        "meta": {
            "generated": pd.Timestamp.now().isoformat(),
            "roster_size": len(roster),
            "scored_artists": len(m),
            "models_count": 23,
        },
        "models": {}, "artists": [], "distributions": {},
        "crossModel": {},
    }

    # Artists
    acols = [c for c in [
        'artist_name','artist_id','IRS','Momentum',
        'Release_Phase','Advance_Pricing','Scale','Growth',
        'Engagement','Market_Fit','Volatility','Release_Recency',
        'Listener_Concentration','Playlist_Performance',
        'Superfan_Index','Revenue_Stability','Upside_Potential',
        'streams_28d','listeners_28d','spotify_popularity',
        'followers_total','saves_28d','save_rate','daily_streams',
        'playlist_adds_28d','streams_per_listener',
        'super_listeners','monthly_listeners','composite_score',
        'marketing_roi_score','marketing_roi_tier',
        'advance_recoupment_base_months','development_stage',
        'stage_index','social_conversion_score',
        'sync_readiness_score','territorial_growth_score',
        'fan_monetization_score','budget_score','tier','action',
        'budget_multiplier','saves_28d_change_pct',
        'playlist_adds_28d_change_pct','streams_28d_change_pct',
        'listeners_28d_change_pct',
        'new_active_listeners_change_pct',
        'home_streams_delta_pct','num_songs',
    ] if c in m.columns]
    adf = m[acols].where(pd.notnull(m[acols]), None)
    data["artists"] = json.loads(adf.to_json(orient='records'))

    # Models 1-15
    data["models"]["irs"] = {
        "name":"Investment Readiness Score","number":1,
        "description":"Composite 0-100 score for investment readiness",
        "histogram":make_histogram(m['IRS'],30),
        "stats":make_stats(m['IRS']),
        "top20":make_top_n(m,'IRS'),
        "correlations":{
            "vs_popularity":round(float(
                m[['IRS','spotify_popularity']].corr().iloc[0,1]),3),
            "vs_streams":round(float(
                m[['IRS','streams_28d']].corr().iloc[0,1]),3),
            "vs_save_rate":round(float(
                m[['IRS','save_rate']].dropna().corr().iloc[0,1]),3),
        }
    }
    mc = m['Momentum'].value_counts().to_dict()
    mom_by = {}
    for mo in m['Momentum'].unique():
        s = m[m['Momentum']==mo]
        mom_by[mo] = {
            "count":int(len(s)),
            "avg_streams":round(float(s['streams_28d'].mean())),
            "avg_irs":round(float(s['IRS'].mean()),2),
            "avg_save_rate":round(float(s['save_rate'].mean()),4),
            "avg_popularity":round(float(
                s['spotify_popularity'].mean()),1),
        }
    data["models"]["momentum"] = {
        "name":"Momentum","number":2,
        "description":"Trajectory classification",
        "distribution":{k:int(v) for k,v in mc.items()},
        "by_momentum":mom_by,
    }
    rpc = m['Release_Phase'].value_counts().to_dict()
    data["models"]["release_phase"] = {
        "name":"Release Phase","number":3,
        "description":"Current lifecycle phase",
        "distribution":{k:int(v) for k,v in rpc.items()},
    }
    data["models"]["advance_pricing"] = {
        "name":"Advance Pricing","number":4,
        "description":"Estimated advance value",
        "histogram":make_histogram(m['Advance_Pricing'],25),
        "stats":make_stats(m['Advance_Pricing']),
        "top20":make_top_n(m,'Advance_Pricing'),
        "tiers":{
            "under_500k":int((m['Advance_Pricing']<5e5).sum()),
            "500k_1m":int(((m['Advance_Pricing']>=5e5)&
                           (m['Advance_Pricing']<1e6)).sum()),
            "1m_5m":int(((m['Advance_Pricing']>=1e6)&
                         (m['Advance_Pricing']<5e6)).sum()),
            "5m_10m":int(((m['Advance_Pricing']>=5e6)&
                          (m['Advance_Pricing']<1e7)).sum()),
            "over_10m":int((m['Advance_Pricing']>=1e7).sum()),
        }
    }
    for num,key,col in [
        (5,'scale','Scale'),(6,'growth','Growth'),
        (7,'engagement','Engagement'),(8,'market_fit','Market_Fit'),
        (9,'volatility','Volatility'),
        (10,'release_recency','Release_Recency'),
        (11,'listener_concentration','Listener_Concentration'),
        (12,'playlist_performance','Playlist_Performance'),
        (13,'superfan_index','Superfan_Index'),
        (14,'revenue_stability','Revenue_Stability'),
        (15,'upside_potential','Upside_Potential'),
    ]:
        if col in m.columns:
            data["models"][key] = {
                "name":col.replace('_',' ').title(),"number":num,
                "description":f"Model {num}",
                "histogram":make_histogram(m[col],25),
                "stats":make_stats(m[col]),
                "top20":make_top_n(m,col),
            }

    # Models 16-22
    for num,key,col,name in [
        (16,'marketing_roi','marketing_roi_score','Marketing ROI'),
        (17,'advance_recoupment','advance_recoupment_base_months',
         'Advance Recoupment'),
        (18,'development_stage','stage_index','Development Stage'),
        (19,'social_conversion','social_conversion_score',
         'Social Conversion'),
        (20,'sync_readiness','sync_readiness_score',
         'Sync Readiness'),
        (21,'territorial_growth','territorial_growth_score',
         'Territorial Growth'),
        (22,'fan_monetization','fan_monetization_score',
         'Fan Monetization'),
    ]:
        if col in m.columns:
            data["models"][key] = {
                "name":name,"number":num,
                "description":f"Model {num}: {name}",
                "histogram":make_histogram(m[col],25),
                "stats":make_stats(m[col]),
                "top20":make_top_n(m,col),
            }
    if 'development_stage' in m.columns:
        data["models"]["development_stage"]["stage_distribution"] = {
            str(k):int(v) for k,v
            in m['development_stage'].value_counts().to_dict().items()
        }
    if 'marketing_roi_tier' in m.columns:
        data["models"]["marketing_roi"]["tier_distribution"] = {
            str(k):int(v) for k,v
            in m['marketing_roi_tier'].value_counts().to_dict().items()
        }

    # Model 23
    bs = m['budget_score'].dropna()
    data["models"]["budget_allocation"] = {
        "name":"Budget Allocation","number":23,
        "description":"Real-time marketing budget engine",
        "histogram":make_histogram(bs,25),
        "stats":make_stats(bs),
        "top20":make_top_n(m.dropna(subset=['budget_score']),
                           'budget_score'),
        "tier_distribution":{
            str(k):int(v)
            for k,v in m['tier'].value_counts().to_dict().items()
        } if 'tier' in m.columns else {},
        "action_distribution":{
            str(k):int(v)
            for k,v in m['action'].value_counts().to_dict().items()
        } if 'action' in m.columns else {},
    }

    # Cross-model analyses
    pop_map = []
    for pop in range(0,90,5):
        sub = m[(m['spotify_popularity']>=pop)&
                (m['spotify_popularity']<pop+5)]
        if len(sub)>=2:
            pop_map.append({
                "range":f"{pop}-{pop+5}",
                "count":int(len(sub)),
                "median_daily":round(float(
                    sub['daily_streams'].median())),
                "median_28d":round(float(
                    sub['streams_28d'].median())),
                "avg_save_rate":round(float(
                    sub['save_rate'].mean()),4),
            })
    data["crossModel"]["popularity_streams_map"] = pop_map

    sr_growth = []
    for lo,hi,label in [(0,.01,'<1%'),(.01,.015,'1-1.5%'),
        (.015,.02,'1.5-2%'),(.02,.03,'2-3%'),(.03,.05,'3-5%'),
        (.05,1,'5%+')]:
        sub = m[(m['save_rate']>=lo)&(m['save_rate']<hi)]
        if len(sub)>=3:
            sr_growth.append({
                "label":label,"count":int(len(sub)),
                "median_stream_growth":round(float(
                    sub['streams_28d_change_pct'].median()),2),
                "median_listener_growth":round(float(
                    sub['listeners_28d_change_pct'].median()),2),
                "momentum_dist":{str(k):int(v) for k,v in
                    sub['Momentum'].value_counts().to_dict().items()},
            })
    data["crossModel"]["save_rate_vs_growth"] = sr_growth

    tier_val = []
    for t in ['SCALE_AGGRESSIVELY','INCREASE_BUDGET',
              'MAINTAIN_BUDGET','REDUCE_BUDGET','CUT_LOSSES']:
        sub = m[m['tier']==t]
        if len(sub)>0:
            tier_val.append({
                "tier":t,"count":int(len(sub)),
                "avg_save_rate":round(float(
                    sub['save_rate'].mean()),4),
                "avg_popularity":round(float(
                    sub['spotify_popularity'].mean()),1),
                "momentum_dist":{str(k):int(v) for k,v in
                    sub['Momentum'].value_counts().to_dict().items()},
            })
    data["crossModel"]["budget_tier_validation"] = tier_val

    growing = m[m['streams_28d_change_pct']>5]
    declining = m[m['streams_28d_change_pct']<-5]
    sp = []
    for sig in ['save_rate','streams_per_listener',
        'playlist_adds_28d_change_pct','saves_28d_change_pct',
        'new_active_listeners_change_pct',
        'home_streams_delta_pct','spotify_popularity']:
        g,d = growing[sig].median(), declining[sig].median()
        if pd.notna(g) and pd.notna(d):
            sp.append({"signal":sig,
                "growing_median":round(float(g),3),
                "declining_median":round(float(d),3),
                "spread":round(float(g-d),3)})
    data["crossModel"]["signal_power_ranking"] = sorted(
        sp, key=lambda x:abs(x['spread']), reverse=True)

    # Roster distribution
    roster_dist = []
    for t in [100,1000,5000,10000,50000,100000,500000,
              1000000,5000000,10000000,50000000,100000000]:
        c = int(np.sum(rs>=t))
        roster_dist.append({
            "threshold":t,"count":c,
            "pct":round(c/len(rs)*100,2)})
    data["distributions"]["roster_stream_tiers"] = roster_dist
    data["distributions"]["roster_stats"] = {
        "total":len(roster),
        "with_streams":int(len(rs)),
        "mean":round(float(np.mean(rs))),
        "median":round(float(np.median(rs))),
        "p90":round(float(np.percentile(rs,90))),
        "p99":round(float(np.percentile(rs,99))),
    }

    # Correlation matrix
    cc = [c for c in [
        'IRS','Scale','Growth','Engagement','Market_Fit',
        'Volatility','Playlist_Performance','Superfan_Index',
        'Revenue_Stability','Upside_Potential',
        'spotify_popularity','save_rate','budget_score',
    ] if c in m.columns]
    cm = m[cc].corr().round(3)
    data["crossModel"]["correlation_matrix"] = {
        "columns":cc,"values":cm.values.tolist()}

    # Write
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT,'w') as f:
        json.dump(data, f, indent=2, default=str)
    print(f"Wrote {OUT} ({os.path.getsize(OUT)//1024}KB)")
    print(f"Models: {len(data['models'])}")
    print(f"Artists: {len(data['artists'])}")
    print("Done. Commit and push to deploy.")

if __name__ == '__main__':
    main()
