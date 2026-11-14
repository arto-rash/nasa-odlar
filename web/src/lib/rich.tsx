/** Rich-text tags for next-intl messages: `<hl>` marks the accent phrase of a headline. */
export const rich = {
  hl: (chunks: React.ReactNode) => <span className="hl">{chunks}</span>,
};
