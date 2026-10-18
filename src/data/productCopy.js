// Written product descriptions. They describe the look, the style and when it is worn.
// They deliberately make no claims about materials, measurements, water resistance,
// movements, stock or delivery, because none of that is in the catalogue data.
export const PRODUCT_COPY = {
  'casio-a168': [
    'A small digital watch with a steel-look bracelet and a clear, square display. It keeps the retro look people still reach for, and it sits as easily under a sweater cuff as on a bare wrist.',
    'Pair it with a plain tee or a quarter-zip for a relaxed, everyday finish.',
  ],
  'casio-mtp': [
    'A classic analog watch with a round dial, thin hands and a steel-look bracelet. It is the kind of watch that quietly suits a white shirt, a work day or a dinner.',
    'Easy to read, easy to wear, and not trying too hard.',
  ],
  'timex-weekender': [
    'A field-inspired watch built around a clean, easy-to-read dial. It has the plain, practical look of a watch made for weekends, walks and everything in between.',
    'It works best with simple layers, in neutral colours.',
  ],
  'seiko-5': [
    'A sport-forward watch with a confident dial and a solid presence on the wrist. It leans casual, but it is tidy enough for the office.',
    'A good everyday pick if you want something a little more purposeful.',
  ],
  'citizen-eco-drive': [
    'A clean, everyday watch with a balanced dial and a refined metal finish. Nothing loud, just a watch that goes with whatever the day looks like.',
    'Wear it with tailoring or with a quarter-zip, and it holds its own either way.',
  ],
  'orient-bambino': [
    'A refined dress watch with a warm cream dial and a slim, classic profile. It is made for the moments when you want your wrist to look as considered as the rest of the outfit.',
    'Pair it with a crisp shirt or a fine knit.',
  ],
};

const ZIP_COLOUR_NOTES = {
  Black: 'Black is the easiest one to live in. It sits with everything and works from morning to night.',
  Beige: 'Beige is the soft, light option. It pairs well with darker trousers and warm neutrals.',
  Navy: 'Navy is a quieter alternative to black, a little softer and just as easy to wear.',
  Olive: 'Olive adds a calm, earthy note. It looks good with denim, stone and brown.',
};

export const copyFor = (product) => {
  // Backend products: the owner's own description (paragraphs separated by a blank line).
  if (product.dbId) {
    const paragraphs = String(product.description || '').split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
    return paragraphs.length ? paragraphs : [''];
  }
  if (PRODUCT_COPY[product.slug]) return PRODUCT_COPY[product.slug];
  if (product.category === 'Quarter-Zips') {
    const colour = product.colors[0];
    return [
      `The Essential Quarter-Zip in ${colour.toLowerCase()}: a familiar silhouette with a cleaner point of view. A short zip at the collar, a relaxed everyday shape, and nothing you have to think about.`,
      ZIP_COLOUR_NOTES[colour] || 'A considered layer for cool mornings, late evenings, and everything between.',
    ];
  }
  return [product.description];
};
