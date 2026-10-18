import { useState } from 'react';
import { isBackend } from './config.js';
import { callFunction } from './api.js';
import { EMAIL_PATTERN } from '../components/ui.jsx';

// The exact words the visitor agrees to; they are stored with the subscription as consent evidence.
export const NEWSLETTER_CONSENT = 'I agree to receive news and updates from OLDVERGE by email. I can unsubscribe at any time.';

export const newsletterError = (status, error) => {
  if (status === 429) return 'Too many attempts. Please wait a few minutes and try again.';
  if (status === 0) return 'We could not reach the server. Check your connection and try again.';
  if (error === 'consent_required') return 'Tick the box to agree before subscribing.';
  if (error === 'invalid_field') return 'Enter a valid email address, like name@example.com.';
  return 'Something went wrong. Please try again.';
};

/**
 * Newsletter sign-up state shared by the home section and the footer.
 *   backend mode  saves an explicit-consent subscription through the newsletter-subscribe function.
 *   demo mode     validates locally and shows a simulated result; nothing is saved.
 */
export function useNewsletter(source) {
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('idle');           // idle | sending | done
  const submit = async (event) => {
    event.preventDefault();
    if (status === 'sending') return;
    if (!email.trim()) { setError('Enter your email address.'); return; }
    if (!EMAIL_PATTERN.test(email.trim())) { setError('Enter a valid email address, like name@example.com.'); return; }
    if (isBackend && !consent) { setError('Tick the box to agree before subscribing.'); return; }
    setError('');
    if (!isBackend) { setStatus('done'); return; }
    setStatus('sending');
    const result = await callFunction('newsletter-subscribe', { email: email.trim(), consent: true, consent_text: NEWSLETTER_CONSENT, source, website: '' });
    if (result.ok) { setStatus('done'); setEmail(''); setConsent(false); return; }
    setStatus('idle');
    setError(newsletterError(result.status, result.data?.error));
  };
  return { email, setEmail: (value) => { setEmail(value); setError(''); }, consent, setConsent: (value) => { setConsent(value); setError(''); }, error, status, submit, backend: isBackend };
}
