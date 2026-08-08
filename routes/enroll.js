'use strict';

const CITY_TZ = {
  // US — Eastern
  'new york'      : 'America/New_York',
  'boston'        : 'America/New_York',
  'miami'         : 'America/New_York',
  'orlando'       : 'America/New_York',
  'tampa'         : 'America/New_York',
  'atlanta'       : 'America/New_York',
  'charlotte'     : 'America/New_York',
  'raleigh'       : 'America/New_York',
  'philadelphia'  : 'America/New_York',
  'toronto'       : 'America/New_York',
  // US — Central
  'chicago'       : 'America/Chicago',
  'dallas'        : 'America/Chicago',
  'houston'       : 'America/Chicago',
  'austin'        : 'America/Chicago',
  'san antonio'   : 'America/Chicago',
  'nashville'     : 'America/Chicago',
  'minneapolis'   : 'America/Chicago',
  'new orleans'   : 'America/Chicago',
  'winnipeg'      : 'America/Chicago',
  // US — Mountain
  'denver'        : 'America/Denver',
  'salt lake city': 'America/Denver',
  'albuquerque'   : 'America/Denver',
  'calgary'       : 'America/Denver',
  // US — Mountain no DST
  'phoenix'       : 'America/Phoenix',
  // US — Pacific
  'los angeles'   : 'America/Los_Angeles',
  'seattle'       : 'America/Los_Angeles',
  'san francisco' : 'America/Los_Angeles',
  'san diego'     : 'America/Los_Angeles',
  'las vegas'     : 'America/Los_Angeles',
  'portland'      : 'America/Los_Angeles',
  'vancouver'     : 'America/Los_Angeles',
  // AU
  'sydney'        : 'Australia/Sydney',
  'melbourne'     : 'Australia/Sydney',
  'canberra'      : 'Australia/Sydney',
  'brisbane'      : 'Australia/Brisbane',
  'gold coast'    : 'Australia/Brisbane',
  // UK
  'london'        : 'Europe/London',
};

function resolveTimezone(city = '') {
  return CITY_TZ[city.toLowerCase().trim()] || 'America/Chicago';
}

module.exports = { resolveTimezone };
