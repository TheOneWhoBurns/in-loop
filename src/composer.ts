/**
 * Composes newsletter HTML emails.
 *
 * The weekly newsletter has one section per topic, each with:
 * - A "vibe of the week" flavor text
 * - A list of curated articles (title + link)
 * - Optional cross-topic callouts
 */

export interface NewsletterArticle {
  title: string;
  url: string; // Already wrapped for click tracking if enabled
  summary?: string;
}

export interface NewsletterSection {
  topicName: string;
  vibeText: string;
  articles: NewsletterArticle[];
}

export interface NewsletterData {
  sections: NewsletterSection[];
  crossTopicNotes?: string[];
  weekLabel: string; // e.g. "March 17–23, 2026"
}

export function composeNewsletter(data: NewsletterData): string {
  const sections = data.sections
    .map(
      (section) => `
    <tr>
      <td style="padding: 24px 0; border-bottom: 1px solid #e0e0e0;">
        <h2 style="margin: 0 0 8px 0; color: #1a1a1a; font-size: 20px;">
          ${section.topicName}
        </h2>
        <p style="margin: 0 0 16px 0; color: #666; font-style: italic; font-size: 14px;">
          ${section.vibeText}
        </p>
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          ${section.articles
            .map(
              (article) => `
            <tr>
              <td style="padding: 8px 0;">
                <a href="${article.url}" style="color: #0066cc; text-decoration: none; font-size: 16px;">
                  ${article.title}
                </a>
                ${article.summary ? `<p style="margin: 4px 0 0 0; color: #888; font-size: 13px;">${article.summary}</p>` : ""}
              </td>
            </tr>
          `,
            )
            .join("")}
        </table>
      </td>
    </tr>
  `,
    )
    .join("");

  const crossTopic =
    data.crossTopicNotes && data.crossTopicNotes.length > 0
      ? `
    <tr>
      <td style="padding: 24px 0; border-bottom: 1px solid #e0e0e0;">
        <h2 style="margin: 0 0 12px 0; color: #1a1a1a; font-size: 18px;">🔗 Cross-topic</h2>
        ${data.crossTopicNotes.map((note) => `<p style="margin: 4px 0; color: #555; font-size: 14px;">${note}</p>`).join("")}
      </td>
    </tr>
  `
      : "";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 0; background: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 600px; margin: 0 auto; background: #ffffff;">
    <tr>
      <td style="padding: 32px 24px 16px 24px; border-bottom: 2px solid #1a1a1a;">
        <h1 style="margin: 0; font-size: 24px; color: #1a1a1a;">🔄 inloop</h1>
        <p style="margin: 4px 0 0 0; color: #888; font-size: 14px;">${data.weekLabel}</p>
      </td>
    </tr>
    <tr>
      <td style="padding: 0 24px;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          ${sections}
          ${crossTopic}
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding: 24px; color: #aaa; font-size: 12px; text-align: center;">
        Curated by your inloop agent · Reply to manage topics
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}
