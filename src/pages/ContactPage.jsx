import { Link } from 'react-router-dom';
import { Instagram, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { contactInfo, useSite } from '../data/site.js';
import ContactForm from '../components/ContactForm.jsx';
import Reveal from '../components/Reveal.jsx';
import { DemoNotice } from '../components/ui.jsx';

// Contact details come only from data/siteInfo.js. Nothing is invented: a channel OLDVERGE has not published
// is described as not yet available, and the form is a labelled demo until an endpoint is configured.
export default function ContactPage() {
  useSite((state) => state.settings);
  const { email, phone, whatsapp, instagram, connected } = contactInfo();
  const message = [
    email && { key: 'email', icon: Mail, label: email, href: `mailto:${email}` },
    whatsapp && { key: 'whatsapp', icon: MessageCircle, label: `WhatsApp ${whatsapp}`, href: `https://wa.me/${whatsapp.replace(/\D/g, '')}` },
    instagram && { key: 'instagram', icon: Instagram, label: 'Message us on Instagram', href: instagram, external: true },
  ].filter(Boolean);
  const call = phone ? { icon: Phone, label: phone, href: `tel:${phone.replace(/\s/g, '')}` } : null;
  const none = !message.length && !call && !connected;
  const link = ({ key, icon: Icon, label, href, external }) => <li key={key || label}><a href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}><Icon size={16} aria-hidden="true" />{label}</a></li>;

  return <main id="main-content" className="ov-page ov-contact">
    <Reveal as="header" className="ov-contact-head">
      <h1>Contact our team</h1>
      <p>Questions about a product, sizing or an order? Fill in the form and tell us what you would like to know.</p>
    </Reveal>
    {none && <DemoNotice>Draft placeholder. OLDVERGE has not published contact details yet, so the form below is a layout preview.</DemoNotice>}
    <div className="ov-contact-grid">
      <Reveal className="ov-contact-formwrap"><ContactForm /></Reveal>
      <Reveal className="ov-contact-info" delay={0.1}>
        <section aria-labelledby="ov-ci-chat">
          <h2 id="ov-ci-chat">Message us</h2>
          <p>Write to us about products, sizing or an order.</p>
          {message.length ? <ul>{message.map(link)}</ul> : <p className="ov-ci-empty">An email address and chat channel have not been published yet. Use the form for now.</p>}
        </section>
        <section aria-labelledby="ov-ci-call">
          <h2 id="ov-ci-call">Call us</h2>
          {call ? <><p>Speak to the OLDVERGE team.</p><ul>{link(call)}</ul></> : <p className="ov-ci-empty">A phone number has not been published yet.</p>}
        </section>
        <section aria-labelledby="ov-ci-visit">
          <h2 id="ov-ci-visit">Visit us</h2>
          <p className="ov-ci-empty"><MapPin size={16} aria-hidden="true" /> No shop address has been published. OLDVERGE is based in Pakistan.</p>
        </section>
        <section aria-labelledby="ov-ci-more">
          <h2 id="ov-ci-more">Looking for something else?</h2>
          <ul>
            <li><Link to="/faq">Read the FAQ</Link></li>
            <li><Link to="/pages/shipping">Shipping &amp; delivery</Link></li>
            <li><Link to="/pages/returns">Returns &amp; exchanges</Link></li>
            <li><Link to="/pages/track-order">Track an order</Link></li>
          </ul>
        </section>
      </Reveal>
    </div>
  </main>;
}
