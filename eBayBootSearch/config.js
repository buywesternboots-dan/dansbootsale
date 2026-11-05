/*
 * Boot Search settings. Loaded before js/app.js (see index.html). Plain JavaScript, no build step.
 *
 * AFFILIATE SWITCH: there is ONE, and it lives on the server, not in this file.
 *   Paid (EPN) links and the "Ad · Paid links" disclosure appear only when /api/boots?status=1
 *   reports affiliate: true, which needs BOTH server env vars EPN_ENABLED=true and a 10-digit
 *   EPN_CAMPAIGN_ID. The server may also name the profile (EPN_PROFILE, default "dbs").
 *   With the server switch off, or on a static host with no /api, every link is a clean,
 *   direct eBay URL and no disclosure is shown (it would be untrue).
 *   Nothing in this file can turn paid links on by itself.
 *   Even when on, links stay clean for: "Sold" searches, eBay sites with no EPN program
 *   (Poland, Hong Kong, Singapore, Malaysia, Philippines), and any profile whose campaign ID
 *   is still a placeholder or that has no disclosure text.
 *
 * PROFILES
 *   "dbs" = Dan's Boot Sale's real, existing EPN campaigns. Do not edit these values.
 *   "wbw" = Western Boot World. No WBW campaign exists yet, so it holds the placeholder
 *     "<WBW_CAMPID>". Placeholders are never sent to eBay: the builder only accepts a
 *     10-digit campaign ID, so a placeholder profile always produces clean links.
 *   Each profile carries its own disclosure naming the EPN account holder.
 *   customidPrefix is a placement label only, never anything about the shopper.
 *   Never make up a campaign ID.
 */
window.BOOTSEARCH_CONFIG = {
  // TOOL NAME: change it here, nowhere else. The banner, page heading and browser-tab title
  // all read these two lines. (EPN rule: the tool name must not contain "eBay".)
  // After changing it, run `node scripts/build-banner.js` to refresh the link-preview
  // image and the <title>/meta tags that link previews read without running JavaScript.
  toolName: "Dusty's Boot Finder",
  toolSubtitle: 'Searches live eBay listings',

  siteName: "Dan's Boot Sale",
  homeUrl: '/',
  shareUrl: '/boot-search',   // preferred public address (/eBayBootSearch still works)

  affiliate: {
    // No "enabled" flag here on purpose: the server decides (see top of file).
    activeProfile: 'dbs',    // used when the server doesn't name one
    toolid: '10001',
    profiles: {
      dbs: {
        label: "Dan's Boot Sale",
        campaigns: { web: '5339171324', mobile: '5339171325' }, // real DBS campaigns (unused while the server switch is off)
        customidPrefix: 'dbs-bootsearch',                        // placement label, not an ID
        disclosure: "Ad · Paid links. As an eBay Partner Network Affiliate, Dan's Boot Sale earns from qualifying purchases."
      },
      wbw: {
        label: 'Western Boot World',
        campaigns: { web: '<WBW_CAMPID>', mobile: '<WBW_CAMPID>' }, // placeholder: no WBW campaign yet
        customidPrefix: 'wbw-bootsearch',
        disclosure: 'Ad · Paid links. As an eBay Partner Network Affiliate, Western Boot World earns from qualifying purchases.'
      }
    },
    // Optional link to a full disclosure page. null = no link (set to '/affiliate-disclosure'
    // once that page is published, so the link never 404s).
    disclosurePageUrl: null
  },

  // Always shown, affiliate on or off.
  nonEndorsement: 'This tool is not affiliated with or endorsed by eBay.',

  // "My Boots" (js/store.js): kept in the visitor's browser only, as eBay item IDs and search
  // criteria. Never listing titles, prices or photos, and never affiliate links.
  //   markSeenOn: 'click' (default) = a card is "Seen" once its eBay link is clicked;
  //               'view'  = also when the whole card has scrolled into view.
  //   itemTtlHours: ♥ picks and hidden listings drop off after this many hours (eBay data rule: 6 max).
  //   historyDays: viewed listings and recent searches are kept this many days.
  //   runAllMax / runAllConcurrency / runAllDelayMs: "Run all my searches" limits (eBay call budget).
  shopper: { markSeenOn: 'click', maxEntries: 2000, itemTtlHours: 6, historyDays: 30, maxSavedSearches: 20,
    runAllMax: 12, runAllConcurrency: 2, runAllDelayMs: 250 },

  // localStorage key for the saved form settings. The old "ebay_boot_prefs" key (same field
  // names) is moved here on first load and then deleted (js/app.js).
  storageKey: 'dusty_prefs'
};
