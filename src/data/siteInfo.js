// Verified business details. Every value is null until OLDVERGE supplies it.
// Nothing is displayed for a null value, and the Contact page and footer link
// stay unpublished until at least one channel below is set.
//
// formEndpoint: URL of a real form service (for example a Formspree-style endpoint
// that accepts a JSON POST and answers with a 2xx status). Set it at build time with
// VITE_CONTACT_FORM_ENDPOINT (name only; never commit its value if it is a secret).
// Only an https URL is accepted (plain http is allowed for localhost in the dev server). Anything else is ignored.
const safeEndpoint = (value) => {
  try {
    const url = new URL(value);
    const local = import.meta.env?.DEV && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    return url.protocol === 'https:' || (local && url.protocol === 'http:') ? url.href : null;
  } catch { return null; }
};

export const siteInfo = {
  contact: {
    email: null,
    phone: null,
    whatsapp: null,
    instagram: null,
    formEndpoint: safeEndpoint(import.meta.env?.VITE_CONTACT_FORM_ENDPOINT),
  },
};

export const isContactPublic = () => Object.values(siteInfo.contact).some(Boolean);

// Titles and meta descriptions for the content pages. Shop and product titles live in App.jsx / collections.js.
export const PAGE_META = {
  '/about': ['Our story', 'OLDVERGE offers quarter zips in four colours and a focused range of watches, made for everyday wear.'],
  '/faq': ['FAQ', 'Answers about OLDVERGE quarter zips, watches, sizing, ordering and payments.'],
  '/contact': ['Contact', 'Get in touch with OLDVERGE.'],
};
