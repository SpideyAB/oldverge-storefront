import { NEWSLETTER_CONSENT, useNewsletter } from '../lib/newsletter.js';
import { getSetting, useSite } from '../data/site.js';

/**
 * Newsletter sign-up. Backend mode saves a subscription with explicit consent evidence and says only that it was
 * saved; whether newsletters are actually being sent is a store setting (newsletter.active, off by default).
 * Demo mode validates locally and shows a simulated result; nothing is saved.
 */
export default function NewsletterForm() {
  useSite((state) => state.settings);
  const news = useNewsletter('home');
  const active = getSetting('newsletter.active', false) === true;
  return <section className="ov-newsletter" aria-labelledby="ov-news-title">
    <div>
      <h2 id="ov-news-title">News from OLDVERGE</h2>
      <p>{news.backend ? 'Leave your email to hear from us. You choose whether to subscribe.' : 'This sign-up form is a preview and is not connected yet.'}</p>
    </div>
    {news.status === 'done' ? <p className="ov-form-ok" role="status">{news.backend
      ? `Thank you, your address has been saved.${active ? '' : ' OLDVERGE has not started sending newsletters yet.'}`
      : 'Demo only: nothing was saved and no email will be sent.'}</p>
      : <form onSubmit={news.submit} noValidate>
        <label htmlFor="ov-news-email">Email address</label>
        <div><input id="ov-news-email" type="email" autoComplete="email" value={news.email} aria-invalid={news.error ? 'true' : undefined} aria-describedby={news.error ? 'ov-news-error' : undefined} onChange={(event) => news.setEmail(event.target.value)} placeholder="name@example.com" />
          <button type="submit" className="ov-button ov-button-dark" disabled={news.status === 'sending'}>{news.status === 'sending' ? 'Saving…' : 'Notify me'}</button></div>
        {news.backend && <label className="ov-news-consent"><input type="checkbox" checked={news.consent} onChange={(event) => news.setConsent(event.target.checked)} /> <span>{NEWSLETTER_CONSENT}</span></label>}
        {news.error && <p className="ov-field-error" id="ov-news-error" role="alert">{news.error}</p>}
        {!news.backend && <p className="ov-note">Demo form: it is not connected to a mailing list.</p>}
      </form>}
  </section>;
}
