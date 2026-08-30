// One place for the whole "clean, simple, straightforward" look. Change
// these values and the entire app restyles.
export const theme = {
  color: {
    bg: '#FFFFFF',
    card: '#F5F6F8',
    border: '#E4E6EB',
    text: '#111318',
    textMuted: '#6B7280',
    primary: '#111318', // near-black CTA — swap for a brand color anytime
    primaryText: '#FFFFFF',
    accent: '#2563EB',
    gold: '#D4A017',
    silver: '#9CA3AF',
    bronze: '#B87333',
    danger: '#DC2626',
  },
  space: (n: number) => n * 4,
  radius: 14,
  font: {
    title: 28,
    heading: 20,
    body: 16,
    small: 13,
  },
};
