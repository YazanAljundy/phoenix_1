// Placeholder for testing - replace with the admin's real WhatsApp number
// (digits only, with the country code, no leading "+" or spaces, e.g.
// "963911234567").
export const ADMIN_WHATSAPP_NUMBER = '963900000000';

// Opens a prefilled chat with the admin in a new tab. Publishing and payment
// for a banner or an advertisement package still happen manually over WhatsApp -
// these buttons just start that conversation with the right context in it.
export function contactAdminOnWhatsApp(text) {
  window.open(
    `https://wa.me/${ADMIN_WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`,
    '_blank',
    'noreferrer'
  );
}
