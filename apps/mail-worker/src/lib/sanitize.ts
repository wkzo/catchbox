import sanitizeHtml from 'sanitize-html';

const PLACEHOLDER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const ALLOWED_TAGS = [
  'a', 'abbr', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'caption', 'center', 'cite', 'code',
  'col', 'colgroup', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure',
  'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark',
  'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'span', 'strike', 'strong',
  'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u',
  'ul', 'var', 'wbr',
];

function isRemote(url: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('data:') && !url.startsWith('cid:');
}

export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      '*': ['align', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'color', 'colspan',
        'dir', 'height', 'rowspan', 'style', 'valign', 'width'],
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'data-remote-src'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
      font: ['face', 'size', 'color'],
      ol: ['start', 'type'],
      ul: ['type'],
      time: ['datetime'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'data', 'cid', 'tel'],
    allowedSchemesByTag: { img: ['data', 'cid', 'http', 'https'] },
    disallowedTagsMode: 'discard',
    exclusiveFilter: (frame) =>
      ['script', 'style', 'iframe', 'frame', 'object', 'embed', 'form', 'input', 'button',
        'link', 'meta', 'base', 'applet'].includes(frame.tag),
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow' }),
      img: (tagName, attribs) => {
        const attrs = { ...attribs };
        const src = attrs['src'] ?? '';
        if (isRemote(src)) {
          attrs['data-remote-src'] = src;
          attrs['src'] = PLACEHOLDER;
          attrs['data-blocked'] = '1';
        }
        delete attrs['onerror'];
        delete attrs['onload'];
        return { tagName, attribs: attrs };
      },
    },
    parseStyleAttributes: false,
  });
}

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
