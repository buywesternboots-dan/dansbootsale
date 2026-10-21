/*
 * Boot Search settings — the ONLY file you need to edit to change affiliate behavior.
 * Loaded before js/app.js (see index.html). Plain JavaScript, no build step.
 *
 * AFFILIATE SWITCH
 *   affiliate.enabled = false (default): every eBay link is a clean, direct search URL.
 *     No campid, customid, mkcid, mkrid, siteid, toolid or mkevt is added, and the
 *     "Ad · Paid links" notice is not shown (it would be untrue).
 *   affiliate.enabled = true: eBay Partner Network (EPN) parameters are added for the
 *     active profile, and the disclosure notice appears above the search button.
 *     Even when on, links stay clean for: "Sold" searches, eBay sites with no EPN
 *     program (Poland, Hong Kong, Singapore, Malaysia, Philippines), and any profile
 *     whose campaign ID is still a placeholder.
 *
 * PROFILES
 *   "dbs" = Dan's Boot Sale's real, existing EPN campaigns. Do not edit these values.
 *   "wbw" = Western Boot World. No WBW campaign exists yet, so it holds the placeholder
 *     "<WBW_CAMPID>". Placeholders are never sent to eBay: the builder only accepts a
 *     10-digit campaign ID, so a placeholder profile always produces clean links.
 *     When a real WBW campaign exists, replace the placeholder and set activeProfile.
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
    enabled: false,          // OFF until the owner says go
    activeProfile: 'dbs',
    toolid: '10001',
    profiles: {
      dbs: {
        label: "Dan's Boot Sale",
        campaigns: { web: '5339171324', mobile: '5339171325' }, // real DBS campaigns (unused while disabled)
        customidPrefix: 'dbs-bootsearch'                         // placement label, not an ID
      },
      wbw: {
        label: 'Western Boot World',
        campaigns: { web: '<WBW_CAMPID>', mobile: '<WBW_CAMPID>' }, // placeholder: no WBW campaign yet
        customidPrefix: 'wbw-bootsearch'
      }
    },
    // Disclosure text shown above the button while the switch is on.
    disclosure: "Ad · Paid links. As an eBay Partner Network affiliate, Dan's Boot Sale earns from qualifying purchases.",
    // Optional link to a full disclosure page. null = no link (set to '/affiliate-disclosure'
    // once that page is published, so the link never 404s).
    disclosurePageUrl: null
  },

  // Always shown, affiliate on or off.
  nonEndorsement: 'This tool is not affiliated with or endorsed by eBay.',

  // localStorage key. Same key and field names as the old React tool, so returning
  // visitors keep their saved settings.
  storageKey: 'ebay_boot_prefs'
};
