export function generateAnalyticsQuery(
  startDate: string,
  endDate: string,
  env: string
) {
  const domainFilter =
    env === "prod" ? "%www.quicktalog.app%" : "%test.quicktalog.app%";

  return `
    SELECT 
      toDate(timestamp) AS date,
      properties.$current_url AS current_url,
      COUNT(*) AS pageview_count,
      COUNT(DISTINCT properties.distinct_id) AS unique_visitors
    FROM events
    WHERE event = '$pageview'
      AND properties.$current_url NOT ILIKE '%admin%'
      AND properties.$current_url LIKE '%/catalogues/%'
      AND properties.$current_url NOT ILIKE '%localhost%'
      AND properties.$current_url ILIKE '${domainFilter}'
      AND timestamp >= toDateTime('${startDate}')
      AND timestamp < toDateTime('${endDate}')
    GROUP BY date, current_url
    ORDER BY date DESC
    LIMIT 1000000
  `;
}
