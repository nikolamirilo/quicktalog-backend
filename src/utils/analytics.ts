export function generateAnalyticsQuery(
  startDate: string,
  endDate: string,
  env: string
) {
  return `SELECT 
    toDate(timestamp) AS date,
    properties.$current_url AS current_url,
    COUNT(*) AS pageview_count,
    COUNT(DISTINCT properties.distinct_id) AS unique_visitors
FROM events
WHERE event = '$pageview'
  AND properties.$current_url NOT ILIKE '%admin%'
  AND properties.$current_url LIKE '%/catalogues/%'
  AND properties.$current_url NOT ILIKE '%localhost%'
  AND properties.$current_url ILIKE '${
    env === "test" ? "%test.quicktalog.app%" : "wwww.quicktalog.app"
  }'
  AND timestamp >= toDateTime('${startDate}')
  AND timestamp < toDateTime('${endDate}')
GROUP BY date, current_url
ORDER BY date DESC
LIMIT 1000000
`;
}
