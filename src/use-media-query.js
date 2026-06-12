import { useEffect, useState } from 'react';

// Phones are < 768 px wide; tablets and desktops match this query.
export const TABLET_QUERY = '(min-width: 768px)';

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
