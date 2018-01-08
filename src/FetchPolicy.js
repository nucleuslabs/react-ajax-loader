// copied from Apollo https://www.apollographql.com/docs/react/basics/queries.html#graphql-config-options-fetchPolicy

/**
 * Try the cache first. If match is found return that. Otherwise, send out a network request and cache it for next time.
 */
export const CacheFirst = 'cache-first';

/**
 * Try the cache first but send out a network request anyway. Update component and cache if there's new data.
 */
export const CacheAndNetwork = 'cache-and-network';

/**
 * Don't use the cache.
 */
export const NetworkOnly = 'network-only';

/**
 * Only read from the cache. Do not send any network requests. How do you populate the cache? Nobody knows.
 */
export const CacheOnly = 'cache-only';