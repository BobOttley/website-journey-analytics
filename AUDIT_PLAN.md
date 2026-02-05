# SMART Journey Analytics - Data Audit Report

**Date:** 5 February 2026
**Status:** APPROVED - IMPLEMENTING FIXES

---

## Confirmed Traffic Breakdown (Last 7 Days)

| Category | Count | Percentage |
|----------|-------|------------|
| **Bots** | 150 | 67.3% |
| **Existing Parents** | 11 | 4.9% |
| **Prospective Families** | 62 | 27.8% |
| **Total** | 223 | 100% |

---

## Summary of Findings

I've audited the database and compared the numbers shown on each tab with the actual queries. Here's what I found:

### The Good News
- The raw data in `journey_events` table is consistent
- Each page's query is working as coded
- Numbers match what the code is asking for

### The Bad News
**Different pages use DIFFERENT filtering rules, making the numbers look inconsistent when they shouldn't be.**

---

## Issues Found (In Order of Severity)

### 1. CRITICAL: Families Page Includes Bot Traffic

**What you see:**
- Dashboard: **55 human visitors**
- Families: **63 total families**

**The problem:**
The Families page counts ALL traffic (including bots) when calculating "Total Families" and "Returning Families". This is why you see 47 "returning families" (76%) but only 5 "return visitors" (9%) on the Dashboard.

**What's actually happening:**
- 47 IP addresses have 2+ journeys (includes bot crawlers hitting repeatedly)
- Only 5 actual humans came back more than once

**My recommendation:** Fix the Families page to exclude bots, matching the Dashboard logic.

---

### 2. HIGH: Inconsistent "Exclude Existing Parents" Filter

**What you see:**
- Dashboard shows: **199 total** (55 humans + 144 bots)
- Bots page shows: **223 total** (73 humans + 150 bots)

**The problem:**
The Dashboard excludes 16 journeys that look like "existing parents" (entry page was /news, /calendar, etc.). The Bots page does NOT exclude these.

| Page | Uses "Exclude Parents" Filter? | Result |
|------|-------------------------------|--------|
| Dashboard | YES (full filter) | 199 journeys |
| Families | PARTIAL (shorter filter) | ~207 journeys |
| Bots | NO | 223 journeys |
| UX | YES (full filter) | 199 journeys |

**My recommendation:** Make all pages use the SAME filter for consistency.

---

### 3. MEDIUM: Two Different "Returning" Metrics

**What you see:**
- Dashboard: **5 return visitors (9%)**
- Families: **47 returning families (76%)**

**The problem:**
These measure completely different things:
- Dashboard counts **visitor_id** (browser cookie) - only 5 humans came back
- Families counts **IP address** - 47 IP addresses had 2+ visits (but many are bots)

**What this means for you:**
The "47 returning families" number is misleading. Most of those are bots crawling repeatedly, not real families coming back.

**My recommendation:**
- Families page should show "X returning families" using the same human-only logic as Dashboard
- Or rename to clarify what's being measured

---

### 4. LOW: Minor Count Differences Due to Timing

The screenshots you took show slightly different numbers than my queries (e.g., 55 vs 54 humans). This is because a few more events came in since the screenshots. This is normal and not a bug.

---

## What Each Page SHOULD Show (After Fixes)

| Metric | Current | After Fix |
|--------|---------|-----------|
| **Dashboard - Human Visitors** | 55 | ~55 (no change) |
| **Dashboard - Return Visitors** | 5 (9%) | ~5 (no change) |
| **Dashboard - Bots Filtered** | 144 | 144 (no change) |
| **Families - Total Families** | 63 (includes bots) | ~55 (humans only) |
| **Families - Returning** | 47 (76%, includes bots) | ~5 (humans only) |
| **Bots - Total Bots** | 150 | 150 (no change) |
| **Bots - Human Visitors** | 73 (no parent filter) | ~55 (with filter) |

---

## Proposed Fixes

### Fix 1: Families Page - Exclude Bots
**Files to change:** `src/db/queries.js` (getAllFamilies, getFamilyCount, getFamilyStats)

Add bot filter: `AND (is_bot = false OR is_bot IS NULL)`

### Fix 2: Families Page - Use Full "Exclude Parents" Filter
**Files to change:** `src/db/queries.js` (getAllFamilies, getFamilyCount, getFamilyStats)

Change the filter from:
```
/(news|calendar|term-dates|news-and-calendar)
```
To:
```
/(news|calendar|term-dates|news-and-calendar|115/|160/|90/|parents|uniform|admissions/fees)
```

### Fix 3: Bots Page - Add "Exclude Parents" Filter (OPTIONAL)
**Files to change:** `src/routes/bots.js` (getBotOverviewStats)

This would make the Bots page numbers match Dashboard. However, you might WANT to see all traffic including existing parents on the Bots page. Let me know your preference.

---

## Questions for You Before I Proceed

1. **Families page bot filtering:** Should Families show only human families, or all traffic? (I recommend humans only)

2. **Bots page parent filtering:** Should the Bots page exclude "existing parent" traffic to match Dashboard numbers? Or keep showing all traffic?

3. **What is a "returning" visitor to you?**
   - Someone whose browser cookie (visitor_id) shows multiple visits? (Current Dashboard logic)
   - Someone from the same IP address with multiple visits? (Current Families logic)
   - Something else?

---

## What I Will NOT Touch Without Your Approval

- Database structure
- Tracking script
- Any production data
- Calculation formulas (until you confirm which is correct)

---

**Please review this and let me know:**
1. Do these findings match what you suspected?
2. Do you agree with my proposed fixes?
3. Any questions before I make changes?
