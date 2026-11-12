/**
 * cachedLoader memoizes an async loader in a bounded LRU of promises: the
 * least recently used key is dropped beyond `size`, and a failed load is
 * forgotten so the next call retries.
 */
export function cachedLoader<K, V>(load: (key: K) => Promise<V>, size: number): (key: K) => Promise<V> {
	const cache = new Map<K, Promise<V>>();
	return (key) => {
		let value = cache.get(key);
		if (value) {
			cache.delete(key);
		} else {
			value = load(key);
			value.catch(() => {
				if (cache.get(key) === value) cache.delete(key);
			});
		}
		cache.set(key, value);
		if (cache.size > size) cache.delete(cache.keys().next().value as K);
		return value;
	};
}
