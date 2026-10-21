/*
 * Option lists and eBay site tables for Boot Search.
 * Copied from the original React tool; changes are noted inline.
 * Works in the browser (window.BOOTSEARCH_DATA) and in Node (module.exports) for tests.
 */
(function (root) {
  'use strict';

  // The old tool also offered "Under 5" / "17+" (mens) and "Under 4" / "13+" (womens),
  // but silently dropped them from the search. They are removed here so no pick is ignored.
  var SIZES_MENS = ['5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5',
    '12', '12.5', '13', '13.5', '14', '14.5', '15', '15.5', '16', '16.5', '17'];
  var SIZES_WOMENS = ['4', '4.5', '5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5',
    '11', '11.5', '12', '12.5', '13'];

  // "Not Specified" is shown but never sent (same as before).
  var WIDTHS = ['A', 'AA', 'AAA', 'AAAA', 'B', 'C', 'D', 'E', 'EE', 'EEE', 'EEEE', 'EEEEE', 'EEEEEE', 'EW',
    'F', 'G', 'H', 'M', 'N', 'R', 'W', 'Standard', 'Not Specified'];

  var CONDITIONS = ['New', 'Used'];
  var CONDITION_CODES = { New: ['1000', '1500', '1750'], Used: ['3000'] };

  var COLORS = ['Not specified', 'Black', 'Brown', 'Tan', 'Red', 'Blue', 'White', 'Burgundy', 'Gold', 'Silver',
    'Two-tone', 'Multi-color'];

  var VINTAGE = ['Yes', 'No', 'Not specified'];
  var HANDMADE = ['Handmade', 'Not handmade', 'Not specified'];

  var COUNTRIES_MAIN = ['Not specified', 'USA', 'Mexico', 'Canada', 'Spain', 'Italy'];
  var COUNTRIES_MORE = ['Germany', 'France', 'UK', 'Brazil', 'China', 'India', 'Japan', 'South Korea', 'Taiwan', 'Vietnam'];
  var COUNTRY_ASPECT_VALUE = { USA: 'United States' }; // eBay's value for the aspect

  // "Unbranded" is a separate checkbox. The old "Not Specified" brand box did nothing and is gone.
  var BRANDS = ['Abilene', 'Acme', 'Alamo', 'Alan Bell', 'Ammons', 'Anderson Bean', 'Ariat', 'ASC', 'Austin Hall',
    'Ayers', 'Beck', 'Black Jack', 'Blackjack Western', 'Blucher', 'Boulet', 'Brahma', 'Caboots', 'Carlos Lujan',
    'Cavender', 'Champion', 'Champion Attitude', 'Chippewa', 'Chisos Boots', 'Chris Vaccari', 'Circle G',
    'Clint Hines', 'Code West', 'Cody James', 'Corral', 'Cowtown', 'Crown', 'Cuadra', 'Cutter Bill', 'Dan Post',
    'Dave Wheeler', 'Dingo', 'Dixon', 'Double D Ranch', 'Double-H', 'Durango', 'El Dorado', 'El General',
    'Falconhead', 'Fenoglio', 'Ferrini', 'Freebird', 'Frye', 'Garner Moss', 'GM Boots', 'Griffith Blucher',
    'Heritage', 'Heritage Boot', 'Hondo', 'Horse Power', 'Hyer', 'J. Chisholm', 'J.B. Dillon', 'J.B. Hill',
    'Jerrod Ammons', 'Jimmy Farris', 'Joe Boots', 'Joe DeLeon', 'JRC & Sons', 'Junk Gypsy', 'Justin', 'Kemo Sabe',
    'Kim Jones', 'Kimmel', 'King Exotic', 'King Welt', 'Kinney', 'La Sierra', 'Lagrange Leather', 'Lane Boots',
    'Laramie', 'Laredo', 'Larry Mahan', 'Las Botas Establo', 'LE VER', 'Lee Downey', 'Lee Miller', 'Liberty',
    'Liberty Black', 'Liberty Boot Co', 'Liberty Boots Mexico', 'Lisa Sorrell', "Little's", 'LM Easterling',
    'Longhorn', 'Los Altos', 'Loveless', 'Lucchese', "Luskey's", 'M.L. Leddy', 'Macie Bean', 'Masterson', 'Mayura',
    'Mendoza', 'Mercedes of Texas', 'Mike Norris', 'Miller', 'Miron Crosby', 'Montana', "Moran's",
    'Nathaniel Hearn', 'Nine West', 'Nocona', 'Olathe', 'Old Gringo', 'Old West', 'Oliverio Tortamundo',
    'Olsen-Stelzer', 'Pablo Jass', 'Panhandle Slim', 'Paul Bond', 'Pinto Ranch', 'Ponder', 'R Watson',
    'Ranch at Dove Tree', 'Ranch Road Boots', 'Rancho', 'Rancho Semental', 'Rebelde', 'Red Wing',
    'Republic Boot Company', 'Resistol', 'Rhodes Footwear', 'Rio Grande Boots', 'Rios of Mercedes',
    'Robert Landrum', 'Rockin Leather', 'Rocketbuster', 'Rocky', 'Rod Patrick', 'Rodeo Cartie', 'Rodney Harper',
    'Rodney White', 'Roper', 'Rujo Boots', 'Sanders', "Santana's", 'SAS', 'Scott McCray', 'Sendra',
    'Shorty Golden', 'Shyanne', 'Smoky Mountain', 'Stallion', 'Stetson', 'Stewart', 'T.O. Stanley', 'Tecovas',
    'Texas', 'Texas Traditions', 'The Old Boot Factory', 'Thorogood', 'Tin Haul', 'Tony Lama', 'Tres Caballos',
    'Tres Outlaws', 'Twisted X', 'Twister', 'Wesco', 'Wheeler', 'Wild West Boots', 'Will Roman', 'Willie Lusk',
    'Wolverine', 'Wrangler', 'Yippee Ki Yay', 'Zodiac'];

  var REGIONS = [
    { label: 'USA', domain: 'ebay.com' }, { label: 'UK', domain: 'ebay.co.uk' },
    { label: 'Canada', domain: 'ebay.ca' }, { label: 'Australia', domain: 'ebay.com.au' },
    { label: 'Germany', domain: 'ebay.de' }, { label: 'France', domain: 'ebay.fr' },
    { label: 'Italy', domain: 'ebay.it' }, { label: 'Spain', domain: 'ebay.es' },
    { label: 'Netherlands', domain: 'ebay.nl' }, { label: 'Belgium', domain: 'ebay.be' },
    { label: 'Austria', domain: 'ebay.at' }, { label: 'Switzerland', domain: 'ebay.ch' },
    { label: 'Ireland', domain: 'ebay.ie' }, { label: 'Poland', domain: 'ebay.pl' },
    { label: 'Hong Kong', domain: 'ebay.com.hk' }, { label: 'Singapore', domain: 'ebay.com.sg' },
    { label: 'Malaysia', domain: 'ebay.com.my' }, { label: 'Philippines', domain: 'ebay.ph' }
  ];

  // EPN rotation IDs (mkrid). Only these 13 sites have an EPN program. Sites not listed
  // here always get clean links (the old tool wrongly fell back to the US rotation ID).
  var EPN_ROTATION = {
    'ebay.com': '711-53200-19255-0', 'ebay.co.uk': '710-53481-19255-0', 'ebay.ca': '706-53473-19255-0',
    'ebay.com.au': '705-53470-19255-0', 'ebay.de': '707-53477-19255-0', 'ebay.fr': '709-53476-19255-0',
    'ebay.it': '724-53478-19255-0', 'ebay.es': '1185-53479-19255-0', 'ebay.nl': '1346-53482-19255-0',
    'ebay.at': '5221-53469-19255-0', 'ebay.ch': '5222-53480-19255-0', 'ebay.ie': '5282-53468-19255-0',
    'ebay.be': '1553-53471-19255-0'
  };
  // eBay site IDs (siteid), used only alongside the EPN params above.
  var EBAY_SITE_ID = {
    'ebay.com': '0', 'ebay.co.uk': '3', 'ebay.ca': '2', 'ebay.com.au': '15', 'ebay.de': '77', 'ebay.fr': '71',
    'ebay.it': '101', 'ebay.es': '186', 'ebay.nl': '146', 'ebay.be': '23', 'ebay.at': '16', 'ebay.ch': '193',
    'ebay.ie': '205', 'ebay.pl': '212'
  };

  // eBay categories: Men's Boots, Women's Boots, and Clothing, Shoes & Accessories (for "Both").
  var CATEGORY = { mens: '11498', womens: '53557', both: '11450', none: '0' };

  var SALE_TYPES = [
    { value: 'all', label: 'All' }, { value: 'auction_only', label: 'Auction only' },
    { value: 'fixed_best_offer_only', label: 'Buy It Now / Best Offer' }, { value: 'best_offer_only', label: 'Best Offer only' }
  ];
  var SORTS = [
    { value: 'newlyListed', label: 'Newly listed', sop: '10' }, { value: 'endingSoonest', label: 'Ending soonest', sop: '1' },
    { value: 'priceLowToHigh', label: 'Price: low to high', sop: '15' }, { value: 'priceHighToLow', label: 'Price: high to low', sop: '16' },
    { value: 'bestMatch', label: 'Best match', sop: '12' }
  ];
  var AVAILABILITY = [{ value: 'available', label: 'Available Boots' }, { value: 'sold', label: 'Sold Boots' }];
  var DISTANCES = ['5', '10', '25', '50', '100'];
  // Currency shown next to prices in the on-page summary (eBay uses the site's own currency).
  var CURRENCY = { 'ebay.com': '$', 'ebay.co.uk': '£', 'ebay.ca': 'C$', 'ebay.com.au': 'A$', 'ebay.de': '€', 'ebay.fr': '€',
    'ebay.it': '€', 'ebay.es': '€', 'ebay.nl': '€', 'ebay.be': '€', 'ebay.at': '€', 'ebay.ch': 'CHF ', 'ebay.ie': '€',
    'ebay.pl': 'zł ', 'ebay.com.hk': 'HK$', 'ebay.com.sg': 'S$', 'ebay.com.my': 'RM ', 'ebay.ph': '₱' };

  var DATA = {
    SIZES_MENS: SIZES_MENS, SIZES_WOMENS: SIZES_WOMENS, WIDTHS: WIDTHS, CONDITIONS: CONDITIONS,
    CONDITION_CODES: CONDITION_CODES, COLORS: COLORS, VINTAGE: VINTAGE, HANDMADE: HANDMADE,
    COUNTRIES_MAIN: COUNTRIES_MAIN, COUNTRIES_MORE: COUNTRIES_MORE, COUNTRY_ASPECT_VALUE: COUNTRY_ASPECT_VALUE,
    BRANDS: BRANDS, REGIONS: REGIONS, EPN_ROTATION: EPN_ROTATION, EBAY_SITE_ID: EBAY_SITE_ID, CATEGORY: CATEGORY,
    SALE_TYPES: SALE_TYPES, SORTS: SORTS, AVAILABILITY: AVAILABILITY, DISTANCES: DISTANCES, CURRENCY: CURRENCY
  };
  if (typeof module === 'object' && module.exports) module.exports = DATA;
  else root.BOOTSEARCH_DATA = DATA;
})(this);
