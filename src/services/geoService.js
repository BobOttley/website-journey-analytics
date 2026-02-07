/**
 * Geolocation Service
 * Uses ip-api.com (free tier: 45 requests/minute)
 * In-memory cache with 24hr TTL to minimize API calls
 */

const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Country code to flag emoji mapping
const countryFlags = {
  'GB': '🇬🇧', 'US': '🇺🇸', 'DE': '🇩🇪', 'FR': '🇫🇷', 'ES': '🇪🇸',
  'IT': '🇮🇹', 'NL': '🇳🇱', 'BE': '🇧🇪', 'CH': '🇨🇭', 'AT': '🇦🇹',
  'IE': '🇮🇪', 'PT': '🇵🇹', 'PL': '🇵🇱', 'SE': '🇸🇪', 'NO': '🇳🇴',
  'DK': '🇩🇰', 'FI': '🇫🇮', 'CZ': '🇨🇿', 'GR': '🇬🇷', 'HU': '🇭🇺',
  'RO': '🇷🇴', 'BG': '🇧🇬', 'HR': '🇭🇷', 'SK': '🇸🇰', 'SI': '🇸🇮',
  'LT': '🇱🇹', 'LV': '🇱🇻', 'EE': '🇪🇪', 'LU': '🇱🇺', 'MT': '🇲🇹',
  'CY': '🇨🇾', 'UA': '🇺🇦', 'RU': '🇷🇺', 'TR': '🇹🇷', 'IL': '🇮🇱',
  'AE': '🇦🇪', 'SA': '🇸🇦', 'IN': '🇮🇳', 'CN': '🇨🇳', 'JP': '🇯🇵',
  'KR': '🇰🇷', 'AU': '🇦🇺', 'NZ': '🇳🇿', 'CA': '🇨🇦', 'MX': '🇲🇽',
  'BR': '🇧🇷', 'AR': '🇦🇷', 'ZA': '🇿🇦', 'SG': '🇸🇬', 'HK': '🇭🇰',
  'TW': '🇹🇼', 'TH': '🇹🇭', 'MY': '🇲🇾', 'ID': '🇮🇩', 'PH': '🇵🇭',
  'VN': '🇻🇳', 'PK': '🇵🇰', 'BD': '🇧🇩', 'EG': '🇪🇬', 'NG': '🇳🇬',
  'KE': '🇰🇪', 'CO': '🇨🇴', 'CL': '🇨🇱', 'PE': '🇵🇪', 'VE': '🇻🇪'
};

/**
 * Check if IP is private/local
 */
function isPrivateIP(ip) {
  if (!ip) return true;

  // Handle localhost
  if (ip === '127.0.0.1' || ip === 'localhost' || ip === '::1') return true;

  // Parse IPv4
  const parts = ip.split('.');
  if (parts.length !== 4) return true; // Not valid IPv4

  const first = parseInt(parts[0], 10);
  const second = parseInt(parts[1], 10);

  // 10.x.x.x
  if (first === 10) return true;

  // 172.16.x.x - 172.31.x.x
  if (first === 172 && second >= 16 && second <= 31) return true;

  // 192.168.x.x
  if (first === 192 && second === 168) return true;

  return false;
}

/**
 * Get client IP from request headers
 */
function getClientIP(req) {
  // Check various headers (in order of preference)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs, take the first (client)
    const ips = forwardedFor.split(',').map(ip => ip.trim());
    return ips[0];
  }

  const realIP = req.headers['x-real-ip'];
  if (realIP) return realIP;

  const cfConnectingIP = req.headers['cf-connecting-ip'];
  if (cfConnectingIP) return cfConnectingIP;

  // Fallback to socket
  return req.socket?.remoteAddress || req.connection?.remoteAddress;
}

/**
 * Get flag emoji for country code
 */
function getCountryFlag(countryCode) {
  return countryFlags[countryCode] || '🌍';
}

/**
 * Lookup geolocation for IP address
 */
async function lookupIP(ip) {
  if (!ip || isPrivateIP(ip)) {
    return null;
  }

  // Check cache first
  const cached = cache.get(ip);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return cached.data;
  }

  try {
    // Use ipwho.is (free, HTTPS, no key required)
    const response = await fetch(`https://ipwho.is/${ip}`);
    const data = await response.json();

    if (data.success !== false) {
      const location = {
        country: data.country,
        countryCode: data.country_code,
        region: data.region,
        city: data.city,
        flag: getCountryFlag(data.country_code),
        displayName: data.city ? `${data.city}, ${data.country_code}` : data.country
      };

      // Cache the result
      cache.set(ip, {
        data: location,
        timestamp: Date.now()
      });

      return location;
    }
  } catch (error) {
    console.error('Geolocation lookup failed:', error.message);
  }

  return null;
}

/**
 * Get location from request
 */
async function getLocationFromRequest(req) {
  const ip = getClientIP(req);
  return lookupIP(ip);
}

/**
 * Clean up old cache entries (run periodically)
 */
function cleanupCache() {
  const now = Date.now();
  for (const [ip, entry] of cache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      cache.delete(ip);
    }
  }
}

// Run cache cleanup every hour
setInterval(cleanupCache, 60 * 60 * 1000);

module.exports = {
  lookupIP,
  getClientIP,
  getLocationFromRequest,
  isPrivateIP,
  getCountryFlag,
  cleanupCache
};
